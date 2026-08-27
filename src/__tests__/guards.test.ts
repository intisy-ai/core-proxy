import { guardDocumentation, guardGeneratedSurface, guardNoSuppressions } from "@intisy-ai/api/testing";

guardDocumentation({ dir: new URL("..", import.meta.url) });
guardNoSuppressions({ dir: new URL("..", import.meta.url) });
guardGeneratedSurface({
  files: [
    new URL("../generated/proxy-contracts.keys.ts", import.meta.url),
    new URL("../generated/core-proxy.teavm.d.ts", import.meta.url),
  ],
});
