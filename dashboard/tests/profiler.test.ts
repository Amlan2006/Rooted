import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {budgetMargin,profileRequest,profileSummary,type ExecutionProfile} from "../lib/profiler";
import {backendURL} from "../lib/proxy";
import {POST} from "../app/api/profiler/route";
const captured=()=>JSON.parse(readFileSync(new URL("../../demo/profiler/profile.json",import.meta.url),"utf8")).data as ExecutionProfile;
const hash="0x"+"a".repeat(64);
test("real profile partitions reconcile while nested state/EVM totals remain distinct",()=>{
 const p=captured(),s=profileSummary(p);assert.equal(s.transactions.length,85);assert.equal(s.partition!.reduce((n,x)=>n+x.ns,0),s.sample.apply_ns);assert.ok(s.sample.evm_call_ns!>=s.sample.state_inside_evm_ns!);assert.equal(s.stateCalls.reduce((n,c)=>n+c.ns,0),s.sample.state_access_ns);assert.ok(s.transactions[0].apply>=s.transactions.at(-1)!.apply);assert.ok(s.gasPerSecond!>0);
 const bad=captured();bad.mode="live";assert.throws(()=>profileSummary(bad),/scope/);
 const overlap=captured();for(const sample of overlap.metrics.samples)sample.state_inside_evm_ns=sample.apply_ns+1;assert.throws(()=>profileSummary(overlap),/reconcile/);
});
test("budget remains an explicit assumption with missing/invalid inputs unknown",()=>{
 assert.equal(budgetMargin("",10e6),null);assert.equal(budgetMargin("-1",10e6),null);assert.equal(budgetMargin("60001",10e6),null);assert.equal(budgetMargin("20",15e6),5);assert.equal(budgetMargin("5",15e6),-10);
});
test("profiler only accepts immutable block or saved-profile identities",()=>{
 assert.deepEqual(profileRequest({block_hash:hash}),{block_hash:hash});assert.deepEqual(profileRequest({profile_id:hash}),{profile_id:hash});for(const invalid of [{},{block_hash:"latest"},{url:"http://private.invalid"},{block_hash:hash,profile_id:hash}])assert.throws(()=>profileRequest(invalid));
 assert.equal(backendURL(["api","v1","profiles",hash,"capture"],"?network=sepolia&mode=replay","http://127.0.0.1:8080").pathname,`/api/v1/profiles/${hash}/capture`);assert.throws(()=>backendURL(["api","v1","profiles",hash,"replay"],"","http://127.0.0.1:8080"));
});
test("profile proxy rejects foreign origin and preserves saved-capture rerun identity",async(t)=>{
 const request=(body:unknown,origin="http://localhost:3000")=>new Request("http://localhost:3000/api/profiler",{method:"POST",headers:{Origin:origin,"Content-Type":"application/json"},body:JSON.stringify(body)});
 assert.equal((await POST(request({block_hash:hash},"https://foreign.invalid"))).status,403);assert.equal((await POST(request({block_hash:hash,url:"http://private.invalid"}))).status,400);
 let called="",body="";t.mock.method(globalThis,"fetch",async(url:URL,options:RequestInit)=>{called=String(url);body=String(options.body);return Response.json({data:captured()},{status:201})});
 assert.equal((await POST(request({profile_id:hash}))).status,201);assert.equal(new URL(called).pathname,`/api/v1/profiles/${hash}/replay`);assert.deepEqual(JSON.parse(body),{});
});
