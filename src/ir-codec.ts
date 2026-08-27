// The app-wire <-> canonical-IR codec shared by the proxy daemon route loop and the in-process
// serveIr entry. Given a profile's translator: decode an inbound wire body to IR, encode an IR
// result back to the wire, and reconstruct a Response from a typed HandleIrError.

import { isHandleIrError } from "./types.js";
import type { IrEventStream, IrRequest, IrResponse, RoutingProfile } from "./types.js";

/**
 * Decodes an inbound wire request into canonical IR.
 *
 * @param profile the profile whose translator owns this app's wire format
 * @param request the request as the app sent it
 * @param log where a decode failure is reported
 * @returns the IR request, or null when the profile has no translator, the body is empty, or the
 * decode failed, each of which sends the caller down the wire path instead
 */
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

/**
 * Encodes an IR result back into the app's wire format.
 *
 * @param profile the profile whose translator owns this app's wire format
 * @param irResult a buffered response or a stream of IR events
 * @returns a JSON response, or an event-stream response when the result was a stream
 */
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

/**
 * Rebuilds a wire response from a typed transport error, so the router can route on it.
 *
 * @param e whatever a handler threw
 * @returns the reconstructed response, with the retry hint injected when the thrower supplied one,
 * or null when the throw was not a transport error and is a genuine failure
 */
export function handleIrErrorToResponse(e: unknown): Response | null {
  if (!isHandleIrError(e)) return null;
  const headers = new Headers(e.headers);
  if (e.retryAfterMs != null && !headers.has("x-hub-retry-after-ms")) {
    headers.set("x-hub-retry-after-ms", String(e.retryAfterMs));
  }
  return new Response(e.body, { status: e.status, headers });
}
