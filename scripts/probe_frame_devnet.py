"""Read-only frame gateway/miner checks; does not sign, submit or call faucets."""
import os
import probe_common as common

GENESIS = os.environ.get('ROOTED_FRAME_GENESIS_HASH',
    '0x2ad3f67b059fbde111ad7af27cfb4955d997351579612237ca0318937a5bae7a').lower()


def main():
    execution = os.environ.get('ROOTED_FRAME_EXECUTION_URL', 'https://altmempool.forshtat.com')
    common.chain('execution_chain', execution, 1337)
    genesis = common.rpc('genesis', 'eth_getBlockByNumber', ['0x0', False], execution)
    if genesis.get('hash') != GENESIS:
        raise common.ProbeError('frame_genesis_mismatch')
    nodes = {}
    included = None
    for name, url in (
        ('gateway', os.environ.get('ROOTED_FRAME_GATEWAY_URL', 'https://altmempoolgateway.forshtat.com/rpc')),
        ('miner', os.environ.get('ROOTED_FRAME_MINER_URL', 'https://altmempool.forshtat.com/rpc')),
    ):
        try:
            common.chain(name + '_chain', url, 1337)
            info = common.rpc(name + '_info', 'skandha_explorer_info', [], url)
            if info.get('protocolVersion') != 1 or info.get('chainId') != 1337:
                raise common.ProbeError('frame_protocol_mismatch')
            admissions = common.rpc(name + '_admissions', 'skandha_explorer_listAdmissions', [{'limit': 5}], url)
            nodes[name] = {'status': 'available', 'protocol_version': 1, 'client_version': info.get('version'),
                'boot_id': info.get('bootId'), 'retained_admissions': len(admissions.get('items', []))}
            if included is None:
                hashes = [i['txHash'] for i in admissions.get('items', []) if i.get('outcome') == 'included']
                if hashes:
                    included = (name, url, hashes[0])
        except common.ProbeError as error:
            nodes[name] = {'status': 'unavailable', 'reason': error.code}
    if not any(value['status'] == 'available' for value in nodes.values()):
        raise common.ProbeError('no_frame_node_available')
    example = {'status': 'not_observed'}
    if included:
        # One source-reported inclusion, with its execution and supplemental frame receipts.
        name, url, tx_hash = included
        detail = common.optional(lambda: common.rpc('existing_detail', 'skandha_explorer_getTransaction', [tx_hash], url))
        receipt = common.optional(lambda: common.rpc('existing_receipt', 'eth_getTransactionReceipt', [tx_hash], execution))
        frame = common.optional(lambda: common.rpc('existing_frame_receipt', 'eth_getFrameTransactionReceipt', [tx_hash], url))
        example = {'status': 'observed', 'node': name, 'tx_hash': tx_hash,
            'detail': detail['status'], 'execution_receipt': receipt['status'], 'frame_receipt': frame['status'],
            'receipt_type': receipt.get('value', {}).get('type'),
            'receipt_hash_matches': receipt.get('value', {}).get('transactionHash') == tx_hash}
    return {'network': 'frame-devnet', 'chain_id': '1337', 'genesis_hash': GENESIS,
        'nodes': nodes, 'source_reported_inclusion': example,
        'funded_own_submission': 'not_attempted_requires_funding',
        'canonical_inclusion_proof': 'not_attempted_in_discovery_probe'}


if __name__ == '__main__':
    raise SystemExit(common.run('frame', main))
