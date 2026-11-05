#!/usr/bin/env python3
"""Four real Uniswap v3 calls on an isolated local Sepolia fork; simulated funds only."""
import argparse
import json
from pathlib import Path
import subprocess
import time
import urllib.request
import urllib.parse

FACTORY='0x0227628f3f023bb0b980b67d528571c95c6dac1c'
POOLS=['0x3289680dd4d6c10bb19b899729cda5eef58aeff1','0x6ce0896eae6d4bd668fde41bb784548fb8f59b50']
WETH='0xfff9976782d46cc05630d1f6ebab18b2324d6b14'
ROOT=Path(__file__).resolve().parents[1]

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rpc',default='http://127.0.0.1:8547')
    parser.add_argument('--output',default='.tools/uniswap-workload')
    args=parser.parse_args()
    url=urllib.parse.urlparse(args.rpc)
    if url.hostname not in ('127.0.0.1','localhost','::1'):
        parser.error('This workload is restricted to a local loopback fork')
    out=(ROOT / args.output).resolve()
    if not out.is_relative_to(ROOT):
        parser.error('--output must stay inside Rooted')
    out.mkdir(parents=True,exist_ok=True)
    if (out/'summary.json').exists():
        parser.error('choose a fresh output directory to preserve previous evidence')
    def rpc(method,params,name=None):
        body=json.dumps({'jsonrpc':'2.0','id':1,'method':method,'params':params}).encode()
        request=urllib.request.Request(args.rpc,body,{'Content-Type':'application/json'})
        with urllib.request.urlopen(request,timeout=90) as response:
            result=json.load(response)
        if name:(out/(name+'.json')).write_text(json.dumps(result)+'\n')
        if 'error' in result:raise RuntimeError(f"{method}: {result['error']}")
        return result['result']
    if int(rpc('eth_chainId',[]),16)!=31337:raise RuntimeError('Expected local fork chain 31337')
    version=rpc('web3_clientVersion',[])
    if 'anvil' not in version.lower():raise RuntimeError('Expected local Anvil')
    parent=rpc('eth_getBlockByNumber',['latest',False],'fork-parent')
    def calldata(signature,*values):
        return subprocess.check_output(['cast','calldata',signature,*map(str,values)],text=True).strip()
    def wait(hash):
        for _ in range(120):
            receipt=rpc('eth_getTransactionReceipt',[hash])
            if receipt:return receipt
            time.sleep(.25)
        raise RuntimeError('Local transaction receipt timeout')
    for pool in POOLS:
        value=rpc('eth_call',[{'to':pool,'data':calldata('factory()')},'latest'])
        if value[-40:].lower()!=FACTORY[2:]:raise RuntimeError('Pool factory mismatch')
    accounts=rpc('eth_accounts',[])[:4]
    artifact=json.loads((ROOT/'.tools/uniswap-artifacts/SwapWorkload.sol/SwapWorkload.json').read_text())
    bytecode=artifact['bytecode']['object']
    if not bytecode.startswith('0x'):bytecode='0x'+bytecode
    harnesses=[]
    for sender in accounts:
        created=wait(rpc('eth_sendTransaction',[{'from':sender,'data':bytecode,'gas':'0x300000'}]))
        if created['status']!='0x1':raise RuntimeError('Harness deployment failed')
        harness=created['contractAddress'];harnesses.append(harness)
        funded=wait(rpc('eth_sendTransaction',[{'from':sender,'to':harness,'data':calldata('fund()'),'value':hex(10**18),'gas':'0x40000'}]))
        if funded['status']!='0x1':raise RuntimeError('Local WETH funding failed')
    rpc('evm_setAutomine',[False])
    cases=[]
    try:
        for index,(sender,harness) in enumerate(zip(accounts,harnesses)):
            pool=POOLS[1] if index==2 else POOLS[0]
            revert=index==3
            transaction={'from':sender,'to':harness,'data':calldata('runSwap(address,uint256,bool)',pool,10**12,str(revert).lower()),
                         'gas':'0x200000','maxFeePerGas':hex(5*10**9),'maxPriorityFeePerGas':hex(10**9)}
            hash=rpc('eth_sendTransaction',[transaction])
            cases.append({'case':['same_pool_first','same_pool_second','different_pool','reverted_after_swap'][index],
                          'hash':hash,'sender':sender,'harness':harness,'pool':pool,'expected_status':'0x0' if revert else '0x1'})
        rpc('evm_mine',[])
    finally:
        rpc('evm_setAutomine',[True])
    block_hash=None
    for index,case in enumerate(cases):
        receipt=wait(case['hash'])
        (out/f'case_{index}_receipt.json').write_text(json.dumps({'jsonrpc':'2.0','id':1,'result':receipt})+'\n')
        if receipt['status']!=case['expected_status']:raise RuntimeError(f"Unexpected result for {case['case']}")
        if block_hash is not None and block_hash!=receipt['blockHash']:raise RuntimeError('Workload did not mine in one block')
        block_hash=receipt['blockHash'];case['transaction_index']=int(receipt['transactionIndex'],16)
    block=rpc('eth_getBlockByHash',[block_hash,True],'workload-block')
    summary={'network':'sepolia-fork','mode':'fork','chain_id':31337,'client':version,'upstream_network':'sepolia',
             'fork_parent_hash':parent['hash'],'fork_parent_number':int(parent['number'],16),'block_hash':block_hash,
             'block_number':int(block['number'],16),'native_bal':False,'funds':'simulated local Anvil balances only','cases':cases}
    (out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
    print(json.dumps(summary,indent=2))

if __name__=='__main__':main()
