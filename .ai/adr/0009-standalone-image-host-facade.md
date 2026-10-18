# 0009: Image Host as a Standalone Facade

- **Date**: 2026-09-30
- **Status**: Accepted (the reference facade source lived at `media-proxy/` until v0.1.2, when it was removed from this repository's history; the decision and the API contract stand — the contract now lives in README §Media host facade. Amended 2026-10-19: "unset means the local dev simulation" was replaced by an explicit configuration, and the stand-in's port left `src/` — see the amendment at the end.)
- **Context**: Uploads originally ran through `POST /upload` on the Infoto Worker, which held `TC_SECRET`, signed the request, and forwarded the multipart body to the image host at `tc.0147258.xyz`. That coupled three things: the album server held an image-host credential, the upstream hostname was compiled into `upload.ts`, and every dev upload spent real host quota. When the upstream needed replacing, the change touched album code. A local dev stand-in (added 2026-09-30) made this worse before it made it better — the stand-in's address was hardcoded as a module constant, so a deployed Worker still pointed at `127.0.0.1` and every production upload failed.
- **Decision**: Move the image host behind its own deployable Worker (`media-proxy/worker.js`) that owns `TC_SECRET` and exposes a small uniform API. The browser POSTs artifacts directly to it; it signs, forwards upstream, and returns the URL the upstream gave back. The facade is **stateless and identity-free**: no KV, no user verification, no per-request state. Infoto keeps no `TC_SECRET` and has no `/upload` route: it stores the returned URL and publishes the facade address as `mediaHostUrl` in the `/sync` response, which the page forwards to the SharedWorker. `MEDIA_HOST_URL` selects the facade; unset means the local dev simulation, so a fresh clone never reaches the real host. (Amended 2026-10-19 — see the amendment at the end of this record.)
- **Consequences**:
  - The album server's blast radius shrinks: no image-host credential, no upload route, no streaming proxy for writes. `/l/:id36` still proxies reads and keeps the SSRF guard.
  - The facade is a thin relay — one file, no bindings, no state. Swapping or replacing it never touches the album's code, secret, or release cadence.
  - **No migration on host change**: the facade returns the upstream URL, so `photos.url` names the image host. Already-uploaded photos keep working because the old host keeps serving them; a host swap only affects new uploads. The KV-backed alternative that would have made stored URLs host-independent was rejected as unnecessary complexity for a first deploy.
  - The facade is a public endpoint by design. Without any identity check, anyone can spend the upstream's quota; rate-limit it at the Cloudflare dashboard (WAF / rate limiting rules) if that matters.
  - Two deployables now need coordinated configuration: the facade's `TC_SECRET` and Infoto's `MEDIA_HOST_URL`. A missing `MEDIA_HOST_URL` fails the deploy loudly rather than silently pointing production at localhost. (Corrected 2026-10-02: the workflow originally wrote the var only when non-empty and the "hard-fails below" comment described a check that did not exist. It now exits 1 when the repo variable is empty, and `isAllowedMediaUrl` treats _absent_ config as a misconfigured deployment — strict rule — while only a dev worker with no facade gets the loopback exception.)
  - Cross-origin upload means the facade must answer CORS, and the client must send no credentials — a session cookie leaking to the facade would hand a stranger an identity.
- **Alternatives considered**:
  - _Keep proxying uploads in the album Worker, just make the host configurable_: fixes the hardcoded-constant bug but leaves the credential, the upload route, and the coupling in place. It treats the symptom.
  - _KV-backed facade returning its own origin_: would have made stored URLs host-independent, at the cost of a binding, a read path, and per-id state. Rejected — the migration it avoids is a one-time, mechanical operation, and the simpler relay is easier to reason about and replace.
  - _Have the browser call the image host directly_: no signing secret anywhere, but it hardcodes the upstream in client code and breaks the moment the host changes — the opposite of the goal.
  - _Issue short-lived upload tokens from `/sync` instead of a permanent secret_: tighter, but adds token state and a second failure mode for no gain while the facade is the only caller.

---

## Amendment 2026-10-19: the stand-in's address is configuration, not a constant

- **Context**: "Unset means the local dev simulation" made the local host an _absence_ rather
  than a value. That left two copies of the same fact: `MEDIA_HOST_URL` had to be unset for dev
  and set for production, while `src/shared/media.ts` still carried `LOCAL_MEDIA_HOST_URL =
'http://127.0.0.1:8788'` as the fallback the Worker's `/sync` and the browser's
  `uploadClient` both fell back to. Moving the stand-in's port meant editing a constant in
  `src/`, the loopback comparison, and the dev script — three places that only agree while
  someone remembers all three. It also meant the SSRF exception keyed off "no configuration",
  which reads as "dev" but is really "misconfigured deployment".
- **Decision**: The local simulation is now _configured_ like any other host.
  - `.dev.vars` (gitignored) carries `MEDIA_HOST_URL=http://127.0.0.1:8788` next to the local
    Turnstile keys. The Worker reads it the same way production reads its repo variable, and
    `/sync` names it in `mediaHostUrl` with **no fallback** — an unset value yields `''`.
  - The port lives in exactly two files: `.dev.vars` (Worker + SSRF guard) and
    `config.mediaPort` in the root `package.json` (read by `dev:media` and by
    `web/playwright.config.ts`). `LOCAL_MEDIA_HOST_URL` was deleted from `src/`.
  - `isAllowedMediaUrl` grants the loopback exception only when the configured facade is
    itself loopback (`isLoopbackOrigin`), compared by parsed origin. Absent config gets the
    strict rule, because "unset" is a misconfigured deployment, not local dev.
  - The SharedWorker fails a job with `media_host_unset` when no facade address has arrived,
    instead of falling back to a host nobody chose.
- **Consequences**: Changing the dev port is a two-file edit with no code change, and a stale
  constant can no longer disagree with the running port. The cost is that a clone must copy
  `.dev.vars` before uploads work locally — the same as it already needed for Turnstile keys.
  Production is unaffected: the deploy workflow already hard-fails without `MEDIA_HOST_URL`.
- **Alternatives considered**:
  - _Keep the constant but read the port from it_: still two sources of truth, and the constant
    is compiled into the Worker bundle, which is exactly what red line 7 forbids for hostnames.
  - _Make the Worker default to loopback only when `NODE_ENV`/`wrangler dev`_: a runtime sniff
    that can be wrong at the edge, and it keeps the "absence means dev" ambiguity.
  - _Put the port in `.dev.vars` only_: leaves `dev:media` and the e2e harness with their own
    copies, which is the same drift in a different file.
