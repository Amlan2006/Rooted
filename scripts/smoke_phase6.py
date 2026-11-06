#!/usr/bin/env python3
"""Read-only dashboard proxy/SSE checks. The real Nox worker is verified separately in-browser."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import secrets
import urllib.request
import urllib.error

ROOT = Path(__file__).resolve().parents[1]


def safe_output(path_text):
    path = (ROOT / path_text).resolve()
    if not path.is_relative_to(ROOT):
        raise ValueError('--output must stay inside Rooted')
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', default='http://127.0.0.1:3000')
    parser.add_argument('--output', default=None)
    args = parser.parse_args()

    output = safe_output(args.output or (Path('.tools') / 'phase6-smoke' /
                                         (secrets.token_hex(8) + '.json')))

    def get(path):
        with urllib.request.urlopen(args.base + '/api/backend' + path, timeout=30) as response:
            assert response.headers['Cache-Control'] == 'no-store'
            return json.load(response)

    assert get('/health')['status'] == 'ok'
    collector = get('/api/v1/collector?network=sepolia')
    source = collector['source']
    scope = f'network=sepolia&mode=live&source={source}'
    slots = get('/api/v1/slots?' + scope)['data']
    assert slots and all(s['mode'] == 'live' and s['network'] == 'sepolia' for s in slots)
    # Live latency is only valid as same-session stream receipt timing; never inferred from polling.
    assert all(s['reveal_latency_ms'] is None or s.get('timing_session') for s in slots)
    synthetic = get('/api/v1/slots?network=sepolia&mode=synthetic&source=phase3-demo')['data']
    assert synthetic and all(s['mode'] == 'synthetic' for s in synthetic)
    sample = next(s for s in synthetic if s['slot'] == '101')
    assert sample['reveal_latency_ms'] == 1000
    timeline = get('/api/v1/payloadwatch/slots/101/timeline?network=sepolia&mode=synthetic&source=phase3-demo')['data']
    assert len(timeline) == 5
    frames = get('/api/v1/frames/transactions?network=frame-devnet&node=gateway')['data']
    assert frames and any(s['inclusion_confirmed'] for s in frames)
    assert get('/api/v1/frames/node?network=frame-devnet')['data']['chain_id'] == '1337'
    native = get('/api/v1/analysis/runs?network=sepolia&limit=1')['data'][0]
    fork = get('/api/v1/analysis/runs?network=sepolia-fork&mode=fork&limit=1')['data'][0]
    assert native['native_bal']['commitment_verified'] is True
    assert fork['mode'] == 'fork' and fork['native_bal'] is None
    assert len(fork['uniswap_swaps']) == 3
    for path, status in [('/api/v1/slots', 400), ('/api/v1/analysis/runs?network=sepolia-fork', 400), ('/api/v1/secrets', 400)]:
        try:
            get(path)
            raise AssertionError('invalid scope/route accepted')
        except urllib.error.HTTPError as error:
            assert error.code == status
    cursor = timeline[-1]['sequence']
    request = urllib.request.Request(args.base + '/api/backend/api/v1/live?network=sepolia&mode=synthetic&source=phase3-demo', headers={'Last-Event-ID': str(cursor)})
    with urllib.request.urlopen(request, timeout=20) as response:
        assert response.headers['Content-Type'] == 'text/event-stream'
        resumed = False
        for _ in range(150):
            line = response.readline().decode().strip()
            if line.startswith('id: '):
                assert int(line[4:]) > cursor
            if line == 'event: snapshot':
                resumed = True
                break
        assert resumed
    report = {'result': 'passed', 'checked_at_utc': datetime.now(timezone.utc).isoformat(timespec='seconds'),
              'live_slots': len(slots), 'synthetic_slots': len(synthetic),
              'frame_states': len(frames), 'native_analysis': native['id'], 'fork_analysis': fork['id'],
              'sse_proxy_resume': True, 'network_mode_separation': True, 'unsupported_proxy_routes_rejected': True,
              'note': 'Nox proof is captured separately from the actual dashboard browser session.'}
    with output.open('x') as handle:
        handle.write(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, AssertionError, urllib.error.URLError) as error:
        raise SystemExit(f'Dashboard smoke did not complete: {error}') from None
