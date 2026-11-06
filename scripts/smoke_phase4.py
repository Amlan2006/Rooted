#!/usr/bin/env python3
"""Read-only checks for stored frame-devnet observations exposed by Rooted."""
import argparse
import json
import os
from pathlib import Path
import secrets
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
GENESIS = os.environ.get('ROOTED_FRAME_GENESIS_HASH',
    '0x2ad3f67b059fbde111ad7af27cfb4955d997351579612237ca0318937a5bae7a').lower()


def safe_output(path_text):
    path = (ROOT / path_text).resolve()
    if not path.is_relative_to(ROOT):
        raise ValueError('--output must stay inside Rooted')
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', default='http://127.0.0.1:8080')
    parser.add_argument('--output', default=None,
                        help='New report path inside Rooted; defaults to an ignored unique run')
    args = parser.parse_args()
    output = safe_output(args.output or (Path('.tools') / 'phase4-smoke' /
                                         secrets.token_hex(8) / 'report.json'))
    scope = 'network=frame-devnet&node=gateway'

    def get(path):
        with urllib.request.urlopen(args.base.rstrip('/') + path, timeout=15) as response:
            if response.status != 200:
                raise RuntimeError(f'unexpected HTTP status {response.status}')
            return json.load(response)

    node = get('/api/v1/frames/node?' + scope)['data']
    if node['chain_id'] != '1337' or node['genesis_hash'].lower() != GENESIS:
        raise RuntimeError('frame node identity mismatch')
    states = get('/api/v1/frames/transactions?' + scope)['data']
    if not states or not all(s['network'] == 'frame-devnet' and s['mode'] == 'live' for s in states):
        raise RuntimeError('frame states are missing or mixed across scopes')
    confirmed = [s for s in states if s['inclusion_confirmed']]
    rejected = [s for s in states if s['status'] == 'rejected']
    if not confirmed or not rejected:
        raise RuntimeError('stored observations do not include both inclusion and rejection')
    for state in confirmed:
        proof = state['receipt_check']
        if proof['canonical'] is not True or proof['identity_matched'] is not True:
            raise RuntimeError('inclusion proof is not canonical and identity matched')
        if proof['receipt']['transactionHash'].lower() != state['tx_hash'].lower():
            raise RuntimeError('receipt hash does not match state hash')
        if state['status'] not in ('included', 'reverted'):
            raise RuntimeError('canonical receipt has an invalid derived status')
    for state in rejected:
        admission = state.get('admission') or {}
        if admission.get('outcome') != 'rejected' or not any(c.get('verdict') == 'fail' for c in admission.get('checks', [])):
            raise RuntimeError('rejection is missing explicit source failure evidence')
    tx_hash = confirmed[0]['tx_hash']
    evidence = get(f'/api/v1/frames/transactions/{tx_hash}/evidence?{scope}')['data']
    if not evidence:
        raise RuntimeError('raw evidence endpoint returned no evidence')
    if get('/api/v1/frames/transactions?' + scope + '&mode=synthetic')['data']:
        raise RuntimeError('live and synthetic scopes mixed')
    try:
        get('/api/v1/frames/transactions?network=sepolia')
    except urllib.error.HTTPError as error:
        if error.code != 400:
            raise RuntimeError('wrong frame network returned the wrong status') from error
    else:
        raise RuntimeError('wrong frame network was accepted')
    attempts = get('/api/v1/frames/submissions?' + scope)['data']
    if not attempts:
        raise RuntimeError('submission archive is empty')
    own = attempts[0]
    if own['submission_status'] == 'rpc_rejected':
        if 'error' not in own['response']:
            raise RuntimeError('RPC rejection lost its source error')
        observed = get(f"/api/v1/frames/transactions/{own['expected_hash']}?{scope}")['data']
        if not any(s['status'] == 'rejected' and not s['admission_confirmed'] for s in observed):
            raise RuntimeError('recorded rejection was not separated from admission')
    report = {
        'node': node,
        'states': states,
        'incidents': get('/api/v1/frames/incidents?' + scope)['data'],
        'submissions': attempts,
        'example_evidence': evidence,
    }
    with output.open('x') as handle:
        json.dump(report, handle, indent=2)
        handle.write('\n')
    # These are intentionally separate inputs for the read-only comparison tool.
    baseline = safe_output(output.parent.relative_to(ROOT) /
                           (output.stem + '-baseline.json'))
    candidate = safe_output(output.parent.relative_to(ROOT) /
                            (output.stem + '-candidate.json'))
    with baseline.open('x') as handle:
        json.dump(next(s for s in confirmed if s.get('execution_success')), handle, indent=2)
        handle.write('\n')
    with candidate.open('x') as handle:
        json.dump(rejected[0], handle, indent=2)
        handle.write('\n')
    print(json.dumps({'result': 'passed', 'states': len(states),
                      'receipt_verified_inclusions': len(confirmed),
                      'rejected': len(rejected), 'stream': node['stream_status'],
                      'submission_attempts': len(attempts), 'evidence': str(output)}, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, RuntimeError, urllib.error.URLError) as error:
        raise SystemExit(f'Frame smoke did not complete: {error}') from None
