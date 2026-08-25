import { expect, it } from "vitest";
import { initCoreProxy, getCoreProxy } from "../core-proxy-loader.js";

it("getCoreProxy throws before initCoreProxy has run", () => {
  // This test file must not have called initCoreProxy yet: it runs standalone (no shared
  // beforeAll), so the module-level state is fresh.
  expect(() => getCoreProxy()).toThrow(/not initialized/);
});

it("initCoreProxy resolves the generated module once and getCoreProxy reads it back synchronously", async () => {
  await initCoreProxy();
  const a = getCoreProxy();
  await initCoreProxy();
  const b = getCoreProxy();
  expect(a).toBe(b);
  expect(typeof (a as Record<string, unknown>).routeRequest).toBe("function");
});
