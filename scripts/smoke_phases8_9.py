"""Read-only checks for saved investigation, provider comparison, and replay evidence.

Start Rooted after building it and applying migrations. A missing saved report
is recorded as open, never counted as successful live verification. CRE is not
required by this check.
"""
import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import urlencode, urlsplit
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
HASH = re.compile(r'0x[0-9a-fA-F]{64}\Z')


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def origin(value):
    parsed = urlsplit(value)
    if (parsed.scheme != 'http' or parsed.hostname not in ('127.0.0.1', 'localhost', '::1')
            or parsed.username or parsed.password or parsed.query or parsed.fragment
            or parsed.path not in ('', '/')):
        raise ValueError('--base must be a loopback HTTP origin')
    return value.rstrip('/')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', default='http://127.0.0.1:8080')
    parser.add_argument('--dashboard', action='store_true', help='Use the dashboard proxy; set --base to its origin')
    args = parser.parse_args()
    base = origin(args.base) + ('/api/backend' if args.dashboard else '')
    def raw(path):
        with urllib.request.urlopen(base + path, timeout=30) as response:
            return response.read()
    def get(path):
        return json.loads(raw(path))

    report = {'schema': 'rooted.phases8-9-smoke-v1', 'checked_at': dt.datetime.now(dt.timezone.utc).isoformat(),
              'checks': {}, 'open': [], 'cre_required': False}
    require(get('/health')['status'] == 'ok', 'Database is unavailable')
    collector = get('/api/v1/collector?network=sepolia')
    source = collector['source']
    require(bool(source), 'Configured source was not discovered')
    report['checks']['collector_source_discovered'] = True
    scope = urlencode({'network': 'sepolia', 'mode': 'live', 'source': source, 'limit': 5})
    slots = get('/api/v1/slots?' + scope)['data']
    require(all(s['network'] == 'sepolia' and s['mode'] == 'live' and s['source_id'] == source for s in slots), 'Mixed payload scopes')
    report['checks']['payload_scope_isolated'] = True

    analyses = get('/api/v1/analysis/runs?network=sepolia&mode=live&limit=1')['data']
    if analyses:
        run = analyses[0]
        require(HASH.fullmatch(run['id']) and HASH.fullmatch(run['block']['hash']), 'Invalid analysis identity')
        for view in ('bal', 'dependencies', 'uniswap', 'evidence'):
            data = get(f"/api/v1/analysis/runs/{run['id']}/{view}?network=sepolia&mode=live")
            require(data['id'] == run['id'], 'Analysis view changed identity')
        for key in ('graph', 'storage_projection'):
            graph = run[key]
            require(graph['full_dependency_coverage'] is False and graph['theoretical_speedup'] is None, 'Partial graph presented as complete')
        report['checks']['saved_analysis_views'] = True
    else:
        report['open'].append('No saved live analysis; ingest a block or transaction first')

    comparisons = get('/api/v1/providers/comparisons?network=sepolia')['data']
    if comparisons:
        comparison = comparisons[0]
        require(comparison['network'] == 'sepolia' and comparison['mode'] == 'live', 'Wrong comparison scope')
        require(len(comparison['observations']) == 2, 'Expected both provider observations')
        saved = get(f"/api/v1/providers/comparisons/{comparison['id']}?network=sepolia")['data']
        require(saved == comparison, 'Comparison changed while reading')
        report['checks']['saved_provider_comparison'] = True
    else:
        report['open'].append('No saved provider comparison; run rooted compare-providers')

    profiles = get('/api/v1/profiles?network=sepolia&mode=replay')['data']
    if profiles:
        profile = profiles[0]
        require(profile['network'] == 'sepolia' and profile['mode'] == 'replay', 'Wrong profile scope')
        metrics = profile['metrics']
        require(metrics['runner'] == 'rooted-native-replay-v1' and metrics['block_hash'].lower() == profile['block_hash'].lower(), 'Unbound native replay')
        require(len(metrics['samples']) == len(metrics['control_apply_ns']) == 7, 'Incomplete sample pairs')
        for sample in metrics['samples']:
            require(sample['apply_ns'] > 0 and 0 <= sample['state_inside_evm_ns'] <= min(sample['evm_call_ns'], sample['state_access_ns']), 'Invalid replay timing')
            require(sample['evm_call_ns'] + sample['state_access_ns'] - sample['state_inside_evm_ns'] <= sample['apply_ns'], 'Overlapping replay partition')
            require(sum(tx['apply_ns'] for tx in sample['transactions']) == sample['apply_ns'], 'Transaction times do not reconcile')
        capture = raw(f"/api/v1/profiles/{profile['id']}/capture?network=sepolia&mode=replay")
        require(hashlib.sha256(capture).hexdigest() == profile['capture_digest'], 'Saved capture digest changed')
        require(json.loads(capture)['block']['hash'].lower() == profile['block_hash'].lower(), 'Capture block identity changed')
        report['checks']['saved_profile_capture_and_timers'] = True
    else:
        report['open'].append('No saved replay; build rooted-replay and profile a supported recent block')

    report['status'] = 'passed' if not report['open'] else 'partial'
    output = ROOT / '.tools' / 'phases8-9-smoke' / uuid.uuid4().hex
    output.mkdir(parents=True, exist_ok=False)
    (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'status': report['status'], 'checks': report['checks'], 'open': report['open'],
                      'evidence': str(output.relative_to(ROOT))}, indent=2))
    return 0 if report['status'] == 'passed' else 2


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, RuntimeError) as error:
        raise SystemExit('Phase 8/9 smoke did not pass: ' + str(error)) from None
