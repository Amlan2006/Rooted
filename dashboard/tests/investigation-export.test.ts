import { test } from "node:test";
import assert from "node:assert/strict";
import type { Run } from "../lib/data";
import { buildInvestigation, investigationMarkdown } from "../lib/investigation-export";
import { collectInvestigationLinks, type LinkedEvidence } from "../lib/investigation-links";
const hash = (digit: string) => "0x" + digit.repeat(64);
const address = "0x" + "1".repeat(40);
const tx = [hash("a"), hash("b")];
const location = { address, field: "storage", key: hash("0") };
function report(): Run {
 const graph = { edges: [{ from: 0, to: 1, kind: "WAW", location, basis: "attributed_read_and_committed_change_evidence" }], truncated: false, observed_conflict_counts: { WAW: 1 }, observed_layers: [[0],[1]], observed_dependency_depth: 2, observed_max_layer_width: 1, full_dependency_coverage: false, storage_read_coverage_complete: false, theoretical_speedup: null, coverage: ["observed_evidence_graph_not_a_complete_execution_schedule"] };
 return { id: hash("c"), network: "sepolia", mode: "live", chain_id: "11155111", created_at: "2026-11-06T00:00:00Z", canonical_at_fetch: null, block: { hash: hash("d"), number: "0x123", slotNumber: "0x10", transactions: tx.map(hash => ({ hash })) },
 native_bal: { accounts: 1, commitment_verified: null, computed_commitment: hash("e") }, graph, storage_projection: graph,
 transaction_access: tx.map((hash,index) => ({ hash, index, reads: [], writes: [location], storage_reads_complete: false, coverage: ["native_bal_has_no_per_transaction_read_history"] })),
 sources: [{ kind: "eth_getBlockByHash:" + hash("d"), origin: "https://operator.invalid", fetched_at: "2026-11-06T00:00:00Z" }], coverage: ["unselected_transactions_have_no_attributed_read_trace"], uniswap_pools: [], uniswap_swaps: [], uniswap_swap_calls: [] };
}
const emptyLinks = (): LinkedEvidence => ({ payloadStatus: "unavailable", policyStatus: "unavailable", payloads: [], policies: [], search: { payloadLimit: 200, policyLimit: 100, summaryLimit: 10, summariesChecked: 0, summaryFailures: 0 } });
const observation = () => ({ network: "sepolia", mode: "live", source_id: "private-operator", slot: "16", block_root: hash("f"), payload_hash: hash("d"), reveal_latency_ms: null });

test("versioned bundles preserve unknowns, false values, exact identities and evidence pointers", () => {
 const run = report(); const bundle = buildInvestigation(run, true, null, emptyLinks(), "2026-11-06T01:00:00Z");
 assert.equal(bundle.schema_version, "1.0.0");
 assert.equal(bundle.analysis.id, run.id); assert.equal(bundle.analysis.block.hash, run.block.hash);
 assert.equal(bundle.analysis.canonical_at_fetch, null); assert.equal(bundle.analysis.native_bal!.commitment_verified, null);
 assert.equal(bundle.analysis.storage_projection.truncated, false);
 assert.equal(bundle.selection.denominator, 1); assert.equal(bundle.findings.length, 1);
 assert.equal(bundle.findings[0].evidence_refs[0], "#/analysis/storage_projection/edges/0");
 assert.equal(bundle.findings[0].location.key, location.key);
 const markdown = investigationMarkdown(bundle);
 assert.match(markdown, /Native BAL commitment verified: Unknown/); assert.match(markdown, /No execution delay or speedup/);
 const embedded = markdown.split("```json\n")[1].split("\n```")[0];
 assert.deepEqual(JSON.parse(embedded), JSON.parse(JSON.stringify(bundle)));
});

test("exports use an allowlist and exclude secrets in unknown fields, transport origins, source names, and diagnostic text", () => {
 const run = report(); const sentinel = "DO_NOT_EXPORT_PRIVATE_CREDENTIAL";
 Object.assign(run, { receiver_token: sentinel, private_key: sentinel, private_operator: sentinel });
 Object.assign(run.block, { rpc_url: sentinel });
 Object.assign(run.sources[0], { origin: `https://user:${sentinel}@private.invalid/path?key=${sentinel}`, kind: `eth_getBlockByHash:${sentinel}`, headers: { Authorization: sentinel }, session: sentinel });
 run.coverage.push(sentinel); Object.assign(run.transaction_access[0], { private_metadata: sentinel });
 const links = emptyLinks(); links.payloads.push({ ...observation(), debug: sentinel, source_id: sentinel });
 const bundle = buildInvestigation(run, false, null, links);
 const output = JSON.stringify(bundle) + investigationMarkdown(bundle);
 assert.ok(!output.includes(sentinel)); assert.ok(!output.includes("private.invalid")); assert.ok(!output.includes("private-operator"));
 assert.equal((bundle.analysis.sources[0] as unknown as { source_ref: string }).source_ref, "analysis-source-1");
 assert.match(output, /unrecognized_coverage_code_omitted/);
});

test("graph selection, transaction focus and recorded modes survive export without switching to live", () => {
 for (const mode of ["fork", "captured", "replay", "synthetic"]) {
  const run = report(); run.mode = mode; if (mode === "fork") {run.network="sepolia-fork";run.chain_id="31337";run.native_bal=null;}
  const bundle = buildInvestigation(run, false, 8, emptyLinks());
  assert.equal(bundle.analysis.mode, mode); assert.equal(bundle.selection.graph,"graph");assert.equal(bundle.selection.denominator,0);assert.equal(bundle.findings.length,0);
  assert.equal(bundle.analysis.graph.edges.length,1);
 }
});

test("bounded correlation checks require exact scope, block hash and summary observation identity", async () => {
 const run=report(); const payload=observation();
 const policy={id:hash("1"),network:"sepolia",mode:"live",source:"private-operator",summary_id:hash("2"),execution_mode:"simulation",decision:{outcome:"healthy",codes:[]}};
 const summary={id:hash("2"),network:"sepolia",mode:"live",source:"private-operator",monitored_chain_id:"11155111",evidence:[payload],max_latency_evidence:null};
 const paths:string[]=[];
 const read=async(path:string):Promise<unknown>=>{
  paths.push(path);
  if(path.includes("collector"))return{network:"sepolia",source:"private-operator"};
  if(path.includes("payloadwatch"))return{network:"sepolia",mode:"live",source:"private-operator",data:[payload,{...payload,payload_hash:hash("3")}]};
  if(path.includes("cre/reports"))return{scope:{network:"sepolia",mode:"live",source:"private-operator"},data:[policy]};
  return{data:summary};
 };
 const links=await collectInvestigationLinks(run,read);assert.equal(links.payloads.length,1);assert.equal(links.policies.length,1);assert.ok(paths.some(path=>path.includes("/slots/16?")));
 Object.assign(policy, { receiver_token: "NEVER_EXPORT_RECEIVER_TOKEN", policy: { policy_network: "sepolia-policy-fork", policy_chain_id: "11155111", rpc_origin: "https://NEVER_EXPORT_RECEIVER_TOKEN@private.invalid" } });
 Object.assign(summary, { private_operator: "NEVER_EXPORT_RECEIVER_TOKEN" });
 let bundle=buildInvestigation(run,true,null,links);assert.equal(bundle.linked_evidence.policy_checks.length,1);assert.match(bundle.linked_evidence.policy_checks[0].relationship,/not a transaction verdict/);
 assert.ok(!JSON.stringify(bundle).includes("NEVER_EXPORT_RECEIVER_TOKEN"));
 assert.equal((bundle.linked_evidence.policy_checks[0].report as { policy: { policy_network: string } }).policy.policy_network, "sepolia-policy-fork");
 summary.evidence=[{...payload,block_root:hash("4")}];
 const mismatched=await collectInvestigationLinks(run,read);assert.equal(mismatched.policies.length,0);
 bundle=buildInvestigation(run,true,null,{...links,policies:[{report:policy,summary}]});assert.equal(bundle.linked_evidence.policy_checks.length,0);
 assert.equal(bundle.linked_evidence.policy_status,"not_found_in_search");
});

test("unavailable optional APIs do not prevent analysis export; fork scopes trigger no live joins", async () => {
 let calls=0;const read=async()=>{calls++;throw new Error("provider unavailable");};
 const run=report();let links=await collectInvestigationLinks(run,read);assert.equal(links.payloadStatus,"unavailable");assert.ok(buildInvestigation(run,true,null,links).analysis);
 run.mode="fork";run.network="sepolia-fork";calls=0;links=await collectInvestigationLinks(run,read);assert.equal(calls,0);assert.equal(links.policyStatus,"unsupported_scope");
});

test("summary search respects its bound and never invents policy links without matching payload evidence", async () => {
 const run=report();let summaries=0;
 const links=await collectInvestigationLinks(run,async path=>{
  if(path.includes("collector"))return{network:"sepolia",source:"node"};
  if(path.includes("payloadwatch"))return{network:"sepolia",mode:"live",source:"node",data:[]};
  if(path.includes("cre/reports"))return{scope:{network:"sepolia",mode:"live",source:"node"},data:Array.from({length:20},(_,index)=>({id:hash("1"),summary_id:"0x"+index.toString(16).padStart(64,"0"),network:"sepolia",mode:"live",source:"node"}))};
  summaries++;return{data:{}};
 });
 assert.equal(summaries,10);assert.equal(links.search.summariesChecked,10);assert.equal(links.policies.length,0);
});
