# 0006: Web Fonts Race the Official Host Against the USTC Mirror

- **Date**: 2026-09-27
- **Status**: Superseded by 0006-revised — the USTC mirror's TLS handshake fails against
  current clients (`SSL_ERROR_NO_CIPHER_OVERLAP` in Firefox, `HandshakeFailure` from
  OpenSSL), so the losing half of the race only ever produced a console error. The race is
  removed and the official host is used alone. Recorded for history; see 0006-revised for
  the current decision.
- **Context**: The SPA and the Worker error pages loaded Inter, Noto Sans SC, and (on error pages) Space Grotesk from `fonts.googleapis.cn`. That host is unstable. The official CSS host is `fonts.googleapis.com`, with files on `fonts.gstatic.com`. Visitors who cannot reach the official host still need the same families, including CJK glyphs from Noto Sans SC. Self-hosting the variable CJK face would add a large asset to every deploy.
- **Decision**: Race two stylesheet URLs and apply the first one that loads. Remove the loser so its font files are not used. Delete every `fonts.googleapis.cn` reference.
  - Official: `https://fonts.googleapis.com` CSS, `https://fonts.gstatic.com` files.
  - USTC mirror: `https://fonts.proxy.ustclug.org` CSS, `https://fonts-gstatic.proxy.ustclug.org` files. This is the USTCLUG reverse proxy for Google Fonts, the same group that runs `mirrors.ustc.edu.cn`. The mirror homepage's reverse-proxy table does not currently list the fonts hosts; the proxy hostnames above are the ones that group publishes for this service.
  - One helper (`src/shared/fonts.ts`) builds the head markup. Vite injects it into `web/index.html` at `<!-- font-race -->`. The Worker error page inlines the same helper and allows both hosts in its CSP (`style-src`, `font-src`, `connect-src`, plus `script-src 'unsafe-inline'` for the static race script only).
  - Families and weights are unchanged. `display=swap` stays, so missing either host falls back to `system-ui` until one stylesheet wins, and if both fail the fallback remains.
- **Consequences**:
  - A blocked official host no longer blocks the typeface, and a down mirror no longer blocks visitors who can reach Google.
  - The error page now contains one static script. Copy is still escaped outside that script; the script body is not built from the request.
  - Adding a family means changing the query in `fonts.ts` only. Both pages and the CSP follow it.
- **Alternatives considered**:
  - _Keep `fonts.googleapis.cn` as the China source_: rejected — that host is the unstable one being removed.
  - _`fonts.lug.ustc.edu.cn`_: rejected as the older LUG hostname. The current USTCLUG proxy naming is `*.proxy.ustclug.org`, matching the other reverse proxies on the USTC mirror.
  - _Vendor the font files_: rejected — Noto Sans SC at the weights the UI uses is too large to ship on every response path, and the race already covers a dead mirror.
