"""Recheck the recorded Phase 1 captures without network calls or writes to the archive."""
import hashlib
import json
import shutil
import subprocess
import sys
import probe_common as common
from probe_sepolia import correlate
from probe_uniswap import FACTORY, SWAP

REFERENCE = common.ROOT / 'demo' / 'phase1' / 'reference'
MODE = 'recorded_capture'


class NotRecorded(Exception):
    """The archive holds a blocked attempt, not a result; reported, never passed."""


def require(condition, message):
    if not condition:
        raise ValueError(message)


def load(relative):
    return json.loads((REFERENCE / relative).read_text())


def response(relative):
    record = load(relative)
    require(record.get('curl_exit') == 0 and record.get('http_status') == '200', 'Captured response was not successful: ' + relative)
    body = json.loads(record['body'])
    require('error' not in body, 'Captured RPC error: ' + relative)
    return body


def tracked():
    return sorted(path for path in REFERENCE.rglob('*') if path.is_file() and path.name != 'manifest.json')


def write_manifest():
    files = [{'path': path.relative_to(REFERENCE).as_posix(), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
        'bytes': path.stat().st_size} for path in tracked()]
    manifest = {'schema': 'rooted.reference-evidence-v1', 'generated_at': common.now(), 'observation_mode': MODE,
        'note': 'Digests of the Phase 1 capture archive. Every file was produced by a probe, API read, or browser '
            'capture run on 2026-11-06; derived summaries say so in their own fields. Verifying these digests is '
            'an offline integrity check, not a fresh network check.', 'files': files}
    (REFERENCE / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    return len(files)


def integrity():
    manifest = load('manifest.json')
    require(manifest['observation_mode'] == MODE, 'Archive mode missing')
    listed = set()
    for entry in manifest['files']:
        path = (REFERENCE / entry['path']).resolve()
        require(path.is_relative_to(REFERENCE.resolve()), 'Archive path escaped')
        data = path.read_bytes()
        require(hashlib.sha256(data).hexdigest() == entry['sha256'], 'Archive digest mismatch: ' + entry['path'])
        require(len(data) == entry['bytes'], 'Archive length mismatch: ' + entry['path'])
        listed.add(path)
    require(listed == {path.resolve() for path in tracked()}, 'Archive files and manifest differ')
    return {'files': len(manifest['files']), 'generated_at': manifest['generated_at']}


def probe_result(name):
    result = load(name + '/result.json')
    require(result['schema'] == 'rooted.phase1-probe-v1' and result['status'] == 'passed', 'Probe did not pass: ' + name)
    return result


def sepolia():
    probe = probe_result('sepolia-probe')
    genesis = response('sepolia-probe/beacon_genesis.json')['data']
    chain = response('sepolia-probe/chain_id.json')['result']
    require(int(chain, 16) == 11155111 and genesis['genesis_validators_root'] == common.GENESIS, 'Network identity mismatch')
    require(int(response('sepolia-probe/trace_chain_id.json')['result'], 16) == 11155111, 'Trace endpoint identity mismatch')
    root = response('sepolia-probe/beacon_header.json')['data']['root']
    message = response('sepolia-probe/beacon_block.json')['data']['message']
    envelope = response('sepolia-probe/payload_envelope.json')
    execution = response('sepolia-probe/execution_block.json')['result']
    result = correlate(message, envelope, execution, root)
    for key in ('slot', 'payload_hash', 'builder_index', 'execution_number', 'bal_commitment'):
        require(probe['result'][key] == result[key], 'Probe summary disagrees with raw captures: ' + key)
    result.update({'beacon_root': root, 'genesis_validators_root': genesis['genesis_validators_root'],
        'captured_at': probe['checked_at']})
    native = json.loads(load('sepolia-probe/native_bal.json')['body'])
    result['native_bal_getter'] = 'rpc_unsupported' if native.get('error', {}).get('code') == -32601 else 'available'
    require(isinstance(response('sepolia-probe/prestate_trace.json')['result'], dict), 'Prestate trace missing')
    events = load('sepolia-probe/events.json')
    require(events['http_status'] == '200', 'Beacon event stream not captured')
    result['stream_event_types'] = sorted({line[6:].strip() for line in events['body'].splitlines() if line.startswith('event:')})
    result['envelope_commitment_verified'] = None
    if shutil.which('cast'):
        encoded = envelope['data']['message']['payload']['block_access_list']
        run = subprocess.run(['cast', 'keccak'], input=encoded, text=True, capture_output=True, timeout=15)
        require(run.returncode == 0, 'Keccak tool failed')
        require(run.stdout.strip() == result['bal_commitment'], 'Recorded BAL commitment mismatch')
        result['envelope_commitment_verified'] = True
    result['ptc_note'] = 'Included PTC votes retain their own slot/root; no target-slot quorum verdict inferred.'
    return result


def uniswap():
    summary = probe_result('uniswap-probe')
    result = summary['result']
    require(result['chain_id'] == '11155111' and int(response('uniswap-probe/chain_id.json')['result'], 16) == 11155111, 'Network identity mismatch')
    require(len(result['samples']) >= 3, 'Missing real swap samples')
    head = response('uniswap-probe/head.json')['result']
    require(response('uniswap-probe/head_recheck.json')['result']['hash'] == head['hash'], 'Pinned head changed')
    for pool in result['pools']:
        require(response(f"uniswap-probe/pool_{pool['fee']}.json")['result'][-40:] == pool['address'][2:].lower(), 'Pool lookup mismatch')
        require(response(f"uniswap-probe/factory_{pool['fee']}.json")['result'][-40:] == FACTORY[2:], 'Pool factory mismatch')
    for index, sample in enumerate(result['samples']):
        receipt = response(f'uniswap-probe/receipt_{index}.json')['result']
        block = response(f'uniswap-probe/block_{index}.json')['result']
        require(receipt['transactionHash'] == sample['transaction_hash'], 'Transaction binding mismatch')
        require(receipt['blockHash'] == block['hash'] == sample['block_hash'], 'Block binding mismatch')
        require(sample['transaction_hash'] in block['transactions'] and receipt['status'] == '0x1', 'Unmined or failed sample')
        require(any(log['address'].lower() == sample['pool'].lower() and log['topics'][0] == SWAP for log in receipt['logs']), 'Swap event missing')
    require(isinstance(response('uniswap-probe/call_trace.json')['result'], dict), 'Call trace missing')
    return {'swap_samples': len(result['samples']), 'pools': len(result['pools']), 'pinned_head': head['number'],
        'captured_at': summary['checked_at'], 'complete_dependency_coverage': False, 'new_swaps_submitted': False}


def controlled_workload():
    run = load('bal-phase5/fork-analysis.json')
    workload = load('bal-phase5/workload.json')
    require(run['network'] == 'sepolia-fork' and run['mode'] == 'fork' and str(run['chain_id']) == '31337', 'Fork scope mismatch')
    require(run['block']['hash'] == workload['block_hash'] and run['native_bal'] is None, 'Fork identity/native-BAL mismatch')
    for case in workload['cases']:
        tx = next(item for item in run['analyzed_transactions'] if item['transaction']['hash'] == case['hash'])
        require(tx['receipt']['status'] == case['expected_status'], 'Workload receipt outcome mismatch')
        require(tx['receipt']['blockHash'] == workload['block_hash'], 'Workload block mismatch')
        calls = [item for item in run['uniswap_swap_calls'] if item['transaction_hash'] == case['hash']]
        require(bool(calls), 'Workload swap call absent')
        if case['expected_status'] == '0x0':
            require(all(not call['committed'] for call in calls) and not tx['receipt']['logs'], 'Reverted call incorrectly committed')
    return {'cases': [case['case'] for case in workload['cases']], 'chain_id': '31337', 'mode': 'fork',
        'fork_parent_number': workload['fork_parent_number'], 'native_bal': None, 'executed_by_verifier': False}


def frame():
    probe = probe_result('frame-probe')['result']
    genesis = response('frame-probe/genesis.json')['result']
    require(genesis['hash'] == probe['genesis_hash'], 'Frame genesis mismatch')
    seen = probe['source_reported_inclusion']
    receipt = response('frame-probe/existing_receipt.json')['result']
    require(receipt['transactionHash'] == seen['tx_hash'] and receipt['type'] == '0x6', 'Probe receipt binding mismatch')
    stream = load('frame-probe/stream_result.json')
    require(stream['status'] == 'passed' and stream['subscription_acknowledged'], 'Frame stream not verified')
    included = load('frame-phase4/existing-included.json')
    rejected = load('frame-phase4/own-rejection.json')
    proof = included['receipt_check']
    require(included['network'] == 'frame-devnet' and included['inclusion_confirmed'], 'Frame scope/inclusion mismatch')
    require(proof['receipt']['transactionHash'] == included['tx_hash'] and proof['receipt']['type'] == '0x6', 'Receipt binding mismatch')
    require(proof['canonical'] and proof['identity_matched'], 'Recorded canonical check absent')
    require(rejected['status'] == 'rejected' and not rejected['admission_confirmed'], 'Rejection became admission')
    return {'genesis_hash': genesis['hash'], 'probe_inclusion': seen['tx_hash'], 'stream_replayed_events': stream['replayed_events'],
        'third_party_inclusion': included['tx_hash'], 'receipt_check_at': proof['checked_at'],
        'canonicality_rechecked_now': False, 'own_funded_submission': 'not_attempted', 'own_rejection': rejected['tx_hash']}


def anon_rpc():
    path = REFERENCE / 'anon-rpc-probe/browser-state.txt'
    if not path.exists():
        raise NotRecorded('no_browser_capture')
    text = path.read_text()
    require('transport_status: ready' in text and 'read_status: result_shown' in text, 'Browser capture did not complete a read')
    require('Nox ready; destination chain verified through worker' in text and 'completed via anonymous' in text, 'Nox read proof missing')
    require((REFERENCE / 'anon-rpc-probe/browser-proof.png').exists(), 'Browser screenshot missing')
    started = next(line.split(': ', 1)[1] for line in text.splitlines() if line.startswith('started_at_utc: '))
    return {'worker': 'Nox', 'surface': 'dashboard Private RPC view', 'successful_read': 'eth_getBlockByNumber',
        'captured_at': started, 'controlled_endpoint_source_visibility_verified': False}


def cre():
    path = REFERENCE / 'cre-probe/result.json'
    if not path.exists():
        raise NotRecorded('no_cre_attempt')
    result = json.loads(path.read_text())
    if result['status'] != 'passed':
        raise NotRecorded(f"{result['reason']} (attempted {result['checked_at']})")
    value = result['result']
    require(value['http_value_verified'] and value['evm_tick_spacing_verified'] and not value['broadcast'], 'CRE simulation did not verify')
    return {'execution_mode': 'cli_simulation', 'captured_at': result['checked_at'], 'production_don_deployment': False}


def verify():
    checks = {}
    # No findings are accepted until all archived bytes match the manifest.
    try:
        checks['archive_integrity'] = {'status': 'passed', 'result': integrity()}
    except (OSError, ValueError, KeyError) as error:
        return {'schema': 'rooted.phase1-recorded-v1', 'status': 'failed',
            'mode': MODE, 'reason': str(error), 'checks': {}}
    for name, check in (('sepolia', sepolia), ('uniswap', uniswap),
        ('controlled_workload', controlled_workload), ('frame', frame), ('anon_rpc', anon_rpc), ('cre', cre)):
        try:
            checks[name] = {'status': 'passed', 'result': check()}
        except NotRecorded as reason:
            checks[name] = {'status': 'not_recorded', 'reason': str(reason)}
        except (OSError, ValueError, KeyError, TypeError, StopIteration, common.ProbeError, subprocess.TimeoutExpired) as error:
            checks[name] = {'status': 'failed', 'reason': str(error)}
    return {'schema': 'rooted.phase1-recorded-v1', 'mode': MODE, 'verified_at': common.now(),
        'status': 'failed' if any(value['status'] == 'failed' for value in checks.values()) else 'passed', 'checks': checks}


if __name__ == '__main__':
    if sys.argv[1:] == ['--write-manifest']:
        print(json.dumps({'manifest_files': write_manifest()}))
        raise SystemExit(0)
    report = verify()
    print(json.dumps(report, indent=2))
    raise SystemExit(0 if report['status'] == 'passed' else 1)
