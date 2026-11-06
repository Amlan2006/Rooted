// Typed views of data/*.json (written by `npm run snapshot` from Rooted's own Sepolia node).
// Annotating each import makes `npm run lint` fail if a snapshot drifts from these shapes.
import heroJson from "../data/hero-block.json";
import blocksJson from "../data/blocks.json";
import epbsJson from "../data/epbs.json";
import pricingJson from "../data/pricing.json";
import metaJson from "../data/meta.json";

/** Every file says where it came from and when (ISO UTC). Show `sourceLine(file)` next to any figure. */
export type Sourced = { source: string; captured_at: string };

export type Tx = { index: number; hash: string; gas_used: number; is_create: boolean; to: string | null };

/** The block's EIP-7928 list, counted per BAL index (0 pre, 1..n txs, n+1 post). Reads have no index: block totals. */
export type AccessList = Sourced & {
  bytes: number;
  accounts: number;
  accounts_read_only: number;
  storage_reads: number;
  storage_writes: number;
  commitment_matches: boolean;
  per_index: { accounts_changed: number[]; slots_written: number[] };
};

/** Fields Nimbus may not have retained are nullable: omit them from the UI when null, never estimate. */
type BeaconFields = {
  slot: number | null;
  beacon_root: string | null;
  proposer_index: number | null;
  builder_index: number | null;
  self_build: boolean | null;
  payload_present_votes: number | null;
  ptc_size: number | null;
};

export type HeroBlock = Sourced &
  BeaconFields & {
    network: string;
    number: number;
    hash: string;
    parent_hash: string;
    tx_count: number;
    gas_limit: number;
    header_gas_used: number;
    receipts_gas_sum: number;
    timestamp: number;
    time: string;
    base_fee_per_gas: number;
    block_access_list_hash: string | null;
    extra_data_text: string | null;
    capping_tx: Tx;
    txs: Tx[];
    access_list: AccessList;
  };

export type TapeBlock = BeaconFields & {
  number: number;
  hash: string;
  parent_hash: string;
  tx_count: number;
  gas_limit: number;
  header_gas_used: number;
  receipts_gas_sum: number;
};

export type Blocks = Sourced & {
  network: string;
  head_at_capture: number;
  from: number;
  to: number;
  ptc_size: number;
  note: string;
  blocks: TapeBlock[];
};

export type Epbs = Sourced & {
  network: string;
  /** "Received at our node: …" Show it wherever offsets appear. */
  label: string;
  slot: number;
  slot_start: string;
  genesis_time: number;
  beacon_root: string;
  block_hash: string;
  block_number: number;
  tx_count: number;
  builder_index: number | null;
  self_build: boolean | null;
  /** Local receipt time in ms after slot start. */
  offsets_ms: {
    block: number;
    execution_payload: number;
    execution_payload_available: number;
    first_ptc_message: number | null;
    last_ptc_message: number | null;
  };
  deadlines_ms: { attestation: number; payload: number; payload_attestation: number; source: string };
  ptc_messages_received: number;
  ptc_validators_seen: number;
  ptc_messages_payload_present: number;
  ptc_note: string;
  included_ptc: { slot: number; payload_present_votes: number; ptc_size: number };
};

export type Pricing = Sourced & {
  /** null: show "Priced per request in the 402 response" and no number. */
  price: { amount_atomic: string; display: string; unit: string } | null;
  network?: string;
  testnet?: boolean;
  asset?: string;
  asset_symbol?: string;
  scheme?: string;
  route?: string;
  configurable_via?: string;
  /** The agent example: a block whose stored X-ray report was bought and settled (HCS audit topic, message 1). */
  stored_report?: { block_number: number; block_hash: string; payment_tx: string; amount_atomic: string; hcs_topic: string; hcs_sequence: number; source: string };
};

export type Meta = Sourced & {
  commit: string;
  license: string;
  repo_url: string;
  go_version: string;
  node_version: string;
  built_at: string;
  docs: { path: string; title: string; url: string }[];
};

export const heroBlock: HeroBlock = heroJson;
export const blocks: Blocks = blocksJson;
export const epbs: Epbs = epbsJson;
export const pricing: Pricing = pricingJson;
export const meta: Meta = metaJson;

export const links = {
  github: meta.repo_url,
  /** Repo-relative path, e.g. doc("docs/API.md"). */
  doc: (path: string) => `${meta.repo_url}/blob/main/${path}`,
  /** The README's docs index (one line of links), not a raw folder listing. */
  docs: `${meta.repo_url}#docs`,
  license: `${meta.repo_url}/blob/main/LICENSE`,
  quickStart: `${meta.repo_url}#quick-start`,
  /** A hosted dashboard, only if the deploy build names one: without it nothing on the page promises an app. */
  dashboard: process.env.NEXT_PUBLIC_DASHBOARD_URL || null,
};
