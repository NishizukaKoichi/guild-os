import type { AppLocale } from "@guild-os/domain";

export const LOCALE_STORAGE_KEY = "guild-os.locale";

interface LocaleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface StorageHost {
  readonly localStorage?: LocaleStorage;
}

function isAppLocale(value: unknown): value is AppLocale {
  return value === "en" || value === "ja" || value === "zh-CN";
}

export function readInitialLocale(host: StorageHost = globalThis): AppLocale {
  try {
    const stored = host.localStorage?.getItem(LOCALE_STORAGE_KEY);
    return isAppLocale(stored) ? stored : "en";
  } catch {
    // Cloudflare OS intentionally gives embedded apps an opaque origin without localStorage.
    return "en";
  }
}

export function persistLocale(locale: AppLocale, host: StorageHost = globalThis): void {
  try {
    host.localStorage?.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // The authoritative preference is persisted through the Guild API when storage is unavailable.
  }
}
