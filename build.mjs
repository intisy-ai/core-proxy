import { build } from "esbuild";
await build({ bundle: true, platform: "node", format: "esm", target: "node20",
  entryPoints: ["src/index.ts"], outfile: "dist/index.js", logLevel: "info" });
