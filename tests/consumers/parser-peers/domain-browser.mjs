import { profile, request, router, tiny } from "./peers.mjs";

const result = router([tiny], [profile(["tiny"], "tiny")]).compose(request("🚀{12+3}tail", 2));
if (result.status !== "valid") throw Error("Neutral browser composition failed");
globalThis.peerBrowserOutcome = "passed";
