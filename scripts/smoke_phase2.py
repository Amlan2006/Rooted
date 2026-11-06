"""Ingest a selected slot twice and verify stored evidence and service restarts."""
import argparse
import datetime as dt
import json
from pathlib import Path
import re
import subprocess
import uuid
from urllib.parse import urlencode, urlsplit

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / '.tools' / 'phase2-smoke'


def request(output, name, url, method='GET'):
    result = subprocess.run(['curl', '--disable', '--silent', '--show-error',
        '--connect-timeout', '5', '--max-time', '95', '-X', method,
        '--write-out', '\n%{http_code}', '--url', url], capture_output=True, text=True, timeout=100)
    body, _, status = result.stdout.rpartition('\n')
    with (output / (name + '.json')).open('x') as file:
        json.dump({'url': url, 'method': method, 'http_status': status,
            'curl_exit': result.returncode, 'body': body}, file, indent=2)
        file.write('\n')
    if result.returncode or status != '200':
        raise RuntimeError(f'{name}: request failed (HTTP {status}, curl {result.returncode})')
    return json.loads(body)


def local_origin(parser, value):
    url = urlsplit(value)
    if url.scheme != 'http' or url.hostname not in ('localhost', '127.0.0.1', '::1') or url.username or url.password or url.query or url.fragment or url.path not in ('', '/'):
        parser.error('--base must be a loopback HTTP origin')
    return value.rstrip('/')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', default='http://127.0.0.1:8080')
    parser.add_argument('--network', default='sepolia')
    parser.add_argument('--slot', type=int, help='Recent available slot supported by the configured providers')
    parser.add_argument('--verify-restart', metavar='RUN_ID', help='After restarting Rooted, compare its stored response with this earlier run')
    args = parser.parse_args()
    base = local_origin(parser, args.base)
    if args.verify_restart:
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', args.verify_restart):
            parser.error('invalid run identity')
        previous = OUTPUT / args.verify_restart
        before = json.loads((previous / 'read_before_restart.json').read_text())
        local_origin(parser, before['url'].split('/api/', 1)[0])
        output = previous / ('restart-' + uuid.uuid4().hex[:8])
        output.mkdir(parents=True, exist_ok=False)
        request(output, 'health', before['url'].split('/api/', 1)[0] + '/health')
        after = request(output, 'read_after_restart', before['url'])
        if after != json.loads(before['body']):
            raise RuntimeError('Stored response changed across service restart')
        print(json.dumps({'status': 'passed', 'restart_persistence_verified': True,
            'evidence': str(output.relative_to(ROOT))}, indent=2))
        return
    if args.slot is None or not 0 <= args.slot <= 2**64-1:
        parser.error('--slot must be an unsigned 64-bit decimal integer')
    run = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:8]
    output = OUTPUT / run
    output.mkdir(parents=True, exist_ok=False)
    query = urlencode({'network': args.network})
    url = f'{base}/api/v1/slots/{args.slot}'
    request(output, 'health', base + '/health')
    first = request(output, 'ingest_first', url + '/ingest?' + query, 'POST')['data']
    second = request(output, 'ingest_repeat', url + '/ingest?' + query, 'POST')['data']
    stored = request(output, 'read_before_restart', url + '?' + query)['data']
    if not first['block_root'] == second['block_root'] == stored['block_root']:
        raise RuntimeError('Repeated ingestion changed the selected root')
    if stored['status'] != 'observed' or not stored['identifiers_matched']:
        raise RuntimeError('Selected slot does not yet have complete payload/execution evidence')
    for key in ('commitment_seen_at', 'payload_seen_at', 'reveal_latency_ms', 'ptc_timely', 'blob_available', 'execution_valid'):
        if stored[key] is not None:
            raise RuntimeError('Snapshot ingestion fabricated a live timing or health verdict')
    summary = {'schema': 'rooted.phase2-smoke-v1', 'status': 'passed', 'run_id': run,
        'slot': stored['slot'], 'network': stored['network'], 'block_root': stored['block_root'],
        'payload_hash': stored['payload_hash'], 'repeat_ingestion_matched': True,
        'unknown_fields_preserved': True, 'restart_persistence_verified': False,
        'evidence': str(output.relative_to(ROOT))}
    with (output / 'summary.json').open('x') as file:
        json.dump(summary, file, indent=2)
        file.write('\n')
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as error:
        print(f'Phase 2 smoke did not pass: {error}')
        raise SystemExit(1)
