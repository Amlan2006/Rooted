"""Read-only Sepolia identity, immutable-root correlation, BAL and trace checks."""
import shutil
import subprocess
import probe_common as common


def correlate(beacon, envelope, execution, expected_root=None):
    bid = beacon['body']['signed_execution_payload_bid']['message']
    message = envelope['data']['message']
    payload = message['payload']
    checks = (payload.get('block_hash') == bid['block_hash'],
        execution.get('hash') == bid['block_hash'],
        int(payload['block_number']) == int(execution['number'], 16),
        payload.get('state_root') == execution.get('stateRoot'),
        bid['slot'] == beacon['slot'] == payload['slot_number'],
        int(execution['slotNumber'], 16) == int(beacon['slot']),
        message['builder_index'] == bid['builder_index'],
        beacon['parent_root'] == bid['parent_block_root'] == message['parent_beacon_block_root'] == execution['parentBeaconBlockRoot'],
        payload['parent_hash'] == bid['parent_block_hash'] == execution['parentHash'],
        expected_root is None or message['beacon_block_root'] == expected_root)
    if not all(checks):
        raise common.ProbeError('payload_identity_mismatch')
    return {'slot': beacon['slot'], 'payload_hash': bid['block_hash'],
        'builder_index': bid['builder_index'], 'identifiers_matched': True,
        'beacon_root_checked_against_header': expected_root is not None,
        'execution_number': execution['number'], 'bal_commitment': execution.get('blockAccessListHash'),
        'reveal_latency_ms': None, 'ptc_timely': None, 'blob_available': None,
        'independent_execution_validity': None}


def main():
    common.chain('chain_id', common.EL)
    genesis = common.request('beacon_genesis', common.CL.rstrip('/') + '/eth/v1/beacon/genesis')['data']
    if genesis.get('genesis_validators_root') != common.GENESIS:
        raise common.ProbeError('beacon_genesis_mismatch')
    header = common.request('beacon_header', common.CL.rstrip('/') + '/eth/v1/beacon/headers/head')['data']
    root = header['root']
    beacon = common.request('beacon_block', common.CL.rstrip('/') + '/eth/v2/beacon/blocks/' + root)
    message = beacon['data']['message']
    envelope = common.request('payload_envelope', common.CL.rstrip('/') + '/eth/v1/beacon/execution_payload_envelopes/' + root)
    committed = message['body']['signed_execution_payload_bid']['message']['block_hash']
    execution = common.rpc('execution_block', 'eth_getBlockByHash', [committed, False])
    if header['header']['message']['slot'] != message['slot']:
        raise common.ProbeError('beacon_header_slot_mismatch')
    result = correlate(message, envelope, execution, root)
    result.update({'beacon_root': root, 'genesis_validators_root': common.GENESIS,
        'beacon_fork': beacon.get('version'), 'included_ptc_attestations': message['body'].get('payload_attestations', [])})
    result['execution_client'] = common.optional(lambda: common.rpc('execution_client', 'web3_clientVersion', []))
    result['beacon_client'] = common.optional(lambda: common.request('beacon_client', common.CL.rstrip('/') + '/eth/v1/node/version'))
    bal = common.optional(lambda: common.rpc('native_bal', 'eth_getBlockAccessList', [committed]))
    result['native_bal_getter'] = {'status': bal['status'], 'reason': bal.get('reason'),
        'accounts': len(bal['value']) if isinstance(bal.get('value'), list) else None}
    encoded = envelope['data']['message']['payload'].get('block_access_list')
    result['envelope_bal_present'] = isinstance(encoded, str) and encoded.startswith('0x')
    result['envelope_commitment_verified'] = None
    if result['envelope_bal_present'] and result['bal_commitment'] and shutil.which('cast'):
        digest = subprocess.run(['cast', 'keccak'], input=encoded, capture_output=True, text=True, timeout=15)
        if digest.returncode == 0:
            result['envelope_commitment_verified'] = digest.stdout.strip().lower() == result['bal_commitment'].lower()
            if not result['envelope_commitment_verified']:
                raise common.ProbeError('bal_commitment_mismatch')
    result['stream'] = common.optional(lambda: common.request('events', common.CL.rstrip('/') + '/eth/v1/events?topics=block,execution_payload,execution_payload_gossip,execution_payload_available,payload_attestation_message', stream=True))
    transactions = execution.get('transactions', [])
    if transactions:
        common.chain('trace_chain_id', common.TRACE)
        result['prestate_trace'] = common.optional(lambda: common.rpc('prestate_trace', 'debug_traceTransaction', [transactions[0], {'tracer': 'prestateTracer', 'timeout': '5s'}], common.TRACE))
        # Full opcode coverage and dependency reconstruction belong to Phase 5.
        result['prestate_trace'].pop('value', None)
    return result


if __name__ == '__main__':
    raise SystemExit(common.run('sepolia', main))
