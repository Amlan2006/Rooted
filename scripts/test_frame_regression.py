import copy
import unittest
from check_frame_regression import compare

class RegressionTests(unittest.TestCase):
    def setUp(self):
        self.state = {'network':'frame-devnet','mode':'synthetic','node':'gateway','boot_id':'a',
                      'admission':{'sender':'test','checks':[{'rule':'structure','verdict':'pass'},
                       {'rule':'storage','verdict':'pass','frameIndex':0,'entity':'sender'}], 'frames':[]}}
    def test_no_change(self):
        self.assertFalse(compare(self.state,self.state)['regressions'])
    def test_failure_and_lost_coverage_differ(self):
        changed=copy.deepcopy(self.state)
        changed['admission']['checks'][0].update(verdict='fail',detail='budget exceeded')
        changed['admission']['checks'][1]['verdict']='skipped'
        report=compare(self.state,changed)
        self.assertEqual(len(report['regressions']),1)
        self.assertEqual(len(report['lost_check_coverage']),1)
        self.assertFalse(report['causality_verified'])
    def test_networks_do_not_mix(self):
        changed=copy.deepcopy(self.state);changed['network']='sepolia'
        with self.assertRaises(ValueError):compare(self.state,changed)
    def test_conflicting_checks_fail_conservatively(self):
        changed=copy.deepcopy(self.state);changed['admission']['checks'].append({'rule':'structure','verdict':'fail'})
        self.assertEqual(len(compare(self.state,changed)['regressions']),1)

if __name__=='__main__':unittest.main()
