#!/usr/bin/env python3
"""Compare two saved Rooted frame states; exit 1 on new failures, 2 on lost coverage.

This compares recorded outcomes. It does not execute transactions or establish
that a code change caused a difference. Use controlled scenarios for CI.
"""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_state(path):
    value = json.loads(Path(path).read_text())
    if isinstance(value, dict) and 'data' in value:
        value = value['data']
        if not isinstance(value, list) or len(value) != 1:
            raise ValueError('Save exactly one transaction state per comparison file')
        value = value[0]
    if not isinstance(value, dict) or not isinstance(value.get('admission'), dict):
        raise ValueError('A real admission report is required in each saved state')
    return value


def compare(baseline, candidate):
    for field in ('network', 'mode', 'node'):
        if not baseline.get(field) or baseline.get(field) != candidate.get(field):
            raise ValueError('Comparison network, evidence mode, and node must match')
    def rules(state):
        result = {}
        for check in state['admission'].get('checks', []):
            key = (check['rule'], check.get('frameIndex'), check.get('entity'))
            # If a node returns multiple checks under one identity, failure wins.
            prior = result.get(key)
            priority = {'pass': 0, 'skipped': 1, 'fail': 2}
            if prior is None or priority.get(check['verdict'], 1) > priority.get(prior['verdict'], 1):
                result[key] = check
        return result
    before, after = rules(baseline), rules(candidate)
    regressions, unavailable = [], []
    for key, check in before.items():
        if check['verdict'] != 'pass':
            continue
        new = after.get(key)
        if new is None or new['verdict'] != 'pass':
            item = {'rule': key[0], 'frame_index': key[1], 'entity': key[2],
                    'before': 'pass', 'after': new['verdict'] if new else 'absent',
                    'detail': new.get('detail') if new else None}
            (regressions if new and new['verdict'] == 'fail' else unavailable).append(item)
    if baseline.get('execution_success') is True and candidate.get('execution_success') is False:
        regressions.append({'rule': 'canonical_execution', 'before': 'success', 'after': 'reverted'})
    frame_changes = []
    frames_before = baseline['admission'].get('frames', [])
    frames_after = candidate['admission'].get('frames', [])
    for index in range(max(len(frames_before), len(frames_after))):
        old = frames_before[index] if index < len(frames_before) else None
        new = frames_after[index] if index < len(frames_after) else None
        if old != new:
            frame_changes.append({'index': index, 'before': old, 'after': new})
    same_sender = baseline['admission'].get('sender') == candidate['admission'].get('sender')
    return {'mode': 'recorded-outcome-comparison', 'network': baseline['network'],
            'node': baseline['node'], 'evidence_mode': baseline['mode'],
            'baseline_hash': baseline.get('tx_hash'), 'candidate_hash': candidate.get('tx_hash'),
            'same_node_boot': baseline.get('boot_id') == candidate.get('boot_id'),
            'same_sender': same_sender, 'regressions': regressions,
            'lost_check_coverage': unavailable, 'changed_frames': frame_changes,
            'causality_verified': False,
            'notes': ['Use the same scenario and record node version, policy, block/state, and code revision for a controlled regression test.',
                      'Frame gas limits are budgets, not measured execution gas.',
                      'A passed comparison proves only that the compared checks did not regress; it is not an admission guarantee.']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline', required=True)
    parser.add_argument('--candidate', required=True)
    parser.add_argument('--output')
    args = parser.parse_args()
    try:
        report = compare(load_state(args.baseline), load_state(args.candidate))
    except (ValueError, KeyError, TypeError) as exc:
        parser.error(str(exc))
    text = json.dumps(report, indent=2) + '\n'
    if args.output:
        output = (ROOT / args.output).resolve()
        if not output.is_relative_to(ROOT):
            parser.error('--output must stay inside Rooted')
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open('x') as file:
            file.write(text)
    print(text, end='')
    return 1 if report['regressions'] else (2 if report['lost_check_coverage'] else 0)


if __name__ == '__main__':
    raise SystemExit(main())
