"""Verify Sepolia Uniswap v3 pools and replay a bounded existing swap sample."""
import probe_common as common

FACTORY = '0x0227628f3f023bb0b980b67d528571c95c6dac1c'
WETH = '0xfff9976782d46cc05630d1f6ebab18b2324d6b14'
USDC = '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238'
SWAP = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67'


def word(address):
    return address[2:].rjust(64, '0')


def main():
    common.chain('chain_id', common.EL)
    block = common.rpc('head', 'eth_getBlockByNumber', ['latest', False])
    selector = {'blockHash': block['hash'], 'requireCanonical': True}
    pools, samples = [], []
    for fee in (500, 3000):
        data = '0x1698ee82' + word(WETH) + word(USDC) + format(fee, '064x')
        raw = common.rpc(f'pool_{fee}', 'eth_call', [{'to': FACTORY, 'data': data}, selector])
        pool = '0x' + raw[-40:]
        if int(raw, 16) == 0:
            continue
        factory = common.rpc(f'factory_{fee}', 'eth_call', [{'to': pool, 'data': '0xc45a0155'}, selector])
        if factory[-40:].lower() != FACTORY[2:]:
            raise common.ProbeError('pool_factory_mismatch')
        logs = common.rpc(f'logs_{fee}', 'eth_getLogs', [{'address': pool,
            'fromBlock': hex(max(0, int(block['number'], 16) - 1000)), 'toBlock': block['number'], 'topics': [SWAP]}])
        pools.append({'address': pool, 'fee': fee, 'factory_verified': True, 'sampled_events': len(logs)})
        for log in logs[-2:]:
            tx = log['transactionHash']
            receipt = common.rpc(f'receipt_{len(samples)}', 'eth_getTransactionReceipt', [tx])
            execution = common.rpc(f'block_{len(samples)}', 'eth_getBlockByHash', [receipt['blockHash'], False])
            matching = [event for event in receipt['logs'] if event.get('address', '').lower() == pool.lower()
                and event.get('topics', [None])[0] == SWAP and event.get('logIndex') == log.get('logIndex')]
            if receipt.get('transactionHash') != tx or execution.get('hash') != receipt['blockHash'] or tx not in execution['transactions'] or receipt.get('status') != '0x1' or not matching:
                raise common.ProbeError('swap_receipt_binding_mismatch')
            samples.append({'transaction_hash': tx, 'block_hash': execution['hash'], 'pool': pool,
                'receipt_status': receipt['status'], 'gas_used': receipt['gasUsed']})
    # A number-bounded log scan is rechecked against the pinned head identity.
    current = common.rpc('head_recheck', 'eth_getBlockByNumber', [block['number'], False])
    if current['hash'] != block['hash']:
        raise common.ProbeError('canonical_head_changed')
    if not samples:
        raise common.ProbeError('no_swaps_in_bounded_search')
    common.chain('trace_chain_id', common.TRACE)
    trace = common.optional(lambda: common.rpc('call_trace', 'debug_traceTransaction', [samples[0]['transaction_hash'], {'tracer': 'callTracer', 'timeout': '5s'}], common.TRACE))
    return {'network': 'sepolia', 'chain_id': '11155111', 'protocol': 'Uniswap v3',
        'pools': pools, 'samples': samples, 'call_trace_status': trace['status'],
        'call_trace_reason': trace.get('reason'), 'scope': 'read_only_existing_swaps',
        'controlled_workload_executed': False, 'complete_read_write_coverage': False}


if __name__ == '__main__':
    raise SystemExit(common.run('uniswap', main))
