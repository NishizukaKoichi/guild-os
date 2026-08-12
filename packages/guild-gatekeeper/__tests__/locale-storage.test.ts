import { describe, expect, it, vi } from "vitest";
import {
  LOCALE_STORAGE_KEY,
  persistLocale,
  readInitialLocale,
} from "../app/locale-storage";

describe("locale storage", () => {
  it("defaults to English when the iframe cannot expose localStorage", () => {
    const host = Object.defineProperty({}, "localStorage", {
      get() {
        throw new DOMException("Opaque origin", "SecurityError");
      },
    });

    expect(readInitialLocale(host)).toBe("en");
    expect(() => persistLocale("ja", host)).not.toThrow();
  });

  it("reads supported values and ignores unsupported values", () => {
    expect(readInitialLocale({ localStorage: {
      getItem: () => "zh-CN",
      setItem: vi.fn(),
    } })).toBe("zh-CN");
    expect(readInitialLocale({ localStorage: {
      getItem: () => "fr",
      setItem: vi.fn(),
    } })).toBe("en");
  });

  it("persists a supported locale when browser storage is available", () => {
    const setItem = vi.fn();
    persistLocale("ja", { localStorage: { getItem: vi.fn(), setItem } });
    expect(setItem).toHaveBeenCalledWith(LOCALE_STORAGE_KEY, "ja");
  });
});
