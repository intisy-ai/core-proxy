// The in-process app front-door: one provider, no routing. Decodes the app's wire request to
// canonical IR via the profile's translator, calls the provider's IR-native handleIr, encodes the
// result back to the app's wire. The out-of-process daemon (createProxyServer) adds routing and
// rate-limit fallback on top of the same codec; this is the transport an app-proxy exposes for the
// no-daemon path.

import { decodeIr, encodeIrResult, handleIrErrorToResponse } from "./ir-codec.js";
import type { HandlerCtx, IrEventStream, IrRequest, IrResponse, RoutingProfile } from "./types.js";

export interface ServeIrOptions {
  profile: RoutingProfile;
  handleIr: (ir: IrRequest, ctx: HandlerCtx) => Promise<IrResponse | IrEventStream>;
  ctx: HandlerCtx;
}

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
