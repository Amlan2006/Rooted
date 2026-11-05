#!/usr/bin/env python3
"""Read-only Phase 5 checks against persisted native and controlled-fork analysis."""
import argparse
import collections
import json
from pathlib import Path
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def rooted_path(path_text):
    path = (ROOT / path_text).resolve()
    if not path.is_relative_to(ROOT):
        raise ValueError('path must stay inside Rooted')
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', default='http://127.0.0.1:8080')
    parser.add_argument('--workload', default='.tools/uniswap-workload/summary.json')
    parser.add_argument('--output', default='.tools/phase5-smoke.json')
    args = parser.parse_args()
    workload = json.loads(rooted_path(args.workload).read_text())

    def get(path):
        with urllib.request.urlopen(args.base + path, timeout=30) as response:
            return json.load(response)

    scope = 'network=sepolia-fork&mode=fork'
    runs = get(f"/api/v1/analysis/blocks/{workload['block_hash']}?{scope}")['data']
    run = next(r for r in runs if len(r['analyzed_transactions']) == 4)
    assert run['native_bal'] is None and run['chain_id'] == '31337'
    assert run['canonical_at_fetch'] is True
    assert len(run['uniswap_swaps']) == 3 and len(run['uniswap_swap_calls']) == 4
    assert len(run['uniswap_pools']) == 2 and all(p['verified'] for p in run['uniswap_pools'])
    assert all(t['opcode_trace_available'] and t['state_diff_available'] for t in run['analyzed_transactions'])
    assert all(a['storage_reads_complete'] and len(a['reads']) > 3 for a in run['transaction_access'])
    attempts = {a['transaction_hash']: a for a in run['uniswap_swap_calls']}
    cases = {c['case']: c for c in workload['cases']}
    reverted = attempts[cases['reverted_after_swap']['hash']]
    assert reverted['transaction_reverted'] and reverted['ancestor_failed'] and not reverted['committed']
    assert not any(s['transaction_hash'] == reverted['transaction_hash'] for s in run['uniswap_swaps'])
    first = cases['same_pool_first']['transaction_index']
    second = cases['same_pool_second']['transaction_index']
    pool = cases['same_pool_first']['pool']
    assert any(e['from'] == first and e['to'] == second and e['kind'] == 'RAW'
               and e['location']['address'] == pool for e in run['graph']['edges'])
    assert any(e['location']['field'] == 'balance' for e in run['graph']['edges'])
    for graph in (run['graph'], run['storage_projection']):
        assert graph['full_dependency_coverage'] is False and graph['theoretical_speedup'] is None
        assert graph['observed_conflict_counts'] == dict(collections.Counter(e['kind'] for e in graph['edges']))
    for view in ('bal', 'dependencies', 'uniswap', 'evidence'):
        assert get(f"/api/v1/analysis/runs/{run['id']}/{view}?{scope}")['id'] == run['id']
    assert get(f"/api/v1/analysis/runs/{run['id']}/evidence?{scope}")['data']
    for query, status in [('network=sepolia', 404), ('network=sepolia-fork', 400)]:
        try:
            get(f"/api/v1/analysis/runs/{run['id']}?{query}")
            raise AssertionError('fork scope leaked')
        except urllib.error.HTTPError as error:
            assert error.code == status
    native = get('/api/v1/analysis/runs?network=sepolia')['data']
    live = next(r for r in native if r['native_bal'] and r['native_bal']['commitment_verified'])
    assert live['mode'] == 'live' and live['graph']['full_dependency_coverage'] is False
    assert live['graph']['theoretical_speedup'] is None
    report = {'result': 'passed', 'fork_id': run['id'], 'native_id': live['id'],
              'fork_block_hash': run['block']['hash'], 'native_block_hash': live['block']['hash'],
              'committed_swaps': len(run['uniswap_swaps']), 'swap_calls': len(run['uniswap_swap_calls']),
              'verified_pools': len(run['uniswap_pools']), 'conflicts': run['graph']['observed_conflict_counts'],
              'native_commitment_verified': True, 'full_dependency_coverage': False}
    output = rooted_path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('x') as handle:
        handle.write(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
