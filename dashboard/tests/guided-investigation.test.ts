import { test } from "node:test";
import assert from "node:assert/strict";
import type { Run } from "../lib/data";
import { collectInvestigationLinks } from "../lib/investigation-links";
import { investigationURL, matchesInvestigation, parseInvestigationSelection, payloadTimeline, reportPath, selectionForRun } from "../lib/guided-investigation";
const hash = (digit: string) => "0x" + digit.repeat(64);
function run(): Run {
 return { id: hash("a"), network: "sepolia", mode: "live", chain_id: "11155111", block: { hash: hash("b"), number:"0x1",slotNumber:"0x10", transactions:[{hash:hash("c")} ] },analyzed_transactions:[{transaction:{hash:hash("c")}}] } as Run;
}
const payload = () => ({ network:"sepolia",mode:"live",source_id:"original-node",slot:"16",block_root:hash("d"),payload_hash:hash("b"), reveal_latency_ms:null });

test("investigation URLs retain explicit report, transaction, network, mode, and encoded source",()=>{
 const report=run();report.network="sepolia-fork";report.mode="fork";report.chain_id="31337";
 const selected={...selectionForRun(report),source:"node & mode=live"};
 const parsed=parseInvestigationSelection(new URLSearchParams(investigationURL(selected).slice(1)));
 assert.deepEqual(parsed,selected);
 assert.equal(reportPath(selected),`/api/v1/analysis/runs/${report.id}?network=sepolia-fork&mode=fork`);
 assert.equal(matchesInvestigation(report,selected),true);
 assert.equal(selectionForRun(report,null).transaction,null);
});

test("missing scope, malformed hashes, and inconsistent fork modes reject deep links",()=>{
 assert.equal(parseInvestigationSelection(new URLSearchParams("view=investigate")),null);
 for(const query of [
  `report=${hash("a")}`,`report=bad&network=sepolia&mode=live`,
  `report=${hash("a")}&network=sepolia-fork&mode=live`,
  `report=${hash("a")}&network=sepolia&mode=fork`,
  `report=${hash("a")}&network=sepolia&mode=live&transaction=bad`,
  `report=${hash("a")}&network=sepolia&mode=live&source=`,
 ])assert.throws(()=>parseInvestigationSelection(new URLSearchParams(query)),query);
});

test("loaded reports and selected transactions must match immutable investigation identity",()=>{
 const report=run(),selection=selectionForRun(report);
 assert.equal(matchesInvestigation(report,{...selection,report:hash("e")}),false);
 assert.equal(matchesInvestigation(report,{...selection,network:"sepolia-fork"}),false);
 assert.equal(matchesInvestigation(report,{...selection,mode:"synthetic"}),false);
 assert.equal(matchesInvestigation(report,{...selection,transaction:hash("f")}),false);
 assert.equal(matchesInvestigation({...report,chain_id:"1"},selection),false);
 assert.throws(()=>selectionForRun(report,hash("f")));
});

test("journal correlation excludes wrong source, mode, root, slot, and execution hash",async()=>{
 const report=run(),record=payload();
 const event={network:"sepolia",mode:"live",source_id:"original-node",slot:"16",block_root:hash("d"),payload_hash:hash("b"),kind:"payload_seen",timed:false};
 const mutations=[{source_id:"new-node"},{mode:"synthetic"},{network:"mainnet"},{block_root:hash("e")},{slot:"17"},{payload_hash:hash("f")}];
 const response={network:"sepolia",mode:"live",source:"original-node",data:[{event},...mutations.map(patch=>({event:{...event,...patch}}))]};
 const result=await payloadTimeline(report,record,async path=>{
  assert.match(path,/\/slots\/16\/timeline\?/);assert.match(path,/source=original-node/);return response;
 });
 assert.equal(result.status,"matched");assert.equal(result.events.length,1);
 assert.equal((result.events[0].event as typeof event).timed,false);
 assert.equal(record.reveal_latency_ms,null);
 const wrong=await payloadTimeline(report,record,async()=>({...response,source:"new-node"}));assert.equal(wrong.status,"unavailable");
});

test("missing journal data remains explicit and never substitutes polling time",async()=>{
 const report=run(),record=payload();
 const missing=await payloadTimeline(report,record,async()=>({network:"sepolia",mode:"live",source:"original-node",data:[]}));
 assert.equal(missing.status,"not_found_in_page");assert.deepEqual(missing.events,[]);
 const failed=await payloadTimeline(report,record,async()=>{throw Error("unavailable");});assert.equal(failed.status,"unavailable");
 let calls=0;await payloadTimeline(report,{...record,payload_hash:hash("f")},async()=>{calls++;return{};});assert.equal(calls,0);
});

test("pinned source survives collector changes, while competing roots remain distinct",async()=>{
 const report=run(),record=payload();const paths:string[]=[];
 const linked=await collectInvestigationLinks(report,async path=>{
  paths.push(path);assert.ok(!path.includes("collector"));assert.match(path,/source=original-node/);
  if(path.includes("payloadwatch"))return{network:"sepolia",mode:"live",source:"original-node",data:[record,{...record,block_root:hash("e")} ]};
  return{scope:{network:"sepolia",mode:"live",source:"original-node"},data:[]};
 },"original-node");
 assert.equal(linked.source,"original-node");assert.equal(linked.payloads.length,2);assert.equal(linked.payloadStatus,"matched");
 assert.equal(linked.policyStatus,"not_found_in_search");assert.equal(paths.length,2);
});
