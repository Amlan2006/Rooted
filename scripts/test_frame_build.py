"""Offline checks for the frame transaction builder (needs Foundry cast, no network)."""
import hashlib
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_frame_transaction as frame  # noqa: E402

KEY = '0x' + '11' * 32


class BuildTest(unittest.TestCase):
    def test_default_is_byte_identical_to_pre_refactor_builder(self):
        tx, expected = frame.build(KEY, 0)
        # Pinned from the inline builder before build() existed.
        self.assertEqual(expected, '0x19d2ce13792bc1af1f007ad3fdd7fbc9ceab94611021d6a69dc80b529dbcc8fa')
        self.assertEqual(hashlib.sha256(json.dumps(tx).encode()).hexdigest(), '39ff2edba0d4cd9b8079d1d7196c4cd391b355b66d7f71d730b1804d63f7dc53')
        self.assertEqual(tx['sender'], '0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A')

    def test_overrides_change_only_their_fields(self):
        base, base_hash = frame.build(KEY, 3)
        tx, tx_hash = frame.build(KEY, 3, {'verify_execution': 97201, 'verify_state': 195840, 'nonce_keys': [0, 307]})
        self.assertNotEqual(tx_hash, base_hash)
        self.assertEqual(tx['frames'][0]['limits'], {'execution': hex(97201), 'state': hex(195840)})
        self.assertEqual(tx['nonceKeys'], ['0x0', '0x133'])
        self.assertEqual(tx['nonceSeq'], '0x3')
        self.assertEqual(tx['frames'][1:], base['frames'][1:])
        empty, _ = frame.build(KEY, 0, {'nonce_keys': []})
        self.assertEqual(empty['nonceKeys'], [])
        fees, _ = frame.build(KEY, 0, {'fees': (2, 3, 0)})
        self.assertEqual(fees['fees'], {'maxPriorityFeePerGas': '0x2', 'maxFeePerGas': '0x3', 'maxFeePerBlobGas': '0x0'})
        with self.assertRaises(ValueError):
            frame.build(KEY, 0, {'verify_gas': 1})

    def test_builder_never_pre_rejects_65_frames(self):
        tx, expected = frame.build(KEY, 0, {'extra_sender_frames': 64})
        self.assertEqual(len(tx['frames']), 65)
        self.assertTrue(all(f['mode'] == 2 and f['value'] == '0x0' and f['limits']['execution'] == hex(5000) for f in tx['frames'][1:]))
        self.assertRegex(expected, '^0x[0-9a-f]{64}$')

    def test_rlp_vectors(self):
        self.assertEqual(frame.rlp(0), b'\x80')
        self.assertEqual(frame.rlp([]), b'\xc0')
        self.assertEqual(frame.rlp(b'dog'), b'\x83dog')
        self.assertEqual(frame.rlp(b'x' * 56)[:2], b'\xb8\x38')


if __name__ == '__main__':
    unittest.main()
