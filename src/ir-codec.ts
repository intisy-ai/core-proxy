// The app-wire <-> canonical-IR codec shared by the proxy daemon route loop and the in-process
// serveIr entry. Given a profile's translator: decode an inbound wire body to IR, encode an IR
// result back to the wire, and reconstruct a Response from a typed HandleIrError.

import { isHandleIrError } from "./types.js";
import type { IrEventStream, IrRequest, IrResponse, RoutingProfile } from "./types.js";

export async function decodeIr(profile: RoutingProfile, request: Request, log: (m: string) => void): Promise<IrRequest | null> {
  if (!profile.translator) return null;
  try {
    const bodyText = await request.clone().text();
    if (!bodyText) return null;
    return await profile.translator.decodeRequest(bodyText);
  } catch (e) {
    log("IR decode failed, falling back to wire routing: " + ((e as Error)?.message));
    return null;
  }
}

export async function encodeIrResult(profile: RoutingProfile, irResult: IrResponse | IrEventStream): Promise<Response> {
  const translator = profile.translator!;
  if (irResult instanceof ReadableStream) {
    const encodeStream = await translator.encodeStream();
    const byteStream = irResult.pipeThrough(encodeStream).pipeThrough(new TextEncoderStream());
    return new Response(byteStream, { status: 200, headers: { "content-type": "text/event-stream" } });
  }
  const wire = await translator.encodeResponse(irResult);
  return new Response(wire, { status: 200, headers: { "content-type": "application/json" } });
}

export function handleIrErrorToResponse(e: unknown): Response | null {
  if (!isHandleIrError(e)) return null;
  const headers = new Headers(e.headers);
  if (e.retryAfterMs != null && !headers.has("x-hub-retry-after-ms")) {
    headers.set("x-hub-retry-after-ms", String(e.retryAfterMs));
  }
  return new Response(e.body, { status: e.status, headers });
}
