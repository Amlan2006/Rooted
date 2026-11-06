"""Offline checks for the frame conformance runner (needs Foundry cast, no network)."""
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import frame_conformance as fc  # noqa: E402

REJECTED = {'outcome': 'rejected', 'checks': [{'rule': 'gas-limit', 'verdict': 'pass'},
                                               {'rule': 'structure', 'verdict': 'fail', 'detail': 'too many frames'},
                                               {'rule': 'signature', 'verdict': 'skipped'}]}


class RunnerTest(unittest.TestCase):
    def test_verdict_prefers_rpc_answer_then_admission(self):
        ack = {'acknowledged': True, 'error_code': None, 'error_message': None}
        error = {'acknowledged': False, 'error_code': -32602, 'error_message': 'bad'}
        lost = {'acknowledged': False, 'error_code': None, 'error_message': None}
        self.assertEqual(fc.verdict(ack, {'outcome': 'accepted', 'checks': []}), ('accept', None))
        self.assertEqual(fc.verdict(error, REJECTED), ('reject', 'structure'))
        self.assertEqual(fc.verdict(error, None), ('reject', None))
        self.assertEqual(fc.verdict(lost, REJECTED), ('reject', 'structure'))
        self.assertEqual(fc.verdict(lost, {'outcome': 'included', 'checks': []}), ('accept', None))
        self.assertEqual(fc.verdict(lost, None), ('unknown', None))

    def test_failed_checks_keep_only_failures_with_entity_shape(self):
        self.assertEqual(fc.failed_checks(REJECTED), [{'rule': 'structure', 'detail': 'too many frames', 'frameIndex': None, 'entity': ''}])
        self.assertEqual(fc.failed_checks(None), [])

    def test_rpc_answer(self):
        self.assertEqual(fc.rpc_answer({'result': '0x' + '1' * 64})['acknowledged'], True)
        self.assertEqual(fc.rpc_answer({'error': {'code': -32500, 'message': 'x'}}), {'acknowledged': False, 'error_code': -32500, 'error_message': 'x'})
        self.assertEqual(fc.rpc_answer({'transport': 'unavailable_or_response_lost'}), {'acknowledged': False, 'error_code': None, 'error_message': None})

    def test_submission_cap(self):
        self.assertTrue(fc.within_cap(15, 10))
        self.assertFalse(fc.within_cap(16, 10))
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory) / 'frame-submissions.log'
            log.write_text('{}\n' * 25)
            with mock.patch.object(fc.frame, 'SUBMISSION_LOG', log):
                self.assertEqual(fc.frame.submissions(), 25)
                with self.assertRaises(RuntimeError):
                    fc.frame.log_submission('test', '0x00')
            self.assertEqual(len(log.read_text().splitlines()), 25)

    def test_case_table_is_complete_and_ordered(self):
        ids = [c['id'] for c in fc.CASES]
        self.assertEqual(ids, ['keys-zero-mixed', 'keys-empty', 'keys-17', 'keys-duplicate', 'keys-16',
                               'verify-99999', 'verify-100000', 'verify-100001', 'frames-64', 'frames-65'])
        for c in fc.CASES + [fc.BASELINE]:
            self.assertEqual(set(c['expected']), set(fc.SOURCES))
            for source, value in c['expected'].items():
                self.assertIn(value, ('accept', 'reject', 'n/a'))
                if value != 'n/a':
                    self.assertTrue(c['expected_basis'].get(source), (c['id'], source))
        # Signature cost is included: the verify boundary sits exactly on 100,000.
        verify = {c['id']: c['overrides']['verify_execution'] + fc.SECP256K1 for c in fc.CASES if c['group'] == 'verify_budget'}
        self.assertEqual(verify, {'verify-99999': 99999, 'verify-100000': 100000, 'verify-100001': 100001})

    def test_every_case_builds_offline(self):
        key = '0x' + '22' * 32
        frames = {}
        for c in fc.CASES:
            tx, tx_hash = fc.frame.build(key, 0, c['overrides'])
            self.assertRegex(tx_hash, '^0x[0-9a-f]{64}$')
            frames[c['id']] = len(tx['frames'])
            self.assertEqual(tx['nonceKeys'], [hex(k) for k in c['overrides'].get('nonce_keys', [0])])
        self.assertEqual((frames['frames-64'], frames['frames-65'], frames['keys-17']), (64, 65, 2))


if __name__ == '__main__':
    unittest.main()
