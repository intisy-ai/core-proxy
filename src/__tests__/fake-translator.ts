import type { IrRequest, IrResponse, IrStreamEvent, VendorTranslator } from "@intisy-ai/core-ir";

/**
 * A deterministic {@link VendorTranslator} for exercising core-proxy's own codec/routing logic
 * without a concrete vendor's wire format. Decode/encode are plain JSON; the stream methods return
 * real TransformStreams so the streaming path is genuinely piped rather than stubbed away. Round-tripping
 * an actual vendor's wire syntax is that vendor's own `*-translator` repo's job, not core-proxy's.
 */
export function makeFakeTranslator(): VendorTranslator {
  return {
    async decodeRequest(wireJson: string): Promise<IrRequest> {
      return JSON.parse(wireJson);
    },
    async encodeRequest(request: IrRequest): Promise<string> {
      return JSON.stringify(request);
    },
    async decodeResponse(wireJson: string): Promise<IrResponse> {
      return JSON.parse(wireJson);
    },
    async encodeResponse(response: IrResponse): Promise<string> {
      return JSON.stringify(response);
    },
    async decodeStream(): Promise<TransformStream<Uint8Array | string, IrStreamEvent>> {
      const textDecoder = new TextDecoder();
      return new TransformStream({
        transform(chunk, controller) {
          const text = typeof chunk === "string" ? chunk : textDecoder.decode(chunk, { stream: true });
          controller.enqueue(JSON.parse(text));
        },
      });
    },
    async encodeStream(): Promise<TransformStream<IrStreamEvent, string>> {
      return new TransformStream({
        transform(event, controller) {
          controller.enqueue(JSON.stringify(event) + "\n");
        },
      });
    },
  };
}
