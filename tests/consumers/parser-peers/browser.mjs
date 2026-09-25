import { experimentalParseKaladaV1GuestExpressionPrefix } from "@kalada/syntax";
import { kaladaGuest, request, router, tiny } from "./peers.mjs";

const host = router([tiny, kaladaGuest(experimentalParseKaladaV1GuestExpressionPrefix)]);
const first = host.compose(request('🚀{"}" + 1}TAIL', 2, "kalada"));
const second = host.compose(request("{12+3}TAIL", 0, "tiny"));
const bad = host.compose(request("{a //comment}TAIL", 0, "kalada"));
if (
  first.status !== "valid" ||
  second.status !== "valid" ||
  bad.status !== "unsupported" ||
  bad.reason !== "unsupported-comment" ||
  bad.tree !== undefined ||
  bad.diagnostics[0]?.code !== "KALADA_SYNTAX_UNSUPPORTED_FORM" ||
  bad.diagnostics[0]?.range.start !== 3
) {
  throw new Error("Packed browser composition failed");
}
globalThis.peerBrowserOutcome = "passed";
