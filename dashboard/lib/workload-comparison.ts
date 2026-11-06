import type { Graph, Run } from "./data";
import { publicAnalysis } from "./investigation-export";
import { contentionBreakdown } from "./contention";

type Anchor = { number: string; hash: string };
type Receipt = { transactionHash: string; blockHash: string; status: string; transactionIndex: string };
type Input = { hash: string; from: string; to: string; input: string; gas: string; maxFeePerGas: string; maxPriorityFeePerGas: string; nonce: string; value: string };
export type Scenario = { coverage_metadata_complete?: boolean; inputs?: Input[]; name: string; routes: string[]; transactions: string[]; receipts: Receipt[]; report: Run & { network_anchor?: Anchor; block: Run["block"] & { parentHash?: string } } };
export type Comparison = {
  schema: "rooted-workload-comparison-v1"; captured_at: string;
  fork: Anchor; baseline: Anchor;
  settings: { client: string; hardfork: string; order: string; opcode_limit: number; amount_raw: string; gas: string; max_fee: string; priority_fee: string; timestamp: number; accounts: string[]; harnesses: string[] };
  scenarios: [Scenario, Scenario];
};
const hash = (v: unknown): v is string => typeof v === "string" && /^0x[0-9a-f]{64}$/i.test(v);
const address = (v: unknown): v is string => typeof v === "string" && /^0x[0-9a-f]{40}$/i.test(v);
const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === "string");
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function checkGraph(value: unknown) {
  const g = record(value);
  if (!Array.isArray(g.edges) || g.edges.length > 20000 || !Array.isArray(g.observed_layers) ||
      !strings(g.coverage) || !Number.isSafeInteger(g.observed_dependency_depth) || Number(g.observed_dependency_depth) < 0 || !Number.isSafeInteger(g.observed_max_layer_width) || Number(g.observed_max_layer_width) < 0) throw new Error("Missing graph metrics or coverage.");
  for (const edge of g.edges) {
    const e = record(edge), l = record(e.location);
    if (!Number.isSafeInteger(e.from) || !Number.isSafeInteger(e.to) || Number(e.from) < 0 || Number(e.to) <= Number(e.from) ||
        !["RAW", "WAR", "WAW"].includes(String(e.kind)) || !address(l.address) || typeof l.field !== "string" || (l.field === "storage" && !hash(l.key))) throw new Error("Invalid conflict evidence.");
  }
}
// Parse portable bundles locally; allowlisted analysis fields prevent operator metadata from entering the evidence dialog.
export function parseComparison(text: string): Comparison {
  if (text.length > 8_000_000) throw new Error("Comparison file exceeds 8 MB.");
  const raw = record(JSON.parse(text));
  if (raw.schema !== "rooted-workload-comparison-v1" || !Array.isArray(raw.scenarios) || raw.scenarios.length !== 2) throw new Error("Expected a version 1 comparison containing two scenarios.");
  const scenarios: Scenario[] = [];
  for (const value of raw.scenarios) {
    const s = record(value), run = record(s.report);
    if (!strings(s.transactions) || s.transactions.length !== 3 || !s.transactions.every(hash) ||
        !strings(s.routes) || s.routes.length !== 3 || !s.routes.every(address) || !Array.isArray(s.receipts) || s.receipts.length !== 3 || typeof s.name !== "string") throw new Error("Invalid three-swap scenario.");
    if (!hash(run.id) || !hash(record(run.block).hash) || !Array.isArray(record(run.block).transactions) ||
        !Array.isArray(run.analyzed_transactions) || !Array.isArray(run.transaction_access) || !strings(run.coverage)) throw new Error("Missing report identities or transaction coverage.");
    checkGraph(run.graph); checkGraph(run.storage_projection);
    // The exporter tolerates old reports, while comparability below requires explicit evidence.
    const safe = publicAnalysis(run as unknown as Run) as Scenario["report"];
    const coverageMetadata = s.coverage_metadata_complete !== false && [run.graph, run.storage_projection].every(value => {
      const g = record(value); return typeof g.truncated === "boolean" && typeof g.full_dependency_coverage === "boolean" && typeof g.storage_read_coverage_complete === "boolean" && strings(g.coverage);
    }) && (run.transaction_access as unknown[]).every(value => { const a = record(value); return typeof a.storage_reads_complete === "boolean" && strings(a.coverage); }) &&
      (run.analyzed_transactions as unknown[]).every(value => strings(record(value).coverage));
    if (!safe.block.transactions.every(tx => hash(tx.hash)) || !safe.analyzed_transactions?.every(tx => hash(tx.transaction.hash)) ||
        !safe.transaction_access.every(a => hash(a.hash) && Number.isSafeInteger(a.index) && [...a.reads, ...a.writes].every(l => address(l.address) && typeof l.field === "string" && (l.field !== "storage" || hash(l.key)))) ||
        safe.uniswap_pools.some(p => p.verified && (!address(p.address) || !address(p.token0) || !address(p.token1))) ||
        safe.uniswap_swap_calls.some(call => call.pool_verified && (!address(call.pool) || !hash(call.transaction_hash))) ||
        safe.uniswap_swaps.some(swap => swap.pool_verified && (!address(swap.pool) || !hash(swap.transaction_hash)))) throw new Error("Malformed report transaction or protocol evidence.");
    const anchor = record(run.network_anchor);
    safe.network_anchor = hash(anchor.hash) && typeof anchor.number === "string" ? { number: anchor.number, hash: anchor.hash } : undefined;
    const inputs = Array.isArray(s.inputs) ? s.inputs.map(value => { const t = record(value); return Object.fromEntries(["hash", "from", "to", "input", "gas", "maxFeePerGas", "maxPriorityFeePerGas", "nonce", "value"].map(k => [k, typeof t[k] === "string" ? t[k] : ""])) as Input; }) : undefined;
    scenarios.push({ coverage_metadata_complete: coverageMetadata, inputs, name: s.name.slice(0, 80), routes: s.routes, transactions: s.transactions,
      receipts: s.receipts.map(value => { const r = record(value); return Object.fromEntries(["transactionHash", "blockHash", "status", "transactionIndex"].map(k => [k, typeof r[k] === "string" ? r[k] : ""])) as Receipt; }), report: safe });
  }
  const anchor = (value: unknown): Anchor => { const a = record(value); return { number: typeof a.number === "string" && /^0x[0-9a-f]+$/i.test(a.number) ? a.number : "", hash: hash(a.hash) ? a.hash : "" }; };
  const settings = record(raw.settings);
  const safeSettings = Object.fromEntries(["client", "hardfork", "order", "amount_raw", "gas", "max_fee", "priority_fee"].map(k => [k, typeof settings[k] === "string" ? settings[k] : ""]));
  return { schema: raw.schema, captured_at: typeof raw.captured_at === "string" && Number.isFinite(Date.parse(raw.captured_at)) ? raw.captured_at : "Unknown",
    fork: anchor(raw.fork), baseline: anchor(raw.baseline), settings: { ...safeSettings,
      opcode_limit: Number.isSafeInteger(settings.opcode_limit) ? settings.opcode_limit : 0,
      timestamp: Number.isSafeInteger(settings.timestamp) ? settings.timestamp : 0,
      accounts: strings(settings.accounts) ? settings.accounts.filter(address) : [],
      harnesses: strings(settings.harnesses) ? settings.harnesses.filter(address) : [] }, scenarios } as Comparison;
}

export function comparisonIssues(c: Comparison, projection: boolean): string[] {
  const issues: string[] = [];
  const fork = record(c.fork), baseline = record(c.baseline), settings = record(c.settings);
  if (!hash(fork.hash) || typeof fork.number !== "string" || !hash(baseline.hash) || typeof baseline.number !== "string") issues.push("Pinned fork or prepared baseline identity is missing.");
  if (typeof settings.client !== "string" || !settings.client.toLowerCase().includes("anvil") || settings.hardfork !== "prague" || settings.order !== "fifo" || settings.opcode_limit !== 20000 ||
      typeof settings.amount_raw !== "string" || !/^\d{1,78}$/.test(settings.amount_raw) || typeof settings.gas !== "string" || typeof settings.max_fee !== "string" || typeof settings.priority_fee !== "string" || !Number.isSafeInteger(settings.timestamp) ||
      !strings(settings.accounts) || settings.accounts.length !== 3 || !settings.accounts.every(address) || new Set(settings.accounts).size !== 3 ||
      !strings(settings.harnesses) || settings.harnesses.length !== 3 || !settings.harnesses.every(address)) issues.push("Common workload settings are incomplete or unsupported.");
  const signatures: unknown[] = [];
  for (const s of c.scenarios) {
    const r = s.report, g = projection ? r.storage_projection : r.graph;
    if (s.coverage_metadata_complete !== true) issues.push(`${s.name}: explicit coverage metadata is missing.`);
    if (r.network !== "sepolia-fork" || r.mode !== "fork" || r.chain_id !== "31337" || r.native_bal !== null) issues.push(`${s.name}: expected a trace-derived local Sepolia fork report.`);
    if (!same(r.network_anchor, c.fork) || r.block.parentHash !== baseline.hash) issues.push(`${s.name}: fork or baseline does not match.`);
    if (!same(r.block.transactions.map(tx => tx.hash), s.transactions) || new Set(s.transactions).size !== 3 ||
        !same(r.analyzed_transactions?.map(tx => tx.transaction.hash).sort(), [...s.transactions].sort()) ||
        !same(r.transaction_access.map(tx => tx.hash), s.transactions)) issues.push(`${s.name}: exact transaction selection or order does not match.`);
    if (!s.inputs || s.inputs.length !== 3 || s.inputs.some((tx, i) => {
      const input = "0x0545a7cd" + s.routes[i].slice(2).padStart(64, "0") + (typeof settings.amount_raw === "string" && /^\d{1,78}$/.test(settings.amount_raw) ? BigInt(settings.amount_raw).toString(16).padStart(64, "0") : "") + "0".repeat(64);
      return tx.hash !== s.transactions[i] || tx.from !== (settings.accounts as string[] | undefined)?.[i] || tx.to !== (settings.harnesses as string[] | undefined)?.[i] || tx.input.toLowerCase() !== input.toLowerCase() ||
        tx.gas !== settings.gas || !/^0x[0-9a-f]+$/i.test(tx.maxFeePerGas) || BigInt(tx.maxFeePerGas).toString() !== settings.max_fee ||
        !/^0x[0-9a-f]+$/i.test(tx.maxPriorityFeePerGas) || BigInt(tx.maxPriorityFeePerGas).toString() !== settings.priority_fee || tx.value !== "0x0";
    })) issues.push(`${s.name}: actual transaction inputs do not match the common workload settings.`);
    if (s.receipts.some((receipt, i) => receipt.transactionHash !== s.transactions[i] || receipt.blockHash !== r.block.hash || receipt.status !== "0x1" || Number(receipt.transactionIndex) !== i)) issues.push(`${s.name}: successful receipt identities do not match.`);
    if (g.truncated !== false || g.edges.some(e => e.to >= 3) || typeof g.full_dependency_coverage !== "boolean" || typeof g.storage_read_coverage_complete !== "boolean") issues.push(`${s.name}: graph is truncated or coverage is unknown.`);
    const traced = s.transactions.map(hash => r.analyzed_transactions?.find(tx => tx.transaction.hash === hash)).filter(Boolean) as (NonNullable<Run["analyzed_transactions"]>[number] & { call_trace_available?: boolean; state_diff_available?: boolean; opcode_trace_available?: boolean; coverage?: string[] })[];
    if (traced.length !== 3 || traced.some(tx => tx.call_trace_available !== true || tx.state_diff_available !== true || tx.opcode_trace_available !== true)) issues.push(`${s.name}: all three trace types are required for each swap.`);
    // Verify each route against committed, factory-verified swap evidence.
    if (s.routes.some((pool, i) => !r.uniswap_pools.some(p => p.verified && p.address.toLowerCase() === pool.toLowerCase()) ||
        !r.uniswap_swap_calls.some(call => call.transaction_hash === s.transactions[i] && call.pool.toLowerCase() === pool.toLowerCase() && call.pool_verified && call.committed))) issues.push(`${s.name}: declared pool routing lacks committed verified swap evidence.`);
    if ([...g.coverage, ...r.coverage, ...r.transaction_access.flatMap(a => a.coverage), ...traced.flatMap(tx => tx.coverage || [])].includes("unrecognized_coverage_code_omitted")) issues.push(`${s.name}: unrecognized coverage prevents comparison.`);
    signatures.push([g.full_dependency_coverage, g.storage_read_coverage_complete, [...g.coverage].sort(), [...r.coverage].sort(),
      r.transaction_access.map(a => [a.storage_reads_complete, [...a.coverage].sort()]), traced.map(tx => [...(tx.coverage || [])].sort())]);
  }
  if (!same(c.scenarios[0].inputs?.map(tx => tx.nonce), c.scenarios[1].inputs?.map(tx => tx.nonce))) issues.push("Sender nonces differ between scenarios.");
  if (!same(signatures[0], signatures[1])) issues.push("Evidence coverage differs between scenarios; numeric deltas are withheld.");
  const [a, b] = c.scenarios.map(s => s.routes.map(p => p.toLowerCase()));
  if (new Set(a).size !== 1 || new Set(b).size !== 2 || a[0] !== b[0] || a[2] !== b[2]) issues.push("Expected routing A/A/A versus A/B/A.");
  return [...new Set(issues)];
}
export function workloadMetrics(run: Run, projection: boolean) {
  const graph: Graph = projection ? run.storage_projection : run.graph;
  const breakdown = contentionBreakdown(run, graph);
  return { graph, breakdown, metrics: [
    { label: "Location-level conflicts", value: graph.edges.length },
    ...["RAW", "WAR", "WAW"].map(kind => ({ label: kind, value: graph.edges.filter(edge => edge.kind === kind).length })),
    ...breakdown.categories.map(c => ({ label: c.label, value: c.count })),
    { label: "Unit-cost dependency depth", value: graph.observed_dependency_depth },
    { label: "Maximum layer width", value: graph.observed_max_layer_width },
  ] };
}
