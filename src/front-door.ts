import { decodeIr, encodeIrResult, handleIrErrorToResponse } from "./ir-codec.js";
import type { IrEventStream, IrRequest, IrResponse, RoutingProfile } from "./types.js";

/**
 * Owns one app's wire format, structurally identical to api's `FrontDoorCapability`.
 *
 * @remarks
 * Mirrored rather than imported: core-proxy carries only `core-ir` as a submodule and cannot resolve
 * `@intisy-ai/api` the way a plugin repo does through its nested `core/api`. TypeScript matches by
 * shape, so a value built here satisfies api's interface with no cast.
 */
export interface FrontDoorCapability {
  decode(request: Request): Promise<IrRequest | null>;
  encode(result: IrResponse | IrEventStream): Promise<Response>;
  encodeError(error: unknown): Response | null;
}

/**
 * The `front-door` capability for one routing profile.
 *
 * @remarks
 * A profile with no translator decodes to null rather than failing, because a wire-only profile is a
 * supported shape: the engine then routes through a handler's own `handle()`.
 *
 * @param profile - the app profile whose translator owns this wire format
 * @param log - where a decode failure is reported; silent by default
 */
export function frontDoor(profile: RoutingProfile, log: (m: string) => void = () => {}): FrontDoorCapability {
  return {
    decode: (request: Request) => decodeIr(profile, request, log),
    encode: (result: IrResponse | IrEventStream) => encodeIrResult(profile, result),
    encodeError: (error: unknown) => handleIrErrorToResponse(error),
  };
}
