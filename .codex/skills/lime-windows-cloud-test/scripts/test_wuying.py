"""Offline behavioral checks; all cloud calls are replaced by local fakes."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch
import zipfile


spec = importlib.util.spec_from_file_location('wuying', Path(__file__).with_name('wuying.py'))
wuying = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wuying)


class RemoteCommandTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.account = root / 'account.json'
        wuying.write_json(self.account, {'end_user_id': 'test-user'})
        self.state = {'desktop_id': 'test-desktop', 'evidence_run': 'offline-check',
                      'cloud_root': 'C:/Users/Public/LimeTest-offline'}
        self.enterContext(patch.object(wuying, 'STATE', root))
        self.enterContext(patch.object(wuying, 'ACCOUNT', self.account))

    def test_remote_paths_stay_in_test_directory(self):
        self.assertEqual(wuying.remote_path(self.state, 'evidence\\summary.json'),
                         self.state['cloud_root'] + '/evidence/summary.json')
        for value in ('../secret', 'a/../../secret', '/absolute', 'C:\\outside',
                      '\\\\server\\share', 'evidence/summary.json:stream'):
            with self.subTest(path=value), self.assertRaises(ValueError):
                wuying.remote_path(self.state, value)

    def run_with_result(self, overall='Success', **changes):
        outcome = {'DesktopId': self.state['desktop_id'], 'ExitCode': 0, 'Dropped': 0,
                   'InvocationStatus': 'Success', 'Output': 'verified'}
        outcome.update(changes)
        result = {'Invocations': [{'InvocationStatus': overall, 'InvokeDesktops': [outcome]}]}
        fake = self.enterContext(patch.object(wuying, 'api', side_effect=[{'InvokeId': 'test-invoke'}, result]))
        return fake, lambda: wuying.invoke("'test'", self.state)

    def test_success_requires_target_exit_code_and_complete_output(self):
        fake, invoke = self.run_with_result()
        self.assertEqual(invoke(), 'verified')
        self.assertEqual([call.args[0] for call in fake.call_args_list],
                         ['RunCommand', 'DescribeInvocations'])
        self.assertEqual(fake.call_args_list[0].args[1]['EndUserId'], 'test-user')
        self.assertEqual(len(list((wuying.STATE / 'evidence').rglob('*.result.json'))), 1)

    def test_failed_or_truncated_results_never_report_success(self):
        for changes in ({'ExitCode': 1}, {'Dropped': 12}, {'InvocationStatus': 'Failed'},
                        {'DesktopId': 'different-desktop'}):
            with self.subTest(result=changes):
                fake, invoke = self.run_with_result(**changes)
                with self.assertRaises(RuntimeError):
                    invoke()
                self.assertEqual(fake.call_count, 2)

    def test_overall_failure_is_rejected_even_with_successful_child(self):
        _, invoke = self.run_with_result(overall='Failed')
        with self.assertRaises(RuntimeError):
            invoke()

    def test_read_poll_retry_keeps_original_invoke_id(self):
        outcome = {'DesktopId': 'test-desktop', 'ExitCode': 0, 'Dropped': 0,
                   'InvocationStatus': 'Success', 'Output': 'done'}
        result = {'Invocations': [{'InvocationStatus': 'Success', 'InvokeDesktops': [outcome]}]}
        with patch.object(wuying, 'api', side_effect=[{'InvokeId': 'original'},
                          RuntimeError('read failed'), result]) as fake:
            self.assertEqual(wuying.invoke("'test'", self.state), 'done')
            self.assertEqual([call.args[0] for call in fake.call_args_list],
                             ['RunCommand', 'DescribeInvocations', 'DescribeInvocations'])
            self.assertEqual([call.args[1]['InvokeId'] for call in fake.call_args_list[1:]],
                             ['original', 'original'])

    def test_unknown_submission_is_not_replayed(self):
        with patch.object(wuying, 'api', side_effect=RuntimeError('submission unknown')) as fake:
            with self.assertRaises(RuntimeError):
                wuying.invoke("'test'", self.state)
            self.assertEqual(fake.call_count, 1)

    def run_lifecycle(self, command, status, final_status=None):
        with patch('sys.argv', ['wuying.py', command]), \
                patch.object(wuying, 'ACTIVE', wuying.STATE / 'active-desktop.json'), \
                patch.object(wuying, 'current', return_value=(self.state, {'DesktopStatus': status})), \
                patch.object(wuying, 'describe', return_value={'DesktopStatus': final_status or status}), \
                patch.object(wuying.time, 'sleep'), \
                patch.object(wuying, 'api', return_value={'RequestId': 'lifecycle'}) as fake, \
                redirect_stdout(io.StringIO()) as output:
            wuying.main()
            return json.loads(output.getvalue()), fake.call_args_list

    def test_stop_requests_stop_charging_once_and_waits_for_stopped(self):
        result, calls = self.run_lifecycle('stop', 'Running', 'Stopped')
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0].args, ('StopDesktops',
                         {'DesktopId.1': 'test-desktop', 'StoppedMode': 'StopCharging'}))
        self.assertEqual(result['status'], 'Stopped')
        self.assertTrue(result['compute_stop_requested'])
        self.assertEqual(result['requested_stopped_mode'], 'StopCharging')
        self.assertEqual(result['compute_billing_status'], 'not_verified')

    def test_already_stopped_does_not_claim_stop_charging_request(self):
        result, calls = self.run_lifecycle('stop', 'Stopped')
        self.assertEqual(calls, [])
        self.assertFalse(result['compute_stop_requested'])
        self.assertIsNone(result['requested_stopped_mode'])
        self.assertEqual(result['compute_billing_status'], 'not_verified')
        self.assertTrue(result['storage_still_billed'])

    def test_transition_does_not_submit_another_lifecycle_request(self):
        with self.assertRaises(RuntimeError):
            self.run_lifecycle('stop', 'Stopping')


class OverlayTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / 'repo'
        self.repo.mkdir()
        self.git('init', '-q')
        (self.repo / 'kept.txt').write_text('base', encoding='utf-8')
        (self.repo / 'deleted.txt').write_text('base', encoding='utf-8')
        self.git('add', '.')
        self.git('-c', 'user.name=Offline test', '-c', 'user.email=offline@localhost',
                 '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture')
        self.output = self.root / 'overlay.zip'

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.repo), *args], stderr=subprocess.STDOUT)

    def test_selected_overlay_excludes_unrelated_changes_and_preserves_digests(self):
        data = '候选补丁\n'.encode('utf-8')
        (self.repo / 'kept.txt').write_bytes(data)
        (self.repo / 'unrelated.txt').write_text('do not ship', encoding='utf-8')
        result = wuying.overlay(self.repo, self.output, ['kept.txt'])
        self.assertEqual(result['files'], 1)
        self.assertEqual(result['sha256'], hashlib.sha256(self.output.read_bytes()).hexdigest())
        with zipfile.ZipFile(self.output) as archive:
            self.assertEqual(set(archive.namelist()), {'kept.txt', 'UI-OVERLAY-MANIFEST.json'})
            manifest = json.loads(archive.read('UI-OVERLAY-MANIFEST.json'))
            self.assertEqual(manifest['head'], self.git('rev-parse', 'HEAD').decode().strip())
            self.assertEqual(manifest['files'], {'kept.txt': hashlib.sha256(data).hexdigest()})
            self.assertEqual(archive.read('kept.txt'), data)
        self.assertEqual(json.loads(self.output.with_suffix('.manifest.json').read_text())['zip_sha256'],
                         result['sha256'])

    def test_missing_selection_is_rejected(self):
        with self.assertRaises(ValueError):
            wuying.overlay(self.repo, self.output, ['kept.txt'])

    def test_deletions_are_not_silently_lost(self):
        (self.repo / 'deleted.txt').unlink()
        with self.assertRaises(RuntimeError):
            wuying.overlay(self.repo, self.output)

    def test_symlinks_are_rejected(self):
        try:
            (self.repo / 'link.txt').symlink_to(self.repo / 'kept.txt')
        except OSError as error:
            self.skipTest('Symlink creation unavailable: ' + str(error))
        with self.assertRaises(RuntimeError):
            wuying.overlay(self.repo, self.output)


if __name__ == '__main__':
    unittest.main()
