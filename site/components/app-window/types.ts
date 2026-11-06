import type { Epbs } from "@/lib/data";

/** One brief from GET /api/analyst/briefs (data/analyst-hero.json). */
export type Brief = {
  block_number: number;
  block_hash: string;
  created_at: string;
  triggers: string[];
  brief: string;
  evidence: { id: string; kind: string; label: string; sha256: string }[];
  model: string;
  /** Only the featured brief (data/analyst.json) carries these: the x402 payment for the report it cites, and its HCS record. */
  payment?: { result: string; network: string; amount_tinybars: number; report_sha256: string };
  hcs?: { topic: string; sequence: number };
};

/** What the tour's four views draw, trimmed on the server from data/*.json. `captured` is each file's ISO UTC capture time. */
export type TourData = {
  captured: string;
  epbs: {
    captured: string;
    slot: number;
    block: number;
    txs: number;
    builder: string | null;
    beaconRoot: string;
    blockHash: string;
    offsets: Epbs["offsets_ms"];
    deadlines: Epbs["deadlines_ms"];
    ptcSeen: number;
    included: Epbs["included_ptc"];
  };
  blocks: {
    captured: string;
    rows: { n: number; txs: number; gas: number; limit: number; builder: string | null; ptc: number | null; size: number | null }[];
  };
  xray: {
    captured: string;
    number: number;
    hash: string;
    slot: number | null;
    builder: number | null;
    extra: string | null;
    header: number;
    receipts: number;
    limit: number;
    /** gas_used per tx, in block order. */
    gas: number[];
    creates: number[];
    hashes: string[];
    cap: number;
  };
  bal: {
    captured: string;
    hash: string | null;
    matches: boolean;
    bytes: number;
    accounts: number;
    readOnly: number;
    reads: number;
    writes: number;
    /** Per BAL index: 0 is pre-execution, 1..n are txs 0..n-1, n+1 is post-execution. */
    writesPer: number[];
    accountsPer: number[];
  };
  /** Newest first; the view opens on the first. */
  analyst: { captured: string; briefs: Brief[] };
};
