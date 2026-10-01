# 0006-revised: Web Fonts Load From the Official Host Only

- **Date**: 2026-10-01
- **Status**: Accepted
- **Context**: ADR 0006 raced the official Google Fonts stylesheet against the USTCLUG mirror (`fonts.proxy.ustclug.org`) and applied whichever returned first. The mirror was adopted on the strength of the reverse-proxy hostname USTCLUG publishes, without verifying that it actually served those hosts — the original ADR admits the mirror's own index did not list them. In the browser the mirror never won: its CSS request fails during TLS negotiation, not during HTTP. Firefox reports `NS_ERROR_MODULE_SECURITY` / `SSL_ERROR_NO_CIPHER_OVERLAP`, and OpenSSL reports a bare `HandshakeFailure`, while the TCP connection to port 443 succeeds. So the failure is cipher/certificate compatibility, not reachability, and the race spent a request and a console error on every page load while providing no redundancy.
- **Decision**: Load the official stylesheet and nothing else. Drop the mirror, the race script, and the runtime host list; `src/shared/fonts.ts` now emits preconnects plus one `<link rel="stylesheet">`. `display=swap` is retained, so text renders in `system-ui` until the stylesheet arrives and stays there if it never does.
- **Consequences**:
  - No script is injected into the page any more, so the error page's CSP drops `script-src 'unsafe-inline'` entirely — a real narrowing, since the page has no other JavaScript.
  - Font CSS is a hard dependency again: a visitor who cannot reach `fonts.googleapis.com` sees the system fallback rather than a mirror. That is the accepted cost, and it is bounded — `display=swap` means layout stays readable, only the typeface changes.
  - Nothing is gained by racing a source that always fails. If a working mirror is wanted later, it should be verified end to end (TLS handshake plus a real `css2` response) before it enters the build, and re-verified when it breaks — the mirror hostname in ADR 0006 was never checked and was the reason that ADR failed.
- **Alternatives considered**:
  - _Find a different mirror and keep racing_: rejected for now. It re-adds a second request, a script, and the `script-src` hole for a fallback that is nice to have rather than required. Worth revisiting only with a mirror that has been verified to complete a TLS handshake.
  - _Self-host the font files_: rejected for now — Noto Sans SC at the weights the UI uses is a large asset on every response path, and the failure mode being guarded against (a blocked font host) degrades gracefully under `display=swap`.
  - _Keep the race but drop only the mirror from it_: rejected — a race with one competitor is not a race.
