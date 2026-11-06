import { blocks, epbs, heroBlock } from "@/lib/data";
import { shortHash } from "@/lib/format";
import analystJson from "@/data/analyst-hero.json";
import featuredJson from "@/data/analyst.json";
import { Tour } from "./tour";
import type { Brief, TourData } from "./types";

const analyst: { source: string; captured_at: string; briefs: Brief[] } = analystJson;
// The brief the Analyst section replays (with its x402 payment and HCS record) is in the list, but the tour opens on the
// newest brief, so the two never show the same one.
const f = featuredJson;
const featured: Brief = {
  block_number: f.block_number,
  block_hash: f.block_hash,
  created_at: f.created_at,
  triggers: f.triggers,
  brief: f.brief,
  evidence: f.evidence.map(({ id, kind, label, sha256 }) => ({ id, kind, label, sha256 })),
  model: f.model,
  payment: { result: f.payment.result, network: f.payment.network, amount_tinybars: f.payment.amount_tinybars, report_sha256: f.payment.report_sha256 },
  hcs: { topic: f.hcs.topic, sequence: f.hcs.sequence },
};
const briefs = [featured, ...analyst.briefs.filter((b) => b.block_hash !== featured.block_hash).slice(0, 5)].sort((a, b) =>
  b.created_at.localeCompare(a.created_at),
);

/**
 * The hero's product tour. Trims the snapshot files to what the four views draw, so only a few KB of data
 * crosses to the client instead of every data/*.json file.
 */
export function AppTour() {
  const b = heroBlock;
  const al = b.access_list;
  const data: TourData = {
    captured: b.captured_at,
    epbs: {
      captured: epbs.captured_at,
      slot: epbs.slot,
      block: epbs.block_number,
      txs: epbs.tx_count,
      builder: epbs.self_build ? "self-built" : epbs.builder_index === null ? null : `#${epbs.builder_index}`,
      beaconRoot: shortHash(epbs.beacon_root),
      blockHash: shortHash(epbs.block_hash),
      offsets: epbs.offsets_ms,
      deadlines: epbs.deadlines_ms,
      ptcSeen: epbs.ptc_messages_received,
      included: epbs.included_ptc,
    },
    blocks: {
      captured: blocks.captured_at,
      rows: blocks.blocks.map((r) => ({
        n: r.number,
        txs: r.tx_count,
        gas: r.header_gas_used,
        limit: r.gas_limit,
        builder: r.self_build ? "self-built" : r.builder_index === null ? null : `#${r.builder_index}`,
        ptc: r.payload_present_votes,
        size: r.ptc_size,
      })),
    },
    xray: {
      captured: b.captured_at,
      number: b.number,
      hash: shortHash(b.hash),
      slot: b.slot,
      builder: b.builder_index,
      extra: b.extra_data_text,
      header: b.header_gas_used,
      receipts: b.receipts_gas_sum,
      limit: b.gas_limit,
      gas: b.txs.map((t) => t.gas_used),
      creates: b.txs.filter((t) => t.is_create).map((t) => t.index),
      hashes: b.txs.map((t) => shortHash(t.hash)),
      cap: b.capping_tx.index,
    },
    bal: {
      captured: al.captured_at,
      hash: b.block_access_list_hash ? shortHash(b.block_access_list_hash) : null,
      matches: al.commitment_matches,
      bytes: al.bytes,
      accounts: al.accounts,
      readOnly: al.accounts_read_only,
      reads: al.storage_reads,
      writes: al.storage_writes,
      writesPer: al.per_index.slots_written,
      accountsPer: al.per_index.accounts_changed,
    },
    analyst: {
      captured: f.captured_at > analyst.captured_at ? f.captured_at : analyst.captured_at,
      briefs,
    },
  };
  return <Tour data={data} />;
}
