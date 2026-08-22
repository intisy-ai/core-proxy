import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const repo = fileURLToPath(new URL("../..", import.meta.url));

function contractFiles(dir: string): string[] {
  // src/generated also holds the TeaVM bundle, which this emission does not produce.
  return readdirSync(dir).filter((name) => name.startsWith("proxy-contracts")).sort();
}

it("keeps the committed front-door key identical to what the java emits", () => {
  const scratch = mkdtempSync(join(tmpdir(), "proxy-contracts-"));
  execFileSync(process.execPath, [
    join(repo, "core-ir", "api", "scripts", "emit-dts.mjs"),
    "--java-dir", join(repo, "java"),
    "--module", ":proxy-contracts",
    "--module-dir", "proxy-contracts",
    "--out", scratch,
  ], { cwd: repo, stdio: "inherit" });

  const emitted = contractFiles(scratch);
  const committed = contractFiles(join(repo, "src", "generated"));
  expect(emitted).toEqual(committed);
  for (const name of emitted) {
    expect(readFileSync(join(scratch, name), "utf8")).toBe(
      readFileSync(join(repo, "src", "generated", name), "utf8"),
    );
  }
});
