import unittest
from test_frame_transaction import rlp


class FrameCodecTests(unittest.TestCase):
    def test_canonical_rlp_vectors(self):
        self.assertEqual(rlp(0), b'\x80')
        self.assertEqual(rlp([]), b'\xc0')
        self.assertEqual(rlp(b'dog'), b'\x83dog')
        self.assertEqual(rlp([b'cat', b'dog']), bytes.fromhex('c88363617483646f67'))
        self.assertEqual(rlp(1024), bytes.fromhex('820400'))

    def test_long_payload_uses_length_prefix(self):
        self.assertEqual(rlp(b'x' * 56)[:2], bytes.fromhex('b838'))


if __name__ == '__main__':
    unittest.main()
