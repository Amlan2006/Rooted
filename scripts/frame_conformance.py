"""Differential conformance run of frame-transaction boundary cases on the public devnet.

Each case is signed by one fresh in-memory key, submitted at most once per new
block, and judged by the node itself (RPC answer, then its admission report).
Expected verdicts per source are fixed below before any run and never edited
after an observation. Requires curl and Foundry cast; --record also needs a
built Rooted binary and DATABASE_URL.
"""
import argparse
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_frame_transaction as frame  # noqa: E402

SCHEMA = 'rooted-frame-conformance-v1'
SOURCES = {
    'eip8141': 'https://eips.ethereum.org/EIPS/eip-8141',
    'eip8250': 'https://eips.ethereum.org/EIPS/eip-8250',
    'erc8421_draft': 'https://docs.altmempool.wtf/rules/budget/',
    'sidecar_docs': 'https://docs.altmempool.wtf/guides/keyed-nonces/',
}
NA = 'n/a'
STATE_PER_KEY = 97920  # EIP-8250: STATE_BYTES_PER_STORAGE_SET 64 * CPSB 1530 per fresh key
SECP256K1 = 2800  # EIP-8141 signature cost counted inside MAX_VERIFY_GAS


def case(id, group, description, overrides, seq, expected, basis):
    return {'id': id, 'group': group, 'description': description, 'overrides': overrides, 'seq': seq,
            'expected': dict(zip(SOURCES, expected)), 'expected_basis': basis}


# Order matters: the key-0 cases run while the account nonce is still 0.
CASES = [
    case('keys-zero-mixed', 'nonce_keys', 'Key 0 mixed with a keyed slot; state gas funds two fresh keys',
         {'nonce_keys': [0, 307], 'verify_execution': 60000, 'verify_state': 2 * STATE_PER_KEY}, 0,
         (NA, 'accept', NA, 'reject'),
         {'eip8250': 'Decoders reject only if len(nonce_keys) > MAX_NONCE_KEYS or nonce_keys is not strictly increasing; [0, 307] is both valid',
          'sidecar_docs': '"1 to 16 strictly increasing keys. ... Key 0 is only valid on its own."'}),
    case('keys-empty', 'nonce_keys', 'Empty key list (EIP-8250 legacy nonce form)', {'nonce_keys': []}, 0,
         (NA, 'accept', NA, 'reject'),
         {'eip8250': '"nonce_keys == [] selects the legacy account nonce"',
          'sidecar_docs': '"nonceKeys: 1 to 16 strictly increasing keys. ["0x0"] is the sender\'s ordinary account nonce."'}),
    case('keys-17', 'nonce_keys', 'Seventeen keys, one over MAX_NONCE_KEYS', {'nonce_keys': list(range(101, 118))}, 0,
         (NA, 'reject', NA, 'reject'),
         {'eip8250': 'Decoders MUST reject if "len(nonce_keys) > MAX_NONCE_KEYS" (16)',
          'sidecar_docs': '"1 to 16 strictly increasing keys"'}),
    case('keys-duplicate', 'nonce_keys', 'Duplicate key, not strictly increasing', {'nonce_keys': [205, 205]}, 0,
         (NA, 'reject', NA, 'reject'),
         {'eip8250': 'Decoders MUST reject if "nonce_keys is not strictly increasing by numeric value"',
          'sidecar_docs': '"1 to 16 strictly increasing keys"'}),
    case('keys-16', 'nonce_keys', 'Sixteen fresh keys; prefix state budget 16 x 97,920 exceeds 500,000',
         {'nonce_keys': list(range(1, 17)), 'verify_execution': 97000, 'verify_state': 16 * STATE_PER_KEY}, 0,
         ('reject', 'reject', 'accept', 'reject'),
         {'eip8141': '"the sum of limits.state values across the validation prefix must not exceed MAX_VERIFY_STATE_GAS" (500,000)',
          # Corrected from the contract table (accept) before any run: 8250 keeps the state cap.
          'eip8250': '"The existing MAX_VERIFY_STATE_GAS cap on the sum of state limits in the validation prefix is unchanged."',
          'erc8421_draft': '"EIP-8141 caps limits.state at MAX_VERIFY_STATE_GAS across the validation prefix. The standard Alternative Mempool has no such cap."',
          # Corrected from the contract table (accept): the sidecar follows the earlier draft.
          'sidecar_docs': 'Spec differences: sidecar "State gas cap: A per-entity state-gas cap existed in the earlier draft" (value undocumented)'}),
    case('verify-99999', 'verify_budget', 'VERIFY limit 97,199 + SECP256K1 2,800 = 99,999', {'verify_execution': 97199}, 'account',
         ('accept', NA, 'accept', 'accept'),
         {'eip8141': '"The sum of limits.execution values across the validation prefix, plus the intrinsic cost of validating tx.signatures, must not exceed MAX_VERIFY_GAS" (100,000; SECP256K1 = 2800)',
          'erc8421_draft': '"For unstaked entities, the sum must not exceed MAX_VERIFY_GAS_PER_ENTITY (100,000 in the draft)"; "The intrinsic cost of validating tx.signatures counts toward tx.sender."',
          'sidecar_docs': 'Spec differences: sidecar uses "A single MAX_VERIFY_GAS of 100,000"'}),
    case('verify-100000', 'verify_budget', 'VERIFY limit 97,200 + 2,800 = exactly 100,000', {'verify_execution': 97200}, 'account',
         ('accept', NA, 'accept', 'accept'),
         {'eip8141': '"must not exceed MAX_VERIFY_GAS": equality is allowed',
          'erc8421_draft': '"must not exceed MAX_VERIFY_GAS_PER_ENTITY": equality is allowed',
          'sidecar_docs': '"A single MAX_VERIFY_GAS of 100,000"'}),
    case('verify-100001', 'verify_budget', 'VERIFY limit 97,201 + 2,800 = 100,001', {'verify_execution': 97201}, 'account',
         ('reject', NA, 'reject', 'reject'),
         {'eip8141': 'Exceeds MAX_VERIFY_GAS 100,000 by one (signature cost included)',
          'erc8421_draft': 'Exceeds MAX_VERIFY_GAS_PER_ENTITY 100,000 by one (signature cost counts toward tx.sender)',
          'sidecar_docs': 'Exceeds "A single MAX_VERIFY_GAS of 100,000" by one'}),
    case('frames-64', 'frames', 'VERIFY + 63 SENDER frames = MAX_FRAMES', {'extra_sender_frames': 63}, 'account',
         ('accept', NA, 'accept', 'accept'),
         {'eip8141': '"assert len(tx.frames) > 0 and len(tx.frames) <= MAX_FRAMES" (64)',
          'erc8421_draft': 'No frame-count rule beyond EIP-8141 validity',
          'sidecar_docs': 'No frame-count rule beyond EIP-8141 validity'}),
    case('frames-65', 'frames', 'VERIFY + 64 SENDER frames, one over MAX_FRAMES', {'extra_sender_frames': 64}, 'account',
         ('reject', NA, 'reject', 'reject'),
         {'eip8141': '"assert len(tx.frames) > 0 and len(tx.frames) <= MAX_FRAMES" (64)',
          'erc8421_draft': 'An invalid EIP-8141 transaction cannot be admitted',
          'sidecar_docs': 'An invalid EIP-8141 transaction cannot be admitted'}),
]
BASELINE = case('baseline', 'baseline', 'Default self-relay: VERIFY(30,000) + 1-wei self-transfer (scripts/test_frame_transaction.py)', {}, 'account',
                ('accept', NA, 'accept', 'accept'),
                {'eip8141': '30,000 + 2,800 is within MAX_VERIFY_GAS; 2 frames', 'erc8421_draft': 'Within every per-entity budget',
                 'sidecar_docs': 'The documented "Submit a Frame Transaction" example shape'})


def within_cap(used, planned, cap=frame.SUBMISSION_CAP):
    return used + planned <= cap


def failed_checks(admission):
    return [{'rule': c.get('rule', ''), 'detail': c.get('detail', ''), 'frameIndex': c.get('frameIndex'), 'entity': c.get('entity', '')}
            for c in (admission or {}).get('checks', []) if c.get('verdict') == 'fail']


def verdict(rpc, admission):
    """Observed verdict: the RPC answer first, then the node's admission report."""
    checks = failed_checks(admission)
    rule = checks[0]['rule'] if checks else None
    outcome = (admission or {}).get('outcome')
    if rpc['acknowledged'] or outcome in ('accepted', 'included'):
        return 'accept', rule
    if rpc['error_code'] is not None or outcome == 'rejected':
        return 'reject', rule
    return 'unknown', rule


def rpc_answer(response):
    error = response.get('error') if isinstance(response, dict) else None
    return {'acknowledged': isinstance(response, dict) and isinstance(response.get('result'), str),
            'error_code': error.get('code') if isinstance(error, dict) else None,
            'error_message': error.get('message') if isinstance(error, dict) else None}


def now():
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())


def next_block(after):
    for attempt in range(40):
        number = int(frame.rpc(f'block_{after}_{attempt}', 'eth_blockNumber', [], frame.EXECUTION), 16)
        if number > after:
            return number
        time.sleep(2)
    raise RuntimeError('Devnet produced no new block within the bounded wait')


def admission_of(name, tx_hash, node_url):
    for attempt in range(10):
        response = frame.request(f'{name}_admission_{attempt}', 'skandha_explorer_getTransaction', [tx_hash], node_url)
        admission = (response.get('result') or {}).get('admission')
        if admission:
            return admission
        time.sleep(3)
    return None


def receipt_of(name, tx_hash):
    for attempt in range(40):
        receipt = frame.rpc(f'{name}_receipt_{attempt}', 'eth_getTransactionReceipt', [tx_hash], frame.EXECUTION)
        if receipt:
            return {'block_number': receipt['blockNumber'], 'status': receipt['status']}
        time.sleep(3)
    return None


def rooted(*args):
    run = subprocess.run([str(frame.BINARY), *args], capture_output=True, text=True, timeout=120)
    if run.returncode:
        raise RuntimeError(f'Rooted {args[0]} failed; check local backend configuration')
    return json.loads(run.stdout) if args[0] == 'frame-submit' else None


def submit(tx, tx_hash, node, node_url, record):
    if not record:
        return rpc_answer(frame.request(f'submit_{tx_hash[:10]}', 'eth_sendFrameTransaction', [tx], node_url)), None
    # The signed transaction is public evidence; only the key stays in memory.
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', dir=frame.OUT) as signed:
        json.dump(tx, signed)
        signed.flush()
        report = rooted('frame-submit', signed.name, tx_hash, node)
    return rpc_answer(report['response']), report['attempt_id']


def observe(item, tx_hash, node, node_url, record, rpc, attempt):
    admission = admission_of(item['id'], tx_hash, node_url)
    observed, rule = verdict(rpc, admission)
    receipt = receipt_of(item['id'], tx_hash) if observed == 'accept' else None
    if record:
        rooted('frame-sync', node, tx_hash)
    return {'rpc': rpc, 'admission': admission and {'outcome': admission.get('outcome'), 'failed_checks': failed_checks(admission)},
            'observed': observed, 'observed_rule': rule, 'rooted_attempt_id': attempt, 'receipt': receipt}


def result_case(item, tx_hash, submitted_at, observation):
    return {**{k: item[k] for k in ('id', 'group', 'description', 'overrides', 'expected', 'expected_basis')},
            'tx_hash': tx_hash, 'submitted_at': submitted_at, **observation}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--submit', action='store_true', help='Fund one fresh key and submit every boundary case to the public devnet')
    parser.add_argument('--record', action='store_true', help='Submit through `rooted frame-submit` and archive each case in Rooted')
    parser.add_argument('--node', choices=['gateway', 'miner'], default='miner', help='Submitting node; the gateway bundles manually, so accepted cases there never land and block the next nonce')
    parser.add_argument('--baseline', help='recorded_submission.json from test_frame_transaction.py --record, added as case baseline')
    parser.add_argument('--results', default='integrations/frame-conformance/results.json')
    args = parser.parse_args()
    if not args.submit:
        parser.error('Use --submit to explicitly enable devnet submissions')
    if not within_cap(frame.submissions(), len(CASES)):
        parser.error(f'Refusing to start: {frame.submissions()} logged submissions + {len(CASES)} cases would pass {frame.SUBMISSION_CAP}')
    run_id = secrets.token_hex(8)
    frame.OUT = (frame.ROOT / '.tools' / 'frame-conformance' / run_id).resolve()
    frame.OUT.mkdir(parents=True)
    node_url = frame.MINER if args.node == 'miner' else frame.GATEWAY
    results_path = frame.ROOT / args.results
    genesis = frame.verify_devnet()
    info = frame.rpc('info', 'skandha_explorer_info', [], node_url)
    key = '0x' + secrets.token_hex(32)
    sender = frame.cast('wallet', 'address', '--private-key', key)
    doc = {'schema': SCHEMA, 'run_id': run_id, 'network': os.environ.get('ROOTED_FRAME_NETWORK') or 'frame-devnet', 'chain_id': 1337,
           'genesis': genesis, 'gateway': frame.GATEWAY, 'node': args.node, 'node_url': node_url, 'sidecar_version': info.get('version'),
           'started_at': now(), 'finished_at': None, 'sender': sender, 'sources': SOURCES, 'cases': []}

    def save():
        results_path.parent.mkdir(parents=True, exist_ok=True)
        results_path.write_text(json.dumps(doc, indent=2) + '\n')

    if args.baseline:
        report = json.loads(Path(args.baseline).read_text())
        doc['cases'].append(result_case(BASELINE, report['expected_hash'], report['submitted_at'],
                                        observe(BASELINE, report['expected_hash'], report['node'], frame.MINER if report['node'] == 'miner' else frame.GATEWAY,
                                                args.record, rpc_answer(report['response']), report['attempt_id'])))
        save()
    print(json.dumps({'run_id': run_id, 'sender': sender, 'node': args.node}), flush=True)
    frame.fund(sender)
    block = int(frame.rpc('block_start', 'eth_blockNumber', [], frame.EXECUTION), 16)
    for item in CASES:
        block = next_block(block)
        seq = item['seq'] if item['seq'] != 'account' else int(frame.rpc(f'{item["id"]}_nonce', 'eth_getTransactionCount', [sender, 'latest'], frame.EXECUTION), 16)
        tx, tx_hash = frame.build(key, seq, item['overrides'])
        frame.log_submission('frame_conformance', tx_hash)
        submitted_at = now()
        rpc, attempt = submit(tx, tx_hash, args.node, node_url, args.record)
        doc['cases'].append(result_case(item, tx_hash, submitted_at, observe(item, tx_hash, args.node, node_url, args.record, rpc, attempt)))
        save()
        print(json.dumps({k: doc['cases'][-1][k] for k in ('id', 'tx_hash', 'observed', 'observed_rule')}), flush=True)
    doc['finished_at'] = now()
    save()


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, RuntimeError, subprocess.TimeoutExpired) as error:
        raise SystemExit(f'Frame conformance run stopped: {type(error).__name__}; inspect .tools/frame-conformance evidence') from None
