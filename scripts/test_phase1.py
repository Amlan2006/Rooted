import copy
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import probe_common as common
from probe_sepolia import correlate
import verify_phase1_recorded as recorded


class ProbeBoundaries(unittest.TestCase):
    def setUp(self):
        base = common.ROOT / '.tools'
        base.mkdir(exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(dir=base)
        self.old_output = common.OUT
        common.OUT = Path(self.temporary.name)

    def tearDown(self):
        common.OUT = self.old_output
        self.temporary.cleanup()

    @staticmethod
    def curl(body, code=0, http='200'):
        def respond(command, **kwargs):
            Path(command[command.index('--output') + 1]).write_text(body)
            return subprocess.CompletedProcess(command, code, http, 'credential-bearing upstream detail')
        return respond

    def test_dns_failure_is_recorded_without_json_parse_failure(self):
        with patch('probe_common.subprocess.run', side_effect=self.curl('', 6, '000')):
            with self.assertRaisesRegex(common.ProbeError, 'dns_unavailable'):
                common.request('failed', 'https://example.test')
        value = json.loads((common.OUT / 'failed.json').read_text())
        self.assertEqual(value['curl_exit'], 6)
        self.assertNotIn('stderr', value)

    def test_successful_evidence_cannot_be_overwritten(self):
        common.save('saved', {'valid': True})
        with self.assertRaises(FileExistsError):
            common.save('saved', {'valid': False})
        self.assertTrue(json.loads((common.OUT / 'saved.json').read_text())['valid'])

    def test_run_identity_cannot_escape_rooted(self):
        with patch.dict('os.environ', {'ROOTED_PHASE1_RUN': '../../outside'}):
            with self.assertRaisesRegex(common.ProbeError, 'invalid_run_identity'):
                common.configure('sepolia')

    def test_write_method_rejected_before_network(self):
        with patch('probe_common.subprocess.run') as network:
            with self.assertRaisesRegex(common.ProbeError, 'rpc_method_not_allowed'):
                common.rpc('write', 'eth_sendRawTransaction', ['0x'])
            network.assert_not_called()

    def test_faucet_method_is_not_a_capability_read(self):
        self.assertNotIn('skandha_explorer_faucet', common.READ_METHODS)

    def test_credentials_and_paths_absent_from_source_metadata(self):
        with patch('probe_common.subprocess.run', side_effect=self.curl('{"result":"0x1"}')):
            common.rpc('read', 'eth_chainId', [], 'https://user:secret@example.test/private?token=secret')
        value = json.loads((common.OUT / 'read.json').read_text())
        self.assertEqual(value['source_origin'], 'https://example.test')
        self.assertNotIn('secret', json.dumps(value))

    def test_null_result_stays_not_found(self):
        with patch('probe_common.subprocess.run', side_effect=self.curl('{"result":null}')):
            with self.assertRaisesRegex(common.ProbeError, 'not_found'):
                common.rpc('null', 'eth_getBlockByHash', ['0x', False])

    def test_unsupported_method_is_distinct_from_transport_failure(self):
        with patch('probe_common.subprocess.run', side_effect=self.curl('{"error":{"code":-32601}}')):
            with self.assertRaisesRegex(common.ProbeError, 'rpc_unsupported'):
                common.rpc('unsupported', 'eth_getBlockAccessList', ['0x'])

    def test_rate_limit_is_distinct(self):
        with patch('probe_common.subprocess.run', side_effect=self.curl('', 0, '429')):
            with self.assertRaisesRegex(common.ProbeError, 'rate_limited'):
                common.rpc('limited', 'eth_chainId', [])

    def test_invalid_response_is_not_a_success(self):
        with patch('probe_common.subprocess.run', side_effect=self.curl('<html>')):
            with self.assertRaisesRegex(common.ProbeError, 'malformed_json'):
                common.rpc('invalid', 'eth_chainId', [])

    def test_wrong_chain_is_rejected(self):
        with patch('probe_common.rpc', return_value='0x1'):
            with self.assertRaisesRegex(common.ProbeError, 'network_mismatch'):
                common.chain('chain', 'https://example.test')


class CapturedIdentity(unittest.TestCase):
    def setUp(self):
        self.beacon = recorded.response('sepolia-probe/beacon_block.json')['data']['message']
        self.envelope = recorded.response('sepolia-probe/payload_envelope.json')
        self.execution = recorded.response('sepolia-probe/execution_block.json')['result']

    def test_recorded_identifiers_match_without_invented_timing(self):
        result = correlate(self.beacon, self.envelope, self.execution)
        self.assertTrue(result['identifiers_matched'])
        self.assertIsNone(result['reveal_latency_ms'])
        self.assertIsNone(result['ptc_timely'])
        self.assertFalse(result['beacon_root_checked_against_header'])

    def test_wrong_state_root_is_rejected(self):
        self.execution['stateRoot'] = '0x' + '0' * 64
        with self.assertRaisesRegex(common.ProbeError, 'payload_identity_mismatch'):
            correlate(self.beacon, self.envelope, self.execution)

    def test_wrong_slot_builder_and_root_are_rejected(self):
        for field, value in (('slotNumber', '0x1'), ('parentBeaconBlockRoot', '0x0')):
            execution = copy.deepcopy(self.execution)
            execution[field] = value
            with self.assertRaises(common.ProbeError):
                correlate(self.beacon, self.envelope, execution)
        self.envelope['data']['message']['builder_index'] = '0'
        with self.assertRaises(common.ProbeError):
            correlate(self.beacon, self.envelope, self.execution)

    def test_competing_root_is_rejected(self):
        with self.assertRaises(common.ProbeError):
            correlate(self.beacon, self.envelope, self.execution, '0x' + '0' * 64)

    def test_tampered_archive_fails_before_findings(self):
        manifest = copy.deepcopy(recorded.load('manifest.json'))
        manifest['files'][0]['sha256'] = '0' * 64
        real_load = recorded.load
        with patch('verify_phase1_recorded.load', side_effect=lambda name: manifest if name == 'manifest.json' else real_load(name)):
            result = recorded.verify()
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(result['checks'], {})

    def test_unlisted_archive_file_fails_before_findings(self):
        manifest = copy.deepcopy(recorded.load('manifest.json'))
        manifest['files'].pop()
        real_load = recorded.load
        with patch('verify_phase1_recorded.load', side_effect=lambda name: manifest if name == 'manifest.json' else real_load(name)):
            result = recorded.verify()
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(result['checks'], {})

    def test_blocked_attempt_is_not_recorded_not_passed(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch('verify_phase1_recorded.REFERENCE', Path(directory)):
                with self.assertRaisesRegex(recorded.NotRecorded, 'no_cre_attempt'):
                    recorded.cre()
                (Path(directory) / 'cre-probe').mkdir()
                (Path(directory) / 'cre-probe/result.json').write_text(json.dumps(
                    {'status': 'blocked', 'reason': 'cre_authentication_required', 'checked_at': 'now'}))
                with self.assertRaisesRegex(recorded.NotRecorded, 'cre_authentication_required'):
                    recorded.cre()
                with self.assertRaisesRegex(recorded.NotRecorded, 'no_browser_capture'):
                    recorded.anon_rpc()


if __name__ == '__main__':
    unittest.main()
