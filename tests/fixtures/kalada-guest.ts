import { parseGuestExpressionPrefix } from "../../packages/syntax/src/guest-boundary.js";
import type { Guest } from "./host-profile.js";

export const kaladaGuest: Guest = (source, start, meter) =>
  parseGuestExpressionPrefix(source, start, {
    limits: {
      maxSourceLength: meter.remainingWork,
      maxDiagnostics: meter.remainingDiagnostics,
    },
  });
