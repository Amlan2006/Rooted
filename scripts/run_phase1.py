"""Run Rooted capability gates; every invocation gets a new evidence directory."""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import uuid
import probe_common as common
from verify_phase1_recorded import verify


def execute(command, env, timeout):
    try:
        return subprocess.run(command, cwd=common.ROOT, env=env,
            capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return subprocess.CompletedProcess(command, 124, '', 'probe_timeout')


def tools():
    result = {}
    for name in ('python3', 'curl', 'node', 'npm', 'go', 'cast', 'forge', 'anvil', 'docker', 'bun', 'cre'):
        path = shutil.which(name)
        if not path:
            result[name] = {'status': 'missing'}
            continue
        try:
            run = subprocess.run([path, 'version' if name in ('go', 'cre') else '--version'],
                capture_output=True, text=True, timeout=5)
            result[name] = {'status': 'available' if run.returncode == 0 else 'unavailable',
                'version': run.stdout.splitlines()[0][:160] if run.stdout else None}
        except subprocess.TimeoutExpired:
            result[name] = {'status': 'timeout'}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline', action='store_true', help='Validate recorded evidence and local prerequisites without remote probes')
    args = parser.parse_args()
    run_id = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:8]
    output = common.ROOT / '.tools' / 'phase1' / run_id
    output.mkdir(parents=True, exist_ok=False)
    env = dict(os.environ, ROOTED_PHASE1_RUN=run_id, PYTHONDONTWRITEBYTECODE='1')
    report = {'schema': 'rooted.phase1-run-v1', 'run_id': run_id, 'checked_at': common.now(),
        'tools': tools(), 'recorded': verify(), 'fresh': {},
        'limitations': ['The recorded section re-verifies the archived captures offline; only the fresh section reflects this run.',
            'No signing, faucet requests, funding, deployment, or transaction submission is performed.']}
    if not args.offline:
        for probe in ('sepolia', 'uniswap', 'frame_devnet', 'cre'):
            name = 'frame' if probe == 'frame_devnet' else probe
            completed = execute([sys.executable, str(common.ROOT / 'scripts' / f'probe_{probe}.py')], env, 180)
            result_path = output / name / 'result.json'
            report['fresh'][name] = json.loads(result_path.read_text()) if result_path.exists() else {
                'status': 'failed', 'reason': 'probe_did_not_produce_result', 'exit_code': completed.returncode}
    node = shutil.which('node')
    if node:
        test = execute([node, '--experimental-transform-types', '--test',
            str(common.ROOT / 'integrations/anon-rpc/probe/private-rpc.test.ts')], env, 30)
        (output / 'anon-rpc-tests.log').write_text(test.stdout + test.stderr)
        report['anon_rpc_transport_tests'] = {'status': 'passed' if test.returncode == 0 else 'failed'}
    else:
        report['anon_rpc_transport_tests'] = {'status': 'blocked', 'reason': 'node_missing'}
    if not args.offline and node:
        stream = execute([node, str(common.ROOT / 'scripts/probe_frame_stream.mjs')], env, 30)
        stream_path = output / 'frame_stream' / 'result.json'
        report['fresh']['frame_stream'] = json.loads(stream_path.read_text()) if stream_path.exists() else {
            'status': 'failed', 'reason': 'stream_did_not_produce_result', 'exit_code': stream.returncode}
    report['fresh']['anon_rpc'] = {'status': 'not_run', 'reason': 'requires_browser_worker_check',
        'local_transport_tests_are_network_proof': False}
    report['fresh']['frame_funded_submission'] = {'status': 'not_run', 'reason': 'requires_devnet_funding_and_separate_submission_step'}
    # Do not initiate login or inspect/copy any CLI credentials.
    if args.offline:
        report['fresh']['cre'] = {'status': 'not_run', 'reason': 'offline_mode'}
    (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'run_id': run_id, 'evidence': str(output.relative_to(common.ROOT)),
        'recorded': report['recorded']['status'],
        'fresh': {key: value['status'] for key, value in report['fresh'].items()},
        'anon_rpc_transport_tests': report['anon_rpc_transport_tests']['status']}, indent=2))
    if report['recorded']['status'] != 'passed' or report['anon_rpc_transport_tests']['status'] == 'failed' or any(item['status'] == 'failed' for item in report['fresh'].values()):
        return 1
    # External blockers must never produce a successful live gate; not_run gates need a separate manual step.
    return 0 if args.offline else 2 if any(item['status'] not in ('passed', 'not_run') for item in report['fresh'].values()) else 0


if __name__ == '__main__':
    raise SystemExit(main())
