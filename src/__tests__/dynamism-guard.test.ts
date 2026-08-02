// Locks the core-libs-stay-generic rule: core-proxy must name no app, vendor, or concrete
// translator. It is the parameterized engine; every app/vendor specific lives in an app-proxy or a
// translator repo. If this fails, a hardcoded literal crept back in.
import { expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN = /\b(anthropic|opencode|claude|gemini|openai|antigravity)\b/i;
const SRC = join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "generated") continue;
      out.push(...sourceFiles(p));
      continue;
    }
    if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

it("core-proxy source names no app, vendor, or concrete translator", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(SRC)) {
    readFileSync(file, "utf-8").split("\n").forEach((line, i) => {
      if (FORBIDDEN.test(line)) offenders.push(file + ":" + (i + 1) + "  " + line.trim());
    });
  }
  expect(offenders, "hardcoded app/vendor literal(s):\n" + offenders.join("\n")).toEqual([]);
});
