# Guided investigation across modules

Rooted's current implementation and offline checks are recorded in
[PHASE8_VERIFICATION.md](verification/PHASE8_VERIFICATION.md). CRE integration is deferred;
unavailable policy evidence does not prevent investigation or export. The
browser check below was run on November 6, 2026.

The **Investigate** sidebar view connects a transaction and its execution block to matching PayloadWatch observations, state conflicts, Uniswap findings, related CRE window checks, and downloadable evidence. It reuses the existing analysis/observation APIs; no new backend route or Ethereum-node setup is required.

## Start an investigation

- Select **Investigate**, paste a mined Sepolia transaction hash, and choose **Analyze**. This uses the existing transaction ingestion endpoint to resolve its containing block, collect a native BAL, and select that transaction for supplemental tracing. Fresh analysis requires the configured execution/Beacon APIs.
- Or choose **Open latest saved report** to inspect persisted evidence without new node collection.
- From **BAL analyzer**, select **Investigate this report across modules**. A saved local-fork report keeps its fork network, mode, and chain identity.

The page has anchors for transaction/block identity, payload delivery, shared state, swaps, policy checks, and export. State analysis and export remain usable while optional evidence loads or is unavailable.

## Identity and source preservation

Investigation URLs retain the saved report ID, network, mode, optional transaction hash, and pinned payload source. The transaction must be a member of the report's execution block; mismatches are shown as errors and are not attributed across modules. Fork mode must use the fork network. Scope is explicit in the header and identity panel.

When no source has been pinned, the first optional-evidence lookup discovers the current live collector source and records it in the investigation URL. Subsequent lookups, journal requests, rechecks, and guided exports retain that source, even if the backend's default collector later changes. Source identifiers in the local URL may reveal operator naming; downloaded exports continue replacing them with bundle-local aliases.

Payload states must match execution hash, network, mode, source, and header slot when available. Multiple matching Beacon-root records remain separate; the UI never silently chooses one or infers canonicality. Canonical and execution-validation values retain their own reported/unknown states.

Journal events must match the same network, mode, source, slot, and Beacon root. Events carrying a different execution hash are rejected. The journal read is bounded to the first 200 entries; the table shows at most 12 matching entries, and the evidence dialog retains all matches from that page. Missing events are not reconstructed from polling timestamps.

## Evidence interpretation

- Collector receipt differences include the observation path. They are not global propagation measurements or protocol timeliness verdicts.
- The requested transaction is initially selected in the dependency graph and contention breakdown, including when it falls outside the original 12-node drawing. Storage/all-state controls remain available; the active graph/filter scope remains visible.
- Read attribution, native commitment verification, tracing limitations, and swap verification keep their existing report-specific semantics. No conflict is invented from shared addresses alone.
- CRE links require an exact scoped summary identity containing the matched observation's slot, Beacon root, and execution hash. A related policy report concerns that observation window, not the individual transaction. Simulation, receiver authentication, and policy-chain identity remain separate from the monitored execution network.
- Export reuses the pinned payload source and existing field allowlists/redactions. It does not serialize private endpoint details or unknown operator fields.

## Partial and unavailable evidence

Optional lookups currently support live Sepolia only. Fork, captured, replay, and synthetic analysis still display their own identities and remain useful; unsupported payload/policy joins are explicit.

Payload lookup uses the header slot where available, otherwise up to 200 recent observations. CRE lookup covers at most 100 reports and 10 distinct summaries. Missing results mean no match was established within those limits, not that no evidence exists. Optional lookup has a 30-second shared timeout. A matched payload can remain useful if its journal is unavailable, and a report can remain useful without payload or policy matches. **Recheck linked evidence** retries within the same pinned source.

The workflow uses ordinary backend traffic, not Anon-RPC. No wallet, signing, staking keys, or onchain transaction submission is needed.

## Verification — November 6, 2026

- `npm run typecheck` passed and `npm test --prefix dashboard` passed 52 of 52
  tests. They include URL scope/identity checks, fork-mode preservation,
  mismatched transaction rejection, pinned-source behavior after collector
  changes, competing root retention, journal scope/root/hash filtering, explicit
  unavailable/empty states, and export correlation.
- Browser check against the production build and a live backend
  ([capture](../demo/phase6/investigate-browser.txt)): **Open latest saved
  report** opened native report `0xd384…a364` for Sepolia block 12,075,378 and
  focused transaction index 82
  (`0x4a32623f9cc2e432e77e3d0ec267d64b87fc21a0ee38960563881844389cc72f`, a
  Uniswap v3 swap). It matched the stored payload observation for slot
  11518333 in source `sepolia-nimbus-geth-1` with 2 matching journal events,
  and showed no established policy check within the search bounds.
- That report was collected with `rooted analyze` on the CLI, and slot
  11518333 was ingested with `POST /api/v1/slots/11518333/ingest` before the
  check. The **Analyze** button in the Investigate view, which calls the same
  transaction ingestion endpoint, was not clicked in this run.
