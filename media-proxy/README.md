# Media Host Facade — API Specification

Infoto does not talk to any image host directly. The browser uploads to a **media host
facade** you deploy yourself, and the album server only stores the URL that comes back.
This document is the contract between Infoto and that facade.

If you are bringing your own storage (S3, R2, a different transcoding service, anything),
implement this spec and point Infoto at it. Nothing in `src/` needs to change.

---

## 1. What Infoto expects

| Concern                                  | Owner                                    |
| ---------------------------------------- | ---------------------------------------- |
| Signing the request to your storage      | **You** (the facade)                     |
| Storing the file, returning a public URL | **You** (the facade)                     |
| Authenticating the visitor               | Infoto (`/sync`), not the facade         |
| Storing the URL                          | Infoto (`photos.url`)                    |
| Serving the bytes to viewers             | Infoto (`GET /l/:id36`) proxies your URL |
| Transcoding to WebP / WebM               | The browser, before upload               |

Infoto has no `/upload` route and holds no storage credential. A visitor's browser POSTs
the finished artifact straight to your facade.

---

## 2. Configuration

Set the facade's origin as the `MEDIA_HOST_URL` repository **Variable** in Infoto
(Actions → Settings → Secrets and variables → Actions → _Variables_).

```
MEDIA_HOST_URL = https://your-facade.example.com
```

No trailing slash, no path. The deploy workflow fails the build if this is empty, rather
than silently pointing production at the local simulation on `127.0.0.1`.

The value is applied to the Worker with `wrangler secret put`, so it is stored encrypted.
It is a public hostname, not a credential — a Variable, not a Secret.

---

## 3. Required endpoint

### `POST /upload`

Accepts one multipart file and returns its public URL.

**Request**

```http
POST /upload HTTP/1.1
Content-Type: multipart/form-data; boundary=…
Origin: https://infoto.example.com
```

| Field  | Required | Notes                                            |
| ------ | -------- | ------------------------------------------------ |
| `file` | yes      | The artifact. Field name must be exactly `file`. |

The `filename` carries the extension the browser chose (`m.webp`, `m.webm`, …) and is
advisory. `Content-Type` inside the part carries the real media type. Infoto sends no
cookies and no `Authorization` header — see §5.

**Success response**

```http
HTTP/1.1 200 OK
Content-Type: application/json

{ "data": "https://cdn.example.com/objects/9f2c….webp" }
```

`data` is the only field Infoto reads. It is stored verbatim in `photos.url` and later
fetched by the read proxy. It must satisfy §4 or the write is rejected.

**Error response**

Any non-2xx status with a JSON body. Infoto reads `error` as a stable machine code and
`msg` as human-readable detail:

```http
HTTP/1.1 413 Payload Too Large
Content-Type: application/json

{ "error": "too_large", "msg": "artifact exceeds 100 MB" }
```

If the body is not JSON, Infoto synthesises the code `http_<status>` and shows nothing
user-facing. Always answer with JSON.

---

## 4. The URL contract

The URL in `data` is checked by `isStorableMediaUrl` in
`src/worker/routes/media.ts`. A URL that fails is **silently dropped** — the upload op is
discarded and the photo never appears. There is no error surfaced to the visitor, so this
is the single most important thing to get right.

Accepted:

- `https:` scheme, **no** embedded `user:password`
- A public DNS name (`cdn.example.com`, `your-bucket.r2.dev`, …)
- A global-unicast IPv6 literal (`https://[2606:4700::1111]/x.webp`)

Rejected:

| Rejected                                                             | Why                                                        |
| -------------------------------------------------------------------- | ---------------------------------------------------------- |
| `http://…`                                                           | Must be HTTPS. Plain HTTP is an SSRF and downgrade vector. |
| `localhost`, `*.local`, `*.internal`, trailing-dot variants          | Only resolve inside your own network.                      |
| `127.0.0.0/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16`       | Private IPv4 literals.                                     |
| `0.0.0.0/8`, `100.64/10` (CGNAT), `198.18/15`, `192.0.0/24`, `224/4` | Special-use ranges.                                        |
| `::1`, `fc00::/7`, `fe80::/10`, IPv4-mapped IPv6                     | Non-global-unicast IPv6.                                   |

**The URL must be publicly fetchable by Cloudflare.** Infoto's read proxy (`GET /l/:id36`)
fetches it from the edge with no credentials, so a pre-signed URL or a bucket that
requires an auth header will render as a 404 in the album.

**One exception, for development only:** while `MEDIA_HOST_URL` is unset or points at
`http://127.0.0.1:8788`, Infoto additionally accepts that exact origin. A deployed
facade never gets the exception — it is the single hole in the SSRF guard and is matched
by parsed origin, never by string prefix.

---

## 5. CORS

The upload is cross-origin, so the browser enforces CORS. **Without correct headers the
upload fails in the browser before your code runs.**

Required on `POST /upload` responses (and on the `OPTIONS` preflight):

```http
Access-Control-Allow-Origin: https://infoto.example.com
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: content-type
```

- The browser sends a preflight, because `multipart/form-data` with a custom boundary
  plus a non-simple request triggers one. Answer `OPTIONS` with `204` and the headers
  above.
- Echo a specific origin rather than `*` if you can. `*` works (the reference
  implementation uses it) because the request carries no credentials.
- Preflight responses are cached for the `Access-Control-Max-Age` you send; 86400 is fine.

Infoto deliberately sends **no credentials** to the facade — no cookies, no
`Authorization`. Do not require either. The session cookie is `HttpOnly` and belongs to
Infoto's own origin; sending it to the facade would hand a stranger a session.

---

## 6. Reference implementation

`worker.js` in this directory is a working facade for the upstream image host this project
originally used. It signs an HS256 JWT with a shared secret and forwards the multipart
body unchanged. Read it for the CORS handling, the URL validation, and the error relay.

To use your own storage instead, keep the interface and change the middle: replace
`UPSTREAM_UPLOAD` and the signing with a call to your storage SDK.

```bash
npx wrangler deploy
npx wrangler secret put TC_SECRET     # only if your upstream needs signing
```

`/health` is a convenience probe, not part of the contract:

```http
GET /health  ->  200 { "ok": true }
```

---

## 7. Local development

Infoto does not need a facade to run locally. With `MEDIA_HOST_URL` unset, `/sync` reports
`http://127.0.0.1:8788` and uploads go to `scripts/local-media-host.mjs` at the repo root,
which `npm run dev` starts automatically. Files land in the gitignored `.local-media/`.

That stand-in answers the same CORS headers, so a browser failure locally means a real
failure in production.

To exercise your own facade locally, set `MEDIA_HOST_URL` in the gitignored `.dev.vars`
to its origin. Remember to remove it afterwards, or every local test spends real
storage and bandwidth.

---

## 8. Operational notes

**Rate limiting is your responsibility.** The facade is a public endpoint by design: anyone
who learns the URL can spend your storage and egress. The reference implementation has no
identity check. Add Cloudflare WAF or Rate Limiting rules on `/upload`, or require a
Turnstile token in a header, before exposing it.

**The facade is stateless.** It needs no KV, no database, and no session. That is
deliberate — it can be replaced without any migration on the album side.

**Changing storage later does not break existing photos.** `photos.url` names your CDN,
and the old CDN keeps serving what it already holds. Only new uploads go to the new
backend. If you want a single stable URL forever, return a URL on the facade's own origin
and keep an id → real URL mapping in KV; the album side needs no change either way, but
that adds a read hop and a binding.

**Facades are not interchangeable at read time.** Infoto fetches whatever URL was stored.
If you rotate storage, keep the old URLs reachable for as long as photos referencing them
must display.
