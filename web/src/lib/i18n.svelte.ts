/**
 * The page's active locale: one reactive handle over the `locales` tables in `$shared/copy`.
 * Components read `copy.<group>.<key>` in their templates and re-render when the locale
 * changes; plain modules (toasts, api clients) read the same derived value at call time,
 * which is always the current table.
 *
 * Resolution: a user choice persisted under `infoto-locale` wins, otherwise the browser's
 * `navigator.languages`. It lives in its own key rather than the settings blob because it
 * is a global preference, not a photo filter or layout — settings.ts keeps its own version
 * tag for the shape of that blob.
 */
import { locales, pickLocale, setActiveLocale, type Copy, type LocaleCode } from '$shared/copy';

const STORAGE_KEY = 'infoto-locale';

type Reader = Pick<Storage, 'getItem'>;
type Writer = Pick<Storage, 'setItem'>;

/** Storage is absent in SSR/worker contexts and may be blocked in private mode. */
function currentReader(storage: Reader | undefined): Reader | undefined {
  return storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage);
}

function currentWriter(storage: Writer | undefined): Writer | undefined {
  return storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage);
}

function isLocaleCode(value: unknown): value is LocaleCode {
  return typeof value === 'string' && value in locales;
}

/** The user's stored choice if it names a locale this build ships, else the browser default. */
export function detectLocale(storage?: Reader): LocaleCode {
  const store = currentReader(storage);
  if (store) {
    let raw: string | null = null;
    try {
      raw = store.getItem(STORAGE_KEY);
    } catch {
      /* storage blocked */
    }
    if (isLocaleCode(raw)) return raw;
  }
  return pickLocale(typeof navigator !== 'undefined' ? navigator.languages : undefined);
}

/** Reflect the locale in `<html lang>` for screen readers and link prefetches. */
function syncLang(code: LocaleCode): void {
  if (typeof document !== 'undefined') document.documentElement.lang = code;
}

/**
 * The locale at module load. Read once, before `stored` exists, so the initial table
 * is picked from a plain value rather than from reactive state (referencing `$state`
 * at module top level is what Svelte warns about).
 */
const initial: LocaleCode = detectLocale();

let stored = $state<LocaleCode>(initial);
// The detected locale is a real choice too: a persisted one must also become the
// module-level view, which `$shared/copy` initialised from `navigator.languages`.
setActiveLocale(initial);
syncLang(initial);

/** The active locale code. */
export function getLocale(): LocaleCode {
  return stored;
}

/**
 * The table components render from. A `$state` object rather than a `$derived`:
 * Svelte forbids exporting derived state from a module, and a derived would have to
 * be reached through a getter anyway. Because it is `$state`, a template reading
 * `copy.<group>.<key>` is subscribed and re-renders when `setLocale` swaps the groups.
 * The plain `copy` view in `$shared/copy` cannot do that — a proxy read has no
 * dependency.
 *
 * The spread matters: `$state` deep-proxies what it is given, so handing it a table
 * directly would make `setLocale`'s write land *inside* `locales` and permanently
 * corrupt that locale. One level of copying means the groups are swapped by reference
 * and the tables stay read-only.
 */
export const copy: Copy = $state({ ...locales[initial] });

/** The current table, for call sites that read it outside a template. */
export function getCopy(): Copy {
  return locales[stored];
}

/** Switch the language immediately and remember the choice. */
export function setLocale(code: LocaleCode, storage?: Writer): void {
  if (!isLocaleCode(code)) return;
  stored = code;
  setActiveLocale(code); // keep plain modules (toasts, api clients) on the same locale
  Object.assign(copy, locales[code]);
  syncLang(code);
  const store = currentWriter(storage);
  if (store) {
    try {
      store.setItem(STORAGE_KEY, code);
    } catch {
      /* storage blocked or full: the choice still applies for this session */
    }
  }
}

/** Native display name of one locale (`zh-CN` → 中文（简体）); the code itself as a last resort. */
function nativeLabel(code: LocaleCode): string {
  try {
    return new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** What the language selector offers — each option labelled in its own language. */
export const LOCALE_OPTIONS: ReadonlyArray<{ code: LocaleCode; label: string }> = (
  Object.keys(locales) as LocaleCode[]
).map((code) => ({ code, label: nativeLabel(code) }));
