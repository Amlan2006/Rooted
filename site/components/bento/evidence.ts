// Recorded runs the bento shows that the node snapshot does not cover. data/evidence.json copies them verbatim from
// the repo's demo evidence files; tests/evidence.test.mjs fails if any value drifts from those files.
import evidence from "../../data/evidence.json";

export const { profile, frame, providers } = evidence;
