"""Recovery policy tests run without touching a real user's Chrome profile."""
import json
import multiprocessing
import os
from pathlib import Path
import tempfile
import time
import types
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).with_name('briar-open-browser').read_text()
SOURCE = SCRIPT.split("<<'BRIAR_BROWSER_PY'\n", 1)[1].split('\nBRIAR_BROWSER_PY', 1)[0]
browser = types.ModuleType('browser')
exec(compile(SOURCE, 'briar-open-browser', 'exec'), browser.__dict__)


def concurrent_request(directory):
    profile = Path(directory)

    def notify(*_):
        # Exclusive creation fails if two requests enter the critical section.
        marker = profile / 'in-flight'
        with marker.open('x'):
            time.sleep(0.05)
        marker.unlink()
        with (profile / 'requests').open('a') as output:
            output.write('opened\n')
        return 123

    with patch.object(browser, 'notify', side_effect=notify), patch.object(browser, 'record_owner'):
        browser.open_browser(profile, 'https://example.test/')


class BrowserRecoveryTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.profile = Path(self.temporary.name) / 'display-2'
        self.profile.mkdir()
        self.runtime = ['boot', 'pid:[1]', '100']
        self.profile.joinpath('Default').mkdir()
        for name in ('Cookies', 'Login Data', 'Preferences'):
            self.profile.joinpath('Default', name).write_bytes(b'preserved-login-data')
        self.links('old-container-123')

    def links(self, owner):
        for name, target in zip(browser.LOCKS, (owner, '/tmp/gone/SingletonSocket', 'cookie')):
            path = self.profile / name
            if path.is_symlink():
                path.unlink()
            path.symlink_to(target)
        return browser.snapshot(self.profile)

    def record(self, links=None, runtime=None):
        self.profile.joinpath('.briar-browser-owner.json').write_text(json.dumps({
            'links': links or browser.snapshot(self.profile), 'runtime': runtime or self.runtime,
            'pid': 123, 'start': '200',
        }))

    def assert_logins(self):
        for name in ('Cookies', 'Login Data', 'Preferences'):
            self.assertEqual(self.profile.joinpath('Default', name).read_bytes(), b'preserved-login-data')

    def test_dead_recorded_owner_recovers_only_singletons(self):
        links = browser.snapshot(self.profile)
        self.record()
        with patch.object(browser, 'runtime_identity', return_value=self.runtime), patch.object(browser, 'process_start', return_value=None):
            browser.recover(self.profile, links)
        self.assertEqual(browser.snapshot(self.profile), {})
        self.assert_logins()

    def test_reused_pid_does_not_block_proven_dead_owner(self):
        self.record()
        with patch.object(browser, 'runtime_identity', return_value=self.runtime), patch.object(browser, 'process_start', return_value='201'):
            browser.recover(self.profile, browser.snapshot(self.profile))
        self.assert_logins()

    def test_active_recorded_owner_is_preserved(self):
        self.record()
        links = browser.snapshot(self.profile)
        with patch.object(browser, 'runtime_identity', return_value=self.runtime), patch.object(browser, 'process_start', return_value='200'):
            with self.assertRaisesRegex(RuntimeError, 'Cannot prove'):
                browser.recover(self.profile, links)
        self.assertEqual(browser.snapshot(self.profile), links)

    def test_absent_pid_and_foreign_hostname_are_not_proof(self):
        links = browser.snapshot(self.profile)
        with patch.object(browser, 'process_start', return_value=None):
            with self.assertRaisesRegex(RuntimeError, 'Cannot prove'):
                browser.recover(self.profile, links)
        self.assertEqual(browser.snapshot(self.profile), links)

    def test_different_namespace_or_boot_is_unknown(self):
        for runtime in (['boot', 'pid:[2]', '100'], ['boot2', 'pid:[1]', '100'], ['boot', 'pid:[1]', '101']):
            self.record()
            with patch.object(browser, 'runtime_identity', return_value=runtime), patch.object(browser, 'process_start', return_value=None):
                with self.assertRaisesRegex(RuntimeError, 'Cannot prove'):
                    browser.recover(self.profile, browser.snapshot(self.profile))

    def test_managed_container_restart_requires_the_same_host_issued_token(self):
        self.links(f'{browser.socket.gethostname()}-123')
        self.record()
        path = self.profile / '.briar-browser-owner.json'
        record = json.loads(path.read_text())
        record['container'] = 'host-issued-unique-container-token'
        path.write_text(json.dumps(record))
        next_runtime = ['boot', 'pid:[2]', '200']
        with patch.object(browser, 'runtime_identity', return_value=next_runtime):
            with patch.dict(os.environ, {'BRIAR_BROWSER_CONTAINER_TOKEN': 'another-container'}):
                with self.assertRaisesRegex(RuntimeError, 'Cannot prove'):
                    browser.recover(self.profile, browser.snapshot(self.profile))
            with patch.dict(os.environ, {'BRIAR_BROWSER_CONTAINER_TOKEN': record['container']}):
                browser.recover(self.profile, browser.snapshot(self.profile))
        self.assert_logins()

    def test_verified_container_retirement_recovers_legacy_lock(self):
        browser.recover(self.profile, browser.snapshot(self.profile), 'old-container')
        self.assertEqual(browser.snapshot(self.profile), {})
        self.assert_logins()

    def test_retirement_does_not_cover_another_owner(self):
        with self.assertRaisesRegex(RuntimeError, 'Cannot prove'):
            browser.recover(self.profile, browser.snapshot(self.profile), 'another-container')

    def test_changed_lock_invalidates_record_and_recovery(self):
        self.record()
        original = browser.snapshot(self.profile)
        current = self.links('other-owner-456')
        with patch.object(browser, 'runtime_identity', return_value=self.runtime), patch.object(browser, 'process_start', return_value=None):
            with self.assertRaisesRegex(RuntimeError, 'Cannot prove'):
                browser.recover(self.profile, current)
            with self.assertRaisesRegex(RuntimeError, 'ownership changed'):
                browser.recover(self.profile, original, 'old-container')
        self.assertEqual(browser.snapshot(self.profile), current)

    def test_regular_file_and_malformed_owner_are_preserved(self):
        with self.assertRaisesRegex(RuntimeError, 'malformed'):
            browser.recover(self.profile, self.links('no-pid'), 'no')
        path = self.profile / 'SingletonCookie'
        path.unlink()
        path.write_text('do not delete')
        with self.assertRaisesRegex(RuntimeError, 'not a Chrome symlink'):
            browser.snapshot(self.profile)
        self.assertEqual(path.read_text(), 'do not delete')

    def test_live_browser_is_reused_without_launching_or_recovering(self):
        with patch.object(browser, 'notify', return_value=123) as notify, patch.object(browser, 'record_owner'), patch.object(browser, 'recover') as recover, patch.object(browser.subprocess, 'Popen') as spawn:
            browser.open_browser(self.profile, 'https://example.test/a?x=$(id)&q=hello world')
        notify.assert_called_once()
        recover.assert_not_called()
        spawn.assert_not_called()
        self.assert_logins()

    def test_unresponsive_browser_is_not_killed_or_relaunched(self):
        original = browser.snapshot(self.profile)
        with patch.object(browser, 'notify', side_effect=RuntimeError('unresponsive')), patch.object(browser.subprocess, 'Popen') as spawn:
            with self.assertRaisesRegex(RuntimeError, 'unresponsive'):
                browser.open_browser(self.profile, 'https://example.test/')
        spawn.assert_not_called()
        self.assertEqual(browser.snapshot(self.profile), original)

    def test_concurrent_requests_are_serialized_on_profile_volume(self):
        context = multiprocessing.get_context('fork')
        children = [context.Process(target=concurrent_request, args=(str(self.profile),)) for _ in range(4)]
        for child in children:
            child.start()
        for child in children:
            child.join(5)
            self.assertEqual(child.exitcode, 0)
        self.assertEqual((self.profile / 'requests').read_text().splitlines(), ['opened'] * 4)
        self.assert_logins()

    def test_socket_acknowledges_exact_url_without_chrome_kill_fallback(self):
        from unittest.mock import MagicMock
        endpoint = self.profile / 'socket-dir'
        endpoint.mkdir()
        (endpoint / 'SingletonCookie').symlink_to('cookie')
        (self.profile / 'SingletonSocket').unlink()
        (self.profile / 'SingletonSocket').symlink_to(endpoint / 'socket')
        connection = MagicMock()
        connection.__enter__.return_value = connection
        connection.getsockopt.return_value = browser.struct.pack('3i', 123, os.getuid(), 0)
        connection.recv.side_effect = [b'A', b'CK']
        with patch.object(browser.socket, 'SO_PEERCRED', 17, create=True), patch.object(browser.socket, 'socket', return_value=connection):
            url = 'https://example.test/a?q=hello world&x=$(id)'
            self.assertEqual(browser.notify(self.profile, browser.snapshot(self.profile), url), 123)
        packet = connection.sendall.call_args.args[0].split(b'\0')
        self.assertEqual(packet, [b'START', os.fsencode(os.getcwd()),
                                 b'/usr/bin/google-chrome-stable', b'--new-window', url.encode()])

    def test_recovered_profile_launches_once_with_login_and_url_arguments(self):
        from unittest.mock import MagicMock
        self.record()
        child = MagicMock()
        child.poll.return_value = 9
        with patch.object(browser, 'runtime_identity', return_value=self.runtime), patch.object(browser, 'process_start', return_value=None), patch.object(browser.subprocess, 'Popen', return_value=child) as spawn:
            with self.assertRaisesRegex(RuntimeError, 'status 9'):
                browser.open_browser(self.profile, 'https://example.test/')
        spawn.assert_called_once()
        args = spawn.call_args.args[0]
        self.assertIn(f'--user-data-dir={self.profile}', args)
        self.assertIn('--password-store=basic', args)
        self.assertEqual(args[-1], 'https://example.test/')
        self.assert_logins()

    def test_missing_socket_returns_no_live_owner(self):
        self.assertIsNone(browser.notify(self.profile, browser.snapshot(self.profile), 'https://example.test/'))


if __name__ == '__main__':
    unittest.main()
