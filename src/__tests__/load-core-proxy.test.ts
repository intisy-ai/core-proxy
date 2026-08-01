import { expect, it } from "vitest";
import { loadCoreProxy } from "../index.js";

it("loadCoreProxy resolves the generated module and memoizes", async () => {
  const a = await loadCoreProxy();
  const b = await loadCoreProxy();
  expect(a).toBe(b);
  expect(typeof (a as Record<string, unknown>).rateLimitResetMsJson).toBe("function");
});
