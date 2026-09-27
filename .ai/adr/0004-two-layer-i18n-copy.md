# 0004: Two-Layer i18n Copy — Reactive `$state` for Components, Live Proxy for Modules

- **Date**: 2026-09-27
- **Status**: Accepted
- **Context**: User-facing strings lived in a single `copy` object resolved once at module load. That could not support a runtime language switch, and it had no plural rules (English rendered "1 minutes ago"). A naive fix — make `copy` swappable and re-render — collides with two Svelte 5 facts: a `Proxy` read carries **no** reactive dependency, and `$derived` **cannot be exported from a module** (`derived_invalid_export`). So the obvious designs are both unavailable.
- **Decision**: Two exports of the same tables, each for a different consumer.
  - `web/src/lib/i18n.svelte.ts` exports `copy` as a **shallow-copied `$state` object** (`$state({ ...locales[initial] })`). Components import this; a template reading `copy.<group>.<key>` is subscribed and re-renders on a switch.
  - `src/shared/copy.ts` exports `copy` as a **`new Proxy` live view** over `locales[active]`, switched by `setActiveLocale()`. Pure modules (toast, api clients, upload pipeline) read it at call time, so they track the locale with zero call-site changes.
  - Plural forms are `PluralMessage` (`{ other } & Partial<Record<'one'|'two'|'few'|'many', string>>`) resolved through `Intl.PluralRules`; the Worker and the page share one table set.
  - Locale keys are **full BCP-47 tags** (`en-US`, `zh-CN`) and `pickLocale` is an exact lookup — no subtag folding, pinned by test.
- **Consequences**:
  - Adding a language = write one `Copy` table + add a row to `locales`; `LocaleCode` is derived, nothing else changes.
  - Components **must not** import the Proxy (it will not re-render) and modules **must not** import the `$state` (a template-free read of a `$state` proxy outside an effect is fine but the import is the wrong dependency direction). The two-layer split is the cost.
  - `$state` **deep-proxies and writes through** into whatever it is given, so the table must be shallow-copied or `setLocale` permanently corrupts `locales`. Guarded by a regression test that stringifies `locales` around a switch.
  - Module-level constant tables of copy (e.g. the upload error maps) freeze the language at import time; they must store `(c: Copy) => string` and read lazily.
- **Alternatives considered**:
  - _Export a `$derived`_: rejected — `derived_invalid_export` at compile time.
  - _Make the page re-import the module on switch_: rejected — no clean invalidation story, and it would churn every plain module.
  - _Store copy in a Svelte context_: rejected — plain modules outside a component tree could not read it.
