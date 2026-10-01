# 0011: Web Fonts Load From Google's China Endpoint

- **Date**: 2026-10-01
- **Status**: Accepted
- **Context**: ADR 0006-revised moved the web fonts to the global host alone (`fonts.googleapis.com` / `fonts.gstatic.com`) after the USTCLUG mirror's TLS handshake failed, and accepted as the cost that font CSS became a dependency on a host that is slow from here. It was not measured — the decision reasoned only about the mirror's failure and never timed the host it kept. Visitors still saw multi-second font loads.
- **Decision**: Use Google's own China endpoint, `fonts.googleapis.cn` for the stylesheet and `fonts.gstatic.cn` for the files. Still a single source: no race, no script, no extra CSP host.
- **Consequences**:
  - The verification ADR 0006-revised asked for was done before adopting this source — DNS, TLS handshake, a real `css2` response, and real `woff2` fetches all succeed. This is the step 0006 skipped with the USTC hostname, and the reason that ADR failed.
  - The stylesheet host is the wrong thing to have been timing. One `css2` response is ~115 KB and returns in about 0.7 s; the family resolves to **108 woff2 files, 101 of which are Noto Sans SC unicode-range subsets**, and those are what a page waits on. Fetching 14 of those subsets: 45 s with no failures from `fonts.gstatic.cn`, against 102 s and **two failures** from `fonts.gstatic.com`.
  - The `.cn` endpoint is slower than the global host for the stylesheet itself (1.1 s vs 0.7 s) and that is the right trade: the stylesheet is fetched once, the files are fetched per page.
  - The two hosts are a matched pair. The stylesheet hardcodes its own file host in every `src:` URL, so changing one constant without the other gets every font file blocked by `font-src` rather than falling back to another CDN. `fonts.test.ts` pins the pair, the CSP, and the preconnects together.
  - `fonts.googleapis.cn` is Google-operated and geo-routed, not a third-party reverse proxy, so it carries none of the trust or staleness concerns that ruled out the USTC mirror. It should still be re-verified if it ever starts failing, by the same end-to-end check.
- **Alternatives considered**:
  - _Re-add the USTCLUG mirror as a fallback alongside this_: rejected for now. Its TLS handshake still fails here — reproduced during this work, `SEC_E_ILLEGAL_MESSAGE` from schannel, TCP connect succeeding — so it would contribute a console error per load and no redundancy, exactly as 0006-revised found. A second source is only worth its cost once it completes a handshake.
  - _Race the `.cn` and global hosts_: rejected — both are Google's own endpoints serving identical CSS, so racing them adds a request and a script to pick between two copies of the same thing.
  - _Self-host the font files_: still rejected. Noto Sans SC at the weights the UI uses is large to ship on every response path, and `display=swap` already bounds the failure mode to the system fallback.
