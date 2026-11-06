import {test} from "node:test";
import assert from "node:assert/strict";
import {parseProviderRequest} from "../lib/provider-request";
import {backendURL} from "../lib/proxy";
import {POST} from "../app/api/provider-comparison/route";
const hash="0x"+"a".repeat(64);
const request=(body:string,origin="http://localhost:3000",type="application/json")=>new Request("http://localhost:3000/api/provider-comparison",{method:"POST",headers:{Origin:origin,"Content-Type":type},body});
test("provider requests accept only a block identity or a finalized selection",()=>{
 assert.deepEqual(parseProviderRequest({}),{block_hash:""});
 assert.deepEqual(parseProviderRequest({block_hash:` ${hash} `}),{block_hash:hash});
 for(const value of [null,[],{block_hash:"latest"},{url:"http://private.invalid"},{block_hash:hash,network:"mainnet"}])assert.throws(()=>parseProviderRequest(value));
});
test("provider proxy rejects foreign origins, arbitrary endpoints, oversized bodies, and incorrect content types",async()=>{
 assert.equal((await POST(request("{}","https://foreign.invalid"))).status,403);
 assert.equal((await POST(request("{}","http://localhost:3000","text/plain"))).status,415);
 assert.equal((await POST(request('{"url":"http://private.invalid"}'))).status,400);
 assert.equal((await POST(request("x".repeat(4097)))).status,413);
});
test("provider proxy forwards the exact hash to the configured backend and preserves retry status",async(t)=>{
 let called="";let body="";
 t.mock.method(globalThis,"fetch",async(url:URL,options:RequestInit)=>{called=String(url);body=String(options.body);return Response.json({error:{message:"busy"}},{status:429});});
 const response=await POST(request(JSON.stringify({block_hash:hash})));
 assert.equal(response.status,429);assert.equal(new URL(called).pathname,"/api/v1/providers/compare");assert.equal(new URL(called).search,"?network=sepolia");assert.deepEqual(JSON.parse(body),{block_hash:hash});
 assert.equal(backendURL(["api","v1","providers","comparisons",hash],"?network=sepolia","http://127.0.0.1:8080").pathname,`/api/v1/providers/comparisons/${hash}`);
 assert.throws(()=>backendURL(["api","v1","providers","compare"],"","http://127.0.0.1:8080"));
});
