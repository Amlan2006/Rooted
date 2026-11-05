"""Bounded, read-only Phase 1 probes with isolated local evidence."""
import datetime as dt
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import uuid
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
EL = os.environ.get('ROOTED_EXECUTION_URL', 'https://ethereum-sepolia-rpc.publicnode.com')
CL = os.environ.get('ROOTED_BEACON_URL', 'https://ethereum-sepolia-beacon-api.publicnode.com')
TRACE = os.environ.get('ROOTED_TRACE_URL', 'https://sepolia.drpc.org')
GENESIS = '0xd8ea171f3c94aea21ebc42a1ed61052acf3f9209c00e4efbaaddac09ed9b8078'
READ_METHODS = frozenset(('eth_chainId', 'web3_clientVersion', 'eth_blockNumber',
    'eth_getBlockByNumber', 'eth_getBlockByHash', 'eth_getBlockAccessList',
    'eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_getCode',
    'eth_call', 'eth_getLogs', 'debug_traceTransaction', 'trace_replayTransaction',
    'skandha_explorer_info', 'skandha_explorer_listAdmissions',
    'skandha_explorer_getTransaction', 'eth_getFrameTransactionReceipt'))
OUT = None


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


class ProbeError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def configure(name):
    global OUT
    run = os.environ.get('ROOTED_PHASE1_RUN', dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:8])
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', run):
        raise ProbeError('invalid_run_identity')
    OUT = ROOT / '.tools' / 'phase1' / run / name
    OUT.mkdir(parents=True, exist_ok=False)
    return OUT


def save(name, value):
    if OUT is None or not re.fullmatch(r'[A-Za-z0-9_-]+', name):
        raise ProbeError('invalid_evidence_name')
    # Repeated requests must never replace the first response.
    with (OUT / (name + '.json')).open('x') as file:
        json.dump(value, file, indent=2)
        file.write('\n')


def endpoint(value):
    url = urlsplit(value)
    if url.scheme not in ('http', 'https') or not url.hostname or url.fragment:
        raise ProbeError('invalid_endpoint')
    return value


def request(name, url, payload=None, stream=False):
    endpoint(url)
    if payload is not None and payload.get('method') not in READ_METHODS:
        raise ProbeError('rpc_method_not_allowed')
    started = now()
    # Temporary bodies and curl diagnostics stay inside ignored Rooted storage.
    with tempfile.TemporaryDirectory(dir=OUT) as directory:
        body_path = Path(directory) / 'response'
        command = ['curl', '--disable', '--silent', '--show-error',
            '--connect-timeout', '5', '--max-time', '10' if stream else '15',
            '--max-filesize', str(32 * 1024 * 1024), '--output', str(body_path),
            '--write-out', '%{http_code}', '--url', url]
        if payload is not None:
            command += ['-H', 'Content-Type: application/json', '--data-binary', json.dumps(payload)]
        if stream:
            command += ['--no-buffer', '-H', 'Accept: text/event-stream']
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=20)
            code, http = result.returncode, result.stdout.strip()
        except subprocess.TimeoutExpired:
            code, http = 28, '000'
        body = body_path.read_text(errors='replace') if body_path.exists() else ''
    origin = urlsplit(url)
    record = {'started_at_utc': started, 'source_origin': f'{origin.scheme}://{origin.hostname}',
        'request': payload, 'http_status': http, 'curl_exit': code, 'body': body,
        'mode': 'live_probe_attempt'}
    save(name, record)
    if code and not (stream and code == 28 and http == '200'):
        raise ProbeError({5: 'proxy_dns_unavailable', 6: 'dns_unavailable',
            7: 'connection_unavailable', 28: 'upstream_timeout', 63: 'response_too_large'}.get(code, 'transport_unavailable'))
    if http != '200':
        raise ProbeError('rate_limited' if http == '429' else 'http_' + http)
    if stream:
        return {'event_types': sorted(set(line[6:].strip() for line in body.splitlines() if line.startswith('event:'))),
            'bytes': len(body.encode()), 'original_arrival_timing_verified': False}
    try:
        value = json.loads(body)
    except ValueError:
        raise ProbeError('malformed_json') from None
    if not isinstance(value, dict):
        raise ProbeError('invalid_response')
    if 'error' in value:
        error = value['error']
        raise ProbeError('rpc_unsupported' if isinstance(error, dict) and error.get('code') == -32601 else 'rpc_error')
    return value


def rpc(name, method, params, url=None):
    value = request(name, url or EL, {'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params})
    if 'result' not in value:
        raise ProbeError('rpc_result_missing')
    if value['result'] is None:
        raise ProbeError('not_found')
    return value['result']


def chain(name, url, expected=11155111):
    value = rpc(name, 'eth_chainId', [], url)
    if not isinstance(value, str) or not re.fullmatch(r'0x[0-9a-fA-F]+', value):
        raise ProbeError('invalid_chain_id')
    if int(value, 16) != expected:
        raise ProbeError('network_mismatch')
    return str(expected)


def optional(function):
    try:
        return {'status': 'available', 'value': function()}
    except ProbeError as error:
        return {'status': 'unavailable', 'reason': error.code}


def run(name, main):
    configure(name)
    try:
        report = {'status': 'passed', 'result': main()}
        code = 0
    except ProbeError as error:
        report, code = {'status': 'blocked', 'reason': error.code}, 1
    except (KeyError, TypeError, ValueError, IndexError):
        report, code = {'status': 'failed', 'reason': 'invalid_source_data'}, 1
    report.update({'schema': 'rooted.phase1-probe-v1', 'probe': name,
        'checked_at': now(), 'mode': 'live_probe_attempt'})
    save('result', report)
    print(json.dumps({'probe': name, 'status': report['status'],
        'reason': report.get('reason'), 'evidence': str(OUT.relative_to(ROOT))}))
    return code
