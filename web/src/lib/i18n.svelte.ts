/** Reactive page locale and copy, initialized from the stored preference or browser languages. */
import {
  isLocaleCode,
  locales,
  pickLocale,
  setActiveLocale,
  type Copy,
  type LocaleCode,
} from '$shared/copy';

const STORAGE_KEY = 'infoto-locale';

type Reader = Pick<Storage, 'getItem'>;
type Writer = Pick<Storage, 'setItem'>;

function browserStorage(): Storage | undefined {
  return typeof localStorage === 'undefined' ? undefined : localStorage;
}

/** The user's stored choice if it names a locale this build ships, else the browser default. */
export function detectLocale(storage?: Reader): LocaleCode {
  try {
    const raw = (storage ?? browserStorage())?.getItem(STORAGE_KEY);
    if (isLocaleCode(raw)) return raw;
  } catch {
    // Use the browser locale when storage is unavailable.
  }
  return pickLocale(typeof navigator !== 'undefined' ? navigator.languages : undefined);
}

/** Reflect the locale in `<html lang>` for screen readers and link prefetches. */
function syncLang(code: LocaleCode): void {
  if (typeof document !== 'undefined') document.documentElement.lang = code;
}

/** Resolve the initial locale before creating reactive state. */
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

/** Reactive copy for templates. A shallow root copy protects registered tables when locale groups are replaced. */
export const copy: Copy = $state({ ...locales[initial] });

/** Switch the language immediately and remember the choice. */
export function setLocale(code: LocaleCode, storage?: Writer): void {
  if (!isLocaleCode(code)) return;
  stored = code;
  setActiveLocale(code); // keep plain modules (toasts, api clients) on the same locale
  Object.assign(copy, locales[code]);
  syncLang(code);
  try {
    (storage ?? browserStorage())?.setItem(STORAGE_KEY, code);
  } catch {
    // The locale remains active when persistence is unavailable.
  }
}

/** Native display name for a locale, falling back to its code. */
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
