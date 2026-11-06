"""Submit one self-transfer on the throwaway sponsor devnet using faucet funds.

Requires curl and Foundry cast. The fresh private key exists in memory only.
This is a smoke test, not a production wallet or general-purpose transaction SDK.
"""
import argparse
import json
from pathlib import Path
import secrets
import subprocess
import time
import tempfile
import os
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
EXECUTION = os.environ.get('ROOTED_FRAME_EXECUTION_URL', 'https://altmempool.forshtat.com')
GATEWAY = os.environ.get('ROOTED_FRAME_GATEWAY_URL', 'https://altmempoolgateway.forshtat.com/rpc')
MINER = os.environ.get('ROOTED_FRAME_MINER_URL', 'https://altmempool.forshtat.com/rpc')
OUT = None


def request(name, method, params, endpoint):
    if OUT is None:
        raise RuntimeError('Explicit --submit setup is required before a request')
    origin = urlsplit(endpoint)
    if origin.scheme not in ('http', 'https') or not origin.hostname or origin.fragment:
        raise RuntimeError('Invalid devnet endpoint')
    payload = {'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params}
    with tempfile.TemporaryDirectory(dir=OUT) as temporary:
        body_path = Path(temporary) / 'body.json'
        run = subprocess.run(['curl', '--disable', '--silent', '--show-error',
            '--connect-timeout', '5', '--max-time', '20', '--max-filesize', str(16 << 20),
            '--output', str(body_path), '--write-out', '%{http_code}',
            '-H', 'Content-Type: application/json', '--data-binary', json.dumps(payload),
            '--url', endpoint], capture_output=True, text=True, timeout=25)
        body = body_path.read_text() if body_path.exists() else ''
    with (OUT / (name + '.json')).open('x') as file:
        json.dump({'method': method, 'source_origin': f'{origin.scheme}://{origin.hostname}',
            'http_status': run.stdout.strip(), 'curl_exit': run.returncode, 'body': body}, file, indent=2)
        file.write('\n')
    if run.returncode or run.stdout.strip() != '200':
        raise RuntimeError('Devnet RPC transport failed; inspect local evidence')
    response = json.loads(body)
    if not isinstance(response, dict):
        raise RuntimeError('Invalid devnet RPC response')
    return response


def rpc(name, method, params, endpoint=GATEWAY):
    response = request(name, method, params, endpoint)
    if not isinstance(response, dict) or 'error' in response or 'result' not in response:
        raise RuntimeError(f'{name} failed; inspect saved response')
    return response['result']


def cast(*args):
    try:
        run = subprocess.run(['cast', *args], capture_output=True, text=True, timeout=20)
    except subprocess.TimeoutExpired:
        raise RuntimeError('Foundry cast timed out') from None
    if run.returncode:
        # Do not echo commands or stderr containing signing material.
        raise RuntimeError('Foundry cast failed')
    return run.stdout.strip()


def rlp(value):
    if isinstance(value, int):
        value = value.to_bytes((value.bit_length() + 7) // 8, 'big')
    if isinstance(value, list):
        data = b''.join(rlp(item) for item in value)
        offset = 0xc0
    else:
        data = value
        if len(data) == 1 and data[0] < 0x80:
            return data
        offset = 0x80
    if len(data) < 56:
        return bytes([offset + len(data)]) + data
    size = len(data).to_bytes((len(data).bit_length() + 7) // 8, 'big')
    return bytes([offset + 55 + len(size)]) + size + data


def main():
    global OUT
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--submit', action='store_true', help='Request one faucet funding and submit a signed devnet self-transfer')
    parser.add_argument('--faucet-node', choices=['gateway','miner'], default='gateway', help='Which devnet node to ask for faucet funds')
    parser.add_argument('--record', action='store_true', help='Submit once through the Rooted CLI and persist the attempt separately from admission')
    parser.add_argument('--output', help='New evidence directory inside Rooted; defaults to an ignored unique run directory')
    parser.add_argument('--unfunded-rejection', action='store_true', help='Skip faucet and test rejection with a fresh unfunded account')
    args = parser.parse_args()
    if not args.submit:
        parser.error('Use --submit to explicitly enable the devnet smoke test')
    output = Path(args.output) if args.output else Path('.tools/frame-transaction') / secrets.token_hex(8)
    OUT = (ROOT / output).resolve()
    if not OUT.is_relative_to(ROOT):
        parser.error('--output must stay inside Rooted')
    OUT.mkdir(parents=True, exist_ok=False)
    assert rlp(0) == b'\x80' and rlp([]) == b'\xc0' and rlp(b'dog') == b'\x83dog'
    chain = rpc('chain', 'eth_chainId', [], EXECUTION)
    if int(chain, 16) != 1337:
        raise RuntimeError('Unexpected chain; refusing to fund or submit')
    genesis = rpc('genesis', 'eth_getBlockByNumber', ['0x0', False], EXECUTION)
    if genesis.get('hash') != os.environ.get('ROOTED_FRAME_GENESIS_HASH', '0x2ad3f67b059fbde111ad7af27cfb4955d997351579612237ca0318937a5bae7a'):
        raise RuntimeError('Unexpected genesis; refusing to fund or submit')
    key = '0x' + secrets.token_hex(32)
    address = cast('wallet', 'address', '--private-key', key)
    print(json.dumps({'test_address': address, 'unfunded_rejection_test': args.unfunded_rejection}), flush=True)
    if not args.unfunded_rejection:
        rpc('faucet', 'skandha_explorer_faucet', [address], MINER if args.faucet_node == 'miner' else GATEWAY)
        funded = False
        for attempt in range(12):
            balance = rpc('balance_' + str(attempt), 'eth_getBalance', [address, 'latest'], EXECUTION)
            if int(balance, 16) > 10**15:
                funded = True
                break
            time.sleep(3)
        if not funded:
            raise RuntimeError('Faucet balance not confirmed within bounded wait')
    nonce = int(rpc('nonce', 'eth_getTransactionCount', [address, 'latest'], EXECUTION), 16)
    sender = bytes.fromhex(address[2:])
    # Mirrors sponsor codec.ts and buildUnsignedFrameTx: type 0x06, keyed nonce,
    # canonical signature hash, VERIFY(3) followed by a 1-wei self-transfer.
    fields = [1337, [0], nonce, sender,
              [[1, 3, b'', [30000, 0], 0, b''], [2, 0, sender, [50000, 0], 1, b'']],
              [[1, b'', b'', b'']], [10**9, 2 * 10**9, 0], [], []]
    sighash = cast('keccak', '0x' + (b'\x06' + rlp(fields)).hex())
    signature = bytes.fromhex(cast('wallet', 'sign', '--no-hash', '--private-key', key, sighash)[2:])
    parity = signature[-1] - 27 if signature[-1] >= 27 else signature[-1]
    if len(signature) != 65 or parity not in (0, 1):
        raise RuntimeError('Unexpected signature format')
    packed = bytes([parity]) + signature[:64]
    fields[5][0][3] = packed
    tx = {'chainId': hex(1337), 'nonceKeys': ['0x0'], 'nonceSeq': hex(nonce), 'sender': address,
          'frames': [{'mode': 1, 'flags': 3, 'target': None, 'limits': {'execution': hex(30000), 'state': '0x0'}, 'value': '0x0', 'data': '0x'},
                     {'mode': 2, 'flags': 0, 'target': address, 'limits': {'execution': hex(50000), 'state': '0x0'}, 'value': '0x1', 'data': '0x'}],
          'signatures': [{'scheme': 1, 'signer': '0x', 'msg': '0x', 'signature': '0x' + packed.hex()}],
          'fees': {'maxPriorityFeePerGas': hex(10**9), 'maxFeePerGas': hex(2 * 10**9), 'maxFeePerBlobGas': '0x0'},
          'blobVersionedHashes': [], 'recentRootReferences': []}
    expected = cast('keccak', '0x' + (b'\x06' + rlp(fields)).hex())
    if args.record:
        binary = Path(__file__).resolve().parents[1] / '.tools' / 'rooted'
        if not binary.is_file():
            raise RuntimeError('Build .tools/rooted first')
        # A signed transaction is public evidence; the disposable private key is
        # never written. Restrict the temporary file and remove it immediately.
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', dir=OUT) as signed:
            json.dump(tx, signed)
            signed.flush()
            result = subprocess.run([str(binary), 'frame-submit', signed.name, expected, 'gateway'],
                                    capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError('Rooted submission failed; check local backend configuration')
        report = json.loads(result.stdout)
        (OUT / 'recorded_submission.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps(report), flush=True)
        expected_status = 'rpc_rejected' if args.unfunded_rejection else 'submission_acknowledged'
        if report['submission_status'] != expected_status:
            raise RuntimeError('Submission was recorded, but did not reach the expected smoke-test outcome')
        return
    submission = request('rejected_submission' if args.unfunded_rejection else 'submission', 'eth_sendFrameTransaction', [tx], GATEWAY)
    if not isinstance(submission, dict) or not isinstance(submission.get('result'), str):
        request('rejected_detail', 'skandha_explorer_getTransaction', [expected], GATEWAY)
        print(json.dumps({'expected_hash': expected, 'admitted': False, 'response': submission}), flush=True)
        return
    tx_hash = submission['result']
    print(json.dumps({'transaction_hash': tx_hash, 'locally_encoded_hash': expected, 'hash_matches': tx_hash.lower() == expected.lower()}), flush=True)
    request('initial_admission', 'skandha_explorer_getTransaction', [tx_hash], GATEWAY)
    for attempt in range(15):
        receipt = rpc('receipt_' + str(attempt), 'eth_getTransactionReceipt', [tx_hash], EXECUTION)
        if receipt:
            print(json.dumps({'receipt': receipt}), flush=True)
            break
        time.sleep(3)
    for name, method, endpoint in [
        ('gateway_detail', 'skandha_explorer_getTransaction', GATEWAY),
        ('miner_detail', 'skandha_explorer_getTransaction', MINER),
        ('status', 'skandha_frameTransactionStatus', GATEWAY),
        ('frame_receipt', 'eth_getFrameTransactionReceipt', GATEWAY),
    ]:
        request(name, method, [tx_hash], endpoint)


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired):
        raise SystemExit('Frame smoke did not complete; inspect local configuration and evidence.') from None
