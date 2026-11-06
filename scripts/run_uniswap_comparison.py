#!/usr/bin/env python3
"""Compare two real Uniswap workloads on an owned, isolated Anvil fork. Simulated funds only."""
import argparse
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import time
import urllib.request
from run_uniswap_workload import ROOT, POOLS, FACTORY


def rpc(url, method, params):
    request = urllib.request.Request(url, json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode(), {"Content-Type": "application/json", "User-Agent": "curl/8.7.1"})
    with urllib.request.urlopen(request, timeout=120) as response:
        value = json.load(response)
    if "error" in value:
        raise RuntimeError(f"{method}: {value['error']}")
    return value["result"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--upstream", default=os.environ.get("ROOTED_COMPARISON_UPSTREAM", "https://ethereum-sepolia-rpc.publicnode.com"))
    # Snap-synced nodes keep state for only ~128 recent blocks, so default to a fresh pin.
    parser.add_argument("--block", type=int, help="upstream block to fork (default: upstream head minus 2)")
    parser.add_argument("--port", type=int, default=8549)
    parser.add_argument("--output", default=".tools/workload-comparison")
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535 or (args.block is not None and args.block < 1):
        parser.error("Expected an unprivileged port and positive pinned block")
    for binary in ("anvil", "cast"):
        if not shutil.which(binary):
            parser.error(f"Install Foundry: {binary} is required")
    if not (ROOT / ".tools/rooted").is_file():
        parser.error("Build .tools/rooted first (see docs/WORKLOAD_COMPARISON.md)")
    out = (ROOT / args.output).resolve()
    if not out.is_relative_to(ROOT):
        parser.error('--output must stay inside Rooted')
    out.mkdir(parents=True, exist_ok=True)
    if (out / "comparison.json").exists():
        parser.error("Choose a fresh output directory to preserve previous evidence")
    # Never reset, stop, or submit to an existing Anvil or Ethereum node.
    with socket.socket() as probe:
        if probe.connect_ex(("127.0.0.1", args.port)) == 0:
            parser.error("Port occupied; choose another port. Existing node left untouched")
    if int(rpc(args.upstream, "eth_chainId", []), 16) != 11155111:
        raise RuntimeError("Upstream must be Sepolia")
    if args.block is None:
        args.block = int(rpc(args.upstream, "eth_blockNumber", []), 16) - 2
    anchor = rpc(args.upstream, "eth_getBlockByNumber", [hex(args.block), False])
    if not anchor:
        raise RuntimeError("Pinned upstream block unavailable")
    url = f"http://127.0.0.1:{args.port}"
    with (out / "anvil.log").open("w") as log:
        node = subprocess.Popen(["anvil", "--host", "127.0.0.1", "--port", str(args.port), "--chain-id", "31337", "--fork-url", args.upstream, "--fork-block-number", str(args.block), "--hardfork", "prague", "--steps-tracing", "--order", "fifo", "--silent"], stdout=log, stderr=log)
        try:
            for _ in range(120):
                if node.poll() is not None:
                    raise RuntimeError("Owned Anvil exited; inspect local anvil.log")
                try:
                    if int(rpc(url, "eth_chainId", []), 16) == 31337:
                        break
                except (OSError, ValueError):
                    time.sleep(.5)
            else:
                raise RuntimeError("Owned Anvil startup timed out")
            call = lambda method, params: rpc(url, method, params)
            encode = lambda signature, *values: subprocess.check_output(["cast", "calldata", signature, *map(str, values)], text=True).strip()

            def wait(tx):
                for _ in range(120):
                    receipt = call("eth_getTransactionReceipt", [tx])
                    if receipt:
                        if receipt["status"] != "0x1":
                            raise RuntimeError("Workload transaction reverted")
                        return receipt
                    time.sleep(.1)
                raise RuntimeError("Receipt timeout")

            if call("eth_getBlockByNumber", [hex(args.block), False])["hash"] != anchor["hash"]:
                raise RuntimeError("Fork anchor mismatch")
            for pool in POOLS:
                if call("eth_call", [{"to": pool, "data": encode("factory()")}, "latest"])[-40:].lower() != FACTORY[2:]:
                    raise RuntimeError("Uniswap pool factory mismatch")
            accounts = call("eth_accounts", [])[:3]
            artifact = json.loads((ROOT / ".tools/uniswap-artifacts/SwapWorkload.sol/SwapWorkload.json").read_text())
            bytecode = "0x" + artifact["bytecode"]["object"].removeprefix("0x")
            harnesses = []
            for sender in accounts:
                receipt = wait(call("eth_sendTransaction", [{"from": sender, "data": bytecode, "gas": "0x300000"}]))
                harness = receipt["contractAddress"]
                harnesses.append(harness)
                wait(call("eth_sendTransaction", [{"from": sender, "to": harness, "data": encode("fund()"), "value": hex(10**18), "gas": "0x40000"}]))
            baseline = call("eth_getBlockByNumber", ["latest", False])
            snapshot = call("evm_snapshot", [])
            settings = {"client": call("web3_clientVersion", []), "hardfork": "prague", "order": "fifo", "opcode_limit": 20000, "amount_raw": str(10**12), "gas": "0x200000", "max_fee": str(5*10**9), "priority_fee": str(10**9), "timestamp": int(baseline["timestamp"], 16)+12, "accounts": accounts, "harnesses": harnesses}
            scenarios = []
            for name, routes in [("Same pool", [POOLS[0]]*3), ("Spread pools", [POOLS[0], POOLS[1], POOLS[0]])]:
                if scenarios and not call("evm_revert", [snapshot]):
                    raise RuntimeError("Cannot restore common baseline")
                if call("eth_getBlockByNumber", ["latest", False])["hash"] != baseline["hash"]:
                    raise RuntimeError("Scenario baseline mismatch")
                call("evm_setAutomine", [False])
                call("evm_setNextBlockTimestamp", [settings["timestamp"]])
                hashes = []
                try:
                    for sender, harness, pool in zip(accounts, harnesses, routes):
                        hashes.append(call("eth_sendTransaction", [{"from": sender, "to": harness, "data": encode("runSwap(address,uint256,bool)", pool, settings["amount_raw"], "false"), "gas": settings["gas"], "maxFeePerGas": hex(5*10**9), "maxPriorityFeePerGas": hex(10**9)}]))
                    call("evm_mine", [])
                finally:
                    call("evm_setAutomine", [True])
                receipts = [wait(tx) for tx in hashes]
                block_hash = receipts[0]["blockHash"]
                block = call("eth_getBlockByHash", [block_hash, False])
                if block["transactions"] != hashes or block["parentHash"] != baseline["hash"] or any(r["blockHash"] != block_hash for r in receipts):
                    raise RuntimeError("Scenario transaction set/order mismatch")
                env = dict(os.environ, ROOTED_NETWORK="sepolia", ROOTED_FORK_RPC=url, ROOTED_ANALYSIS_ANCHOR_NUMBER=anchor["number"], ROOTED_ANALYSIS_ANCHOR_HASH=anchor["hash"])
                print(f"Analyzing {name}: {block_hash}", flush=True)
                result = subprocess.run([str(ROOT / ".tools/rooted"), "analyze-fork", block_hash, ",".join(hashes)], cwd=ROOT, env=env, text=True, capture_output=True, timeout=300)
                (out / f"scenario-{len(scenarios)}.log").write_text(result.stderr)
                if result.returncode:
                    raise RuntimeError("Analysis failed; inspect scenario log (local only)")
                report = json.loads(result.stdout)["data"]
                # Endpoint origins are operator metadata; exclude them from portable evidence.
                for source in report.get("sources", []):
                    source["origin"] = "local controlled fork"
                inputs = [call("eth_getTransactionByHash", [tx]) for tx in hashes]
                scenarios.append({"name": name, "routes": routes, "transactions": hashes, "receipts": [{k: r[k] for k in ("transactionHash", "blockHash", "status", "transactionIndex")} for r in receipts], "inputs": [{k: tx[k] for k in ("hash", "from", "to", "input", "gas", "maxFeePerGas", "maxPriorityFeePerGas", "nonce", "value")} for tx in inputs], "report": report})
                (out / f"scenario-{len(scenarios)}.json").write_text(json.dumps(scenarios[-1], indent=2)+"\n")
            comparison = {"schema": "rooted-workload-comparison-v1", "captured_at": scenarios[-1]["report"]["created_at"], "fork": {"number": anchor["number"], "hash": anchor["hash"]}, "baseline": {"number": baseline["number"], "hash": baseline["hash"]}, "settings": settings, "scenarios": scenarios}
            (out / "comparison.json").write_text(json.dumps(comparison, indent=2)+"\n")
            print(f"Saved {out / 'comparison.json'}. Owned Anvil will stop; saved reports remain.")
        finally:
            node.terminate()
            try:
                node.wait(timeout=15)
            except subprocess.TimeoutExpired:
                node.kill()
                node.wait()


if __name__ == "__main__":
    main()
