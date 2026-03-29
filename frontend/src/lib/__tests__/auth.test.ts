import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The auth module checks `typeof window`, so we need to provide a minimal DOM env.
// Since vitest is configured with environment: "node", we mock localStorage directly.

describe("auth – store()", () => {
  let originalWindow: typeof globalThis.window;

  beforeEach(() => {
    // Provide a minimal window + localStorage mock
    originalWindow = globalThis.window;
    const storage = new Map<string, string>();
    // @ts-expect-error – partial window mock for SSR-safe auth module
    globalThis.window = {};
    globalThis.localStorage = {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, v),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
      get length() { return storage.size; },
      key: () => null,
    };
  });

  afterEach(() => {
    globalThis.window = originalWindow;
    vi.resetModules();
  });

  it("reads and writes using the correct key", async () => {
    const { store } = await import("../auth");

    // Write a token
    store("adminToken", "test-token-123");
    expect(store("adminToken")).toBe("test-token-123");

    // Wrong key returns null
    expect(store("token")).toBeNull();
  });

  it("getAdminToken reads from 'adminToken' key specifically", async () => {
    const { store, getAdminToken } = await import("../auth");

    // Set token under the correct key
    store("adminToken", "my-admin-token");

    // Mock window.location to prevent redirect
    Object.defineProperty(window, "location", {
      value: { href: "", pathname: "/codes" },
      writable: true,
      configurable: true,
    });

    expect(getAdminToken()).toBe("my-admin-token");
  });

  it("getAdminToken returns null and redirects when no token", async () => {
    const { getAdminToken } = await import("../auth");

    Object.defineProperty(window, "location", {
      value: { href: "", pathname: "/codes" },
      writable: true,
      configurable: true,
    });

    const result = getAdminToken();
    expect(result).toBeNull();
    expect(window.location.href).toContain("/sudo");
  });
});
