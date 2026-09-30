# 0009: Image Host as a Standalone Facade

- **Date**: 2026-09-30
- **Status**: Accepted
- **Context**: Uploads originally ran through `POST /upload` on the Infoto Worker, which held `TC_SECRET`, signed the request, and forwarded the multipart body to the image host at `tc.0147258.xyz`. That coupled three things: the album server held an image-host credential, the upstream hostname was compiled into `upload.ts`, and every dev upload spent real host quota. When the upstream needed replacing, the change touched album code. A local dev stand-in (added 2026-09-30) made this worse before it made it better — the stand-in's address was hardcoded as a module constant, so a deployed Worker still pointed at `127.0.0.1` and every production upload failed.
- **Decision**: Move the image host behind its own deployable Worker (`media-proxy/worker.js`) that owns `TC_SECRET` and exposes a small uniform API. The browser POSTs artifacts directly to it; it signs, forwards upstream, and returns a URL **on its own origin**, backed by a KV mapping from an opaque id to the upstream URL. Infoto keeps no `TC_SECRET` and has no `/upload` route: it stores the returned URL and publishes the facade address as `mediaHostUrl` in the `/sync` response, which the page forwards to the SharedWorker. `MEDIA_HOST_URL` selects the facade; unset means the local dev simulation, so a fresh clone never reaches the real host.
- **Consequences**:
  - Replacing the image host is a change to one constant in a separate Worker. Stored `photos.url` values stay valid because they point at the facade, not the upstream.
  - The album server's blast radius shrinks: no image-host credential, no upload route, no streaming proxy for writes. `/l/:id36` still proxies reads and keeps the SSRF guard.
  - Reads become one hop longer (client → `/l/:id36` → facade → upstream) with a KV lookup in the middle. The facade caches aggressively on `immutable`, so the hop is paid once per edge location.
  - The facade is a public endpoint by design. Without a `TURNSTILE_SECRET_KEY` on it, anyone can spend the upstream's quota; that secret is the mitigation and should be set on any real deployment.
  - Two deployables now need coordinated configuration: the facade's `TC_SECRET` and Infoto's `MEDIA_HOST_URL`. A missing `MEDIA_HOST_URL` fails the deploy loudly rather than silently pointing production at localhost.
  - Cross-origin upload means the facade must answer CORS, and the client must send no credentials — a session cookie leaking to the facade would hand a stranger an identity.
- **Alternatives considered**:
  - _Keep proxying uploads in the album Worker, just make the host configurable_: fixes the hardcoded-constant bug but leaves the credential, the upload route, and the coupling in place. It treats the symptom.
  - _Return the upstream URL directly, skip KV_: one less moving part, but every stored URL would name the image host. A later migration would mean rewriting `photos.url` across the table, which is exactly the coupling this removes.
  - _Have the browser call the image host directly_: no signing secret anywhere, but it hardcodes the upstream in client code and breaks the moment the host changes — the opposite of the goal.
  - _Issue short-lived upload tokens from `/sync` instead of a permanent secret_: tighter, but adds token state and a second failure mode for no gain while the facade is the only caller.
