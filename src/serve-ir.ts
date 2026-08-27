// The in-process app front-door: one provider, no routing. Decodes the app's wire request to
// canonical IR via the profile's translator, calls the provider's IR-native handleIr, encodes the
// result back to the app's wire. The out-of-process daemon (createProxyServer) adds routing and
// rate-limit fallback on top of the same codec; this is the transport an app-proxy exposes for the
// no-daemon path.

import { decodeIr, encodeIrResult, handleIrErrorToResponse } from "./ir-codec.js";
import type { HandlerCtx, IrEventStream, IrRequest, IrResponse, RoutingProfile } from "./types.js";

/** What the in-process front door needs to serve one provider. */
export interface ServeIrOptions {
  /** The profile whose translator owns this app's wire format. */
  profile: RoutingProfile;
  /** The provider's IR-native entry point. */
  handleIr: (ir: IrRequest, ctx: HandlerCtx) => Promise<IrResponse | IrEventStream>;
  /** The per-request runtime handed to the provider. */
  ctx: HandlerCtx;
}

/**
 * Serves one request against a single provider, with no routing.
 *
 * @param request the request as the app sent it
 * @param opts the profile, handler and runtime to serve it with
 * @returns the response in the app's wire format, a 400 when the body does not decode, or the
 * reconstructed upstream response when the handler threw a transport error
 */
export async function serveIr(request: Request, opts: ServeIrOptions): Promise<Response> {
  const log = opts.ctx?.log ?? (() => {});
  const ir = await decodeIr(opts.profile, request, log);
  if (!ir) {
    return new Response(
      JSON.stringify({ error: { type: "invalid_request_error", message: "request body is not valid for this app's wire format" } }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }
  try {
    const irResult = await opts.handleIr(ir, opts.ctx);
    return await encodeIrResult(opts.profile, irResult);
  } catch (e) {
    const reconstructed = handleIrErrorToResponse(e);
    if (reconstructed) return reconstructed;
    throw e;
  }
}
