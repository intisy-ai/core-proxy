import { decodeIr, encodeIrResult, handleIrErrorToResponse } from "./ir-codec.js";
import type { FrontDoorCapability, IrEventStream, IrRequest, IrResponse, RoutingProfile } from "./types.js";

export type { FrontDoorCapability } from "./types.js";

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
