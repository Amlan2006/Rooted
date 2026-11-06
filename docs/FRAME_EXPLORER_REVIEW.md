# Frame explorer review and product boundary

The upstream explorer already exposes pool filters, accepted/rejected/included/
replaced/dropped outcomes, per-rule admission checks, frame decoding, lifecycle
timestamps, and node-relative views. The 2026-11-06 collection run stored
admissions with `accepted`, `rejected`, `included`, and `dropped` outcomes.
No `replaced` outcome was observed. Rooted keeps the
explorer's explanations as upstream evidence and does not invent a second
admission policy.

What Rooted adds in Phase 4 is durable, scope-aware archival and comparison:

1. Store admission snapshots and retained lifecycle events by network, node,
   boot ID, sequence, and transaction hash.
2. Preserve restart and history-eviction gaps as incidents.
3. Keep submission acknowledgments, admission reports, reported inclusion, and
   canonical execution receipt proof as separate facts.
4. Compare saved outcomes by rule, frame index, and entity, distinguishing a
   newly failed rule from a check that became unavailable.
5. Keep frame limits as budgets and measured receipt gas as a different field.

The explorer's timestamps are observations from the source node's clock.
Differences across gateway and miner do not become an exact propagation
measurement without a clock-synchronization basis. For example, in the
2026-11-06 probe (`demo/phase1/reference/frame-probe/*_admissions.json`),
the miner's admission time for `0x0cd83f6a...` is 2.8 s later than the
gateway's. For `0x794a03f1...` it is 1.4 s earlier. A frame receipt or a source
inclusion report also does not replace a canonical execution receipt check.

The receipt check is not independent of the miner operator. The default
execution endpoint (`https://altmempool.forshtat.com`) is served by the same
host as the miner explorer.

The 2026-11-06 evidence (`docs/FRAME_DEVNET_TEST.md`) does not support claims
of a funded Rooted submission, universal admission behavior, or an independent
consensus proof. These remain explicit evidence boundaries in the API and
status reports.
