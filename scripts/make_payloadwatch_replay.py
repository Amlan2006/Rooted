"""Generate a labeled synthetic lifecycle dataset inside Rooted; no network access."""
import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
import uuid

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--source', default='phase3-demo-' + uuid.uuid4().hex[:8])
    parser.add_argument('--network', default='sepolia')
    args = parser.parse_args()
    if not args.source.strip() or len(args.source) > 100 or args.source.strip() != args.source:
        parser.error('--source must contain 1..100 characters without surrounding whitespace')
    if not args.network.strip() or args.network.strip() != args.network:
        parser.error('--network must be an explicit network label')
    output = args.output or Path('.tools') / ('payloadwatch-' + uuid.uuid4().hex[:8] + '.json')
    output = (ROOT / output).resolve()
    if not output.is_relative_to(ROOT):
        parser.error('--output must stay inside Rooted')
    output.parent.mkdir(parents=True, exist_ok=True)
    base = dt.datetime.now(dt.timezone.utc).replace(microsecond=0) - dt.timedelta(seconds=120)
    def stamp(seconds):
        return (base + dt.timedelta(seconds=seconds)).isoformat().replace('+00:00', 'Z')
    def digest(text):
        return '0x' + hashlib.sha256(text.encode()).hexdigest()
    events = []
    def event(slot, kind, seconds=0, session='demo', **extra):
        item = dict(network=args.network, mode='synthetic', source_id=args.source,
            slot=str(slot), block_root=digest(f'root-{slot}'), kind=kind,
            observed_at=stamp(seconds), session=session, timed=True)
        if kind in ('payload_seen', 'validation'):
            item.update(payload_hash=digest(f'payload-{slot}'), builder_index='42')
        item.update(extra)
        events.append(item)
        return item
    for slot in range(101, 108):
        event(slot, 'snapshot', snapshot=dict(network=args.network, slot=str(slot),
            block_root=digest(f'root-{slot}'), payload_hash=digest(f'payload-{slot}'),
            builder_index='42', canonical_at_fetch=True, payload_retrieved=False,
            identifiers_matched=False, included_ptc_attestations=[], fetched_at=stamp(0)))
        event(slot, 'block_seen', session='outage' if slot == 106 else 'demo')
    event(101, 'payload_seen', 1)
    event(101, 'validation', 1.2, valid=True)
    event(101, 'ptc', 2, votes=dict(bits='0xff', payload_present=True, blob_available=True))
    event(102, 'payload_seen', 3)
    event(104, 'payload_seen', 1, payload_hash=digest('wrong'))
    event(105, 'payload_seen', 1)
    event(105, 'validation', 2, valid=False)
    event(107, 'payload_seen', 1)
    event(107, 'ptc', 2, votes=dict(bits='0xff', payload_present=False, blob_available=False))
    # Reverse delivery order and deliberately redeliver one identical snapshot.
    events = list(reversed(events)) + [events[0]]
    dataset = dict(network=args.network, mode='synthetic', source_id=args.source,
        policy=dict(late_ms=2000, missing_ms=8000, ptc_size=8, ptc_quorum=6),
        sessions=[dict(id='demo', start=stamp(-1), through=stamp(20), closed=True),
            dict(id='outage', start=stamp(-1), through=stamp(1), closed=True)], events=events)
    with output.open('x') as file:
        json.dump(dataset, file, indent=2)
        file.write('\n')
    print(json.dumps({'output': str(output.relative_to(ROOT)), 'network': args.network,
        'mode': 'synthetic', 'source': args.source, 'events': len(events)}, indent=2))


if __name__ == '__main__':
    try:
        main()
    except FileExistsError:
        raise SystemExit('Dataset already exists; choose a new output and source for another experiment.')
