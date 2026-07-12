import { expect, it } from "vitest";
import * as cp from "../index.js";
it("barrel imports", () => { expect(cp).toBeTypeOf("object"); });
