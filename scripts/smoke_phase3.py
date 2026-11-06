"""Read-only Phase 3 API/SSE smoke check after importing a fresh synthetic dataset."""
import argparse
import datetime as dt
import json
from pathlib import Path
import time
from urllib.parse import urlencode, urlsplit
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', default='http://127.0.0.1:8080')
    parser.add_argument('--source', required=True, help='The synthetic dataset source ID')
    parser.add_argument('--network', default='sepolia')
    args = parser.parse_args()
    origin = urlsplit(args.base)
    if origin.scheme != 'http' or origin.hostname not in ('127.0.0.1', 'localhost', '::1') or origin.username or origin.password or origin.query or origin.fragment or origin.path not in ('', '/'):
        parser.error('--base must be a loopback HTTP origin')
    if not args.source or len(args.source) > 100:
        parser.error('--source must contain 1..100 characters')
    base = args.base.rstrip('/')
    run = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:8]
    output = ROOT / '.tools' / 'phase3-smoke' / run
    output.mkdir(parents=True, exist_ok=False)
    def get(path):
        with urllib.request.urlopen(base + path, timeout=15) as response:
            return response.read().decode()
    def data(path):
        return json.loads(get(path))
    report = {'schema': 'rooted.phase3-smoke-v1', 'source': args.source, 'mode': 'synthetic'}
    def require(condition, reason):
        if not condition:
            raise RuntimeError(reason)
    report['health'] = data('/health')
    require(report['health']['status'] == 'ok', 'Database health is not ready')
    report['collector'] = data('/api/v1/collector?' + urlencode({'network': args.network}))
    live_source = report['collector']['source']
    scope = urlencode({'network': args.network, 'mode': 'synthetic', 'source': args.source})
    report['synthetic'] = data('/api/v1/slots?' + scope)
    states = {row['slot']: row for row in report['synthetic']['data']}
    for slot, status, delivery in [('101', 'healthy', 'revealed'), ('102', 'warning', 'late'),
        ('103', 'warning', 'missing'), ('104', 'failed', 'missing'), ('105', 'failed', 'revealed'),
        ('106', 'pending', 'pending'), ('107', 'warning', 'revealed')]:
        require(slot in states and states[slot]['status'] == status and states[slot]['delivery'] == delivery,
            'Synthetic lifecycle outcome mismatch at slot ' + slot)
    require(states['101']['reveal_latency_ms'] == 1000 and states['106']['reveal_latency_ms'] is None,
        'Synthetic timing or outage semantics changed')
    report['builders'] = data('/api/v1/builders?' + scope + '&window=168h')
    require(bool(report['builders']['data']), 'No builder records in window; generate a fresh dataset with a new source')
    builder = report['builders']['data'][0]
    require((builder['observations'], builder['healthy'], builder['failed'], builder['timed_samples']) == (7, 1, 2, 4),
        'Builder denominator or comparable timing counts changed')
    report['alerts'] = data('/api/v1/alerts?' + scope)
    report['timeline'] = data('/api/v1/payloadwatch/slots/101/timeline?' + scope)
    require(len(report['timeline']['data']) == 5, 'Duplicate or missing timeline evidence')
    cursor = report['timeline']['data'][-1]['sequence']
    tail = data(f'/api/v1/payloadwatch/slots/101/timeline?{scope}&after={cursor}')
    require(not tail['data'], 'Timeline cursor repeated evidence')
    live_scope = urlencode({'network': args.network, 'mode': 'live', 'source': live_source, 'limit': 10})
    report['live'] = data('/api/v1/slots?' + live_scope)
    require(all(row['mode'] == 'live' and row['source_id'] == live_source for row in report['live']['data']),
        'Live query mixed mode/source scopes')
    # Actual live comparable timing is allowed; polling never invents it.
    report['metrics'] = get('/metrics')
    require('mode="synthetic"' not in report['metrics'], 'Synthetic evidence leaked into live metrics')
    request = urllib.request.Request(base + '/api/v1/live?' + scope, headers={'Last-Event-ID': str(cursor)})
    with urllib.request.urlopen(request, timeout=5) as response:
        first_id, snapshot = None, False
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            line = response.readline().decode().strip()
            if line.startswith('id: '):
                sequence = int(line[4:])
                require(sequence > cursor, 'SSE repeated the requested cursor')
                first_id = first_id or sequence
            if line == 'event: snapshot':
                snapshot = True
                break
        require(snapshot, 'SSE did not deliver a current projection within the bound')
        report['sse_resume'] = {'after': cursor, 'first_sequence': first_id, 'snapshot_received': True}
    report['status'] = 'passed'
    with (output / 'report.json').open('x') as file:
        json.dump(report, file, indent=2)
        file.write('\n')
    print(json.dumps({'status': 'passed', 'synthetic_states': len(states),
        'live_source': live_source, 'evidence': str(output.relative_to(ROOT))}, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, RuntimeError) as error:
        raise SystemExit('Phase 3 smoke did not pass: ' + str(error))
