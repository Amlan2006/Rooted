export type ProfileTx = { hash:string; gas_used:number; apply_ns:number; state_access_ns:number; finalize_ns:number; evm_call_ns?:number; state_inside_evm_ns?:number; state_calls:Record<string,{calls:number;ns:number}> };
export type ProfileSample = { apply_ns:number; state_access_ns:number; finalize_ns:number; evm_call_ns?:number; state_inside_evm_ns?:number; transactions:ProfileTx[] };
export type ExecutionProfile = {
 capture_mode?:string;input_captured_at?:string;id:string; schema:string;network:string;mode:string;block_hash:string;block_number:string;captured_at:string;capture_digest:string;source_client:string;coverage:string[];analysis_ids:string[];
 payload_observations:{source_ref?:string;block_root:string;slot:string;delivery:string;reveal_latency_ms:number|null;coverage:string[]}[];
 metrics:{runner:string;go:string;os:string;arch:string;logical_cpus:number;cpu_model:string;geth_library:string;module_sum:string;block_hash:string;transaction_count:number;gas_used:number;warmups:number;samples:ProfileSample[];control_apply_ns:number[];median_apply_ns:number;p95_apply_ns:number;control_median_ns:number;median_state_ns:number;median_finalize_ns:number};
};
export function profileRequest(value:unknown):{block_hash:string}|{profile_id:string} {
 if(!value||typeof value!=="object"||Array.isArray(value))throw Error("Provide an execution block hash.");
 const v=value as Record<string,unknown>;
 if(Object.keys(v).length===1&&typeof v.profile_id==="string"&&/^0x[0-9a-f]{64}$/i.test(v.profile_id))return {profile_id:v.profile_id.toLowerCase()};
 if(Object.keys(v).some(key=>key!=="block_hash")||typeof v.block_hash!=="string"||!/^0x[0-9a-f]{64}$/i.test(v.block_hash.trim()))throw Error("Only an immutable 32-byte block hash is accepted.");
 return {block_hash:v.block_hash.trim().toLowerCase()};
}
export const milliseconds=(ns:number|undefined|null)=>typeof ns==="number"&&Number.isFinite(ns)?(ns/1e6).toFixed(3)+" ms":"Unknown";
export function median(values:number[]):number {const v=[...values].sort((a,b)=>a-b);return v[Math.ceil(v.length/2)-1];}
export function profileSummary(p:ExecutionProfile){
 const m=p.metrics;if(p.network!=="sepolia"||p.mode!=="replay"||p.block_hash!==m.block_hash||!m.samples?.length)throw Error("Profile identity or measurement scope does not match.");
 const sample=[...m.samples].sort((a,b)=>a.apply_ns-b.apply_ns)[Math.ceil(m.samples.length/2)-1];
 const evm=sample.evm_call_ns,stateEVM=sample.state_inside_evm_ns;
 const partition=typeof evm==="number"&&typeof stateEVM==="number"?[
  {label:"Root EVM window outside intercepted state calls",ns:evm-stateEVM},
  {label:"Intercepted state calls inside root EVM",ns:stateEVM},
  {label:"Intercepted state calls outside root EVM",ns:sample.state_access_ns-stateEVM},
  {label:"Other ApplyMessage processing and timer bookkeeping",ns:sample.apply_ns-evm-(sample.state_access_ns-stateEVM)},
 ]:null;
 if(partition&&(partition.some(x=>x.ns<0)||partition.reduce((n,x)=>n+x.ns,0)!==sample.apply_ns))throw Error("Measured timing intervals do not reconcile.");
 const tx=sample.transactions.map((t,i)=>({hash:t.hash,index:i,gas:t.gas_used,apply:median(m.samples.map(s=>s.transactions[i].apply_ns)),state:median(m.samples.map(s=>s.transactions[i].state_access_ns)),evm:m.samples.every(s=>typeof s.transactions[i].evm_call_ns==="number")?median(m.samples.map(s=>s.transactions[i].evm_call_ns!)):undefined,finalize:median(m.samples.map(s=>s.transactions[i].finalize_ns))})).sort((a,b)=>b.apply-a.apply||a.index-b.index);
 const calls=new Map<string,{calls:number;ns:number}>();for(const t of sample.transactions)for(const [key,value]of Object.entries(t.state_calls)){const c=calls.get(key)||{calls:0,ns:0};c.calls+=value.calls;c.ns+=value.ns;calls.set(key,c)}
 return {sample,partition,transactions:tx,stateCalls:[...calls].map(([method,value])=>({method,...value})).sort((a,b)=>b.ns-a.ns),gasPerSecond:m.control_median_ns>0?m.gas_used/(m.control_median_ns/1e9):null,largestSlice:partition?[...partition].sort((a,b)=>b.ns-a.ns)[0]:null};
}
export function budgetMargin(budget:string,observedP95NS:number):number|null{if(!/^\d+(\.\d+)?$/.test(budget))return null;const b=Number(budget);return b>0&&b<=60000?b-observedP95NS/1e6:null;}
