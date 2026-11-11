import io
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

from test_linux_guest import guest, payload


def runtime_archive(root, target):
    with tarfile.open(target, "w:gz", format=tarfile.GNU_FORMAT) as archive:
        archive.add(root, arcname="runtime")
    return guest.digest(target)


class GuestArchiveTests(unittest.TestCase):
    def test_verified_archive_delegates_to_the_existing_installer(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source"
            source.mkdir()
            manifest = payload(source)
            archive = root / "runtime.tar.gz"
            sha = runtime_archive(source, archive)
            state = root / "state"
            calls = []

            def install(source, manifest_sha, start):
                calls.append((guest.verify_payload(source, manifest_sha)["version"], start))

            with patch.object(guest, "state_root", return_value=state), patch.object(guest, "install", side_effect=install):
                guest.install_archive(archive, sha, manifest, True)
            self.assertEqual(calls, [("1.173.0", True)])
            self.assertEqual(list(state.iterdir()), [])

    def test_digest_mismatch_never_calls_install(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source"
            source.mkdir()
            manifest = payload(source)
            archive = root / "runtime.tar.gz"
            sha = runtime_archive(source, archive)
            for archive_sha, manifest_sha in (("0" * 64, manifest), (sha, "0" * 64)):
                with self.subTest(archive_sha=archive_sha), patch.object(guest, "state_root", return_value=root / "state"), patch.object(guest, "install") as install:
                    with self.assertRaises(RuntimeError):
                        guest.install_archive(archive, archive_sha, manifest_sha, True)
                    install.assert_not_called()

    def test_unlisted_file_and_changed_binary_never_call_install(self):
        for change in ("extra", "binary"):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                source = root / "source"
                source.mkdir()
                manifest = payload(source)
                (source / ("unexpected-token" if change == "extra" else "bin/app-server")).write_bytes(b"untrusted")
                archive = root / "runtime.tar.gz"
                sha = runtime_archive(source, archive)
                with patch.object(guest, "state_root", return_value=root / "state"), patch.object(guest, "install") as install:
                    with self.assertRaises(RuntimeError):
                        guest.install_archive(archive, sha, manifest, True)
                    install.assert_not_called()

    def test_links_traversal_duplicates_special_and_extended_headers_fail_closed(self):
        entries = [
            ("runtime/../escape", tarfile.REGTYPE), ("/escape", tarfile.REGTYPE),
            ("runtime/a/../escape", tarfile.REGTYPE), ("runtime\\escape", tarfile.REGTYPE),
            ("second-root/file", tarfile.REGTYPE), ("runtime/link", tarfile.SYMTYPE),
            ("runtime/link", tarfile.LNKTYPE), ("runtime/pipe", tarfile.FIFOTYPE),
            ("runtime/device", tarfile.CHRTYPE), ("runtime/duplicate", tarfile.REGTYPE),
            ("runtime/pax", tarfile.XHDTYPE), ("runtime/gnu", tarfile.GNUTYPE_LONGNAME),
            ("runtime/sparse", tarfile.GNUTYPE_SPARSE),
        ]
        for name, kind in entries:
            with self.subTest(name=name, kind=kind), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                target = root / "bad.tar.gz"
                with tarfile.open(target, "w:gz", format=tarfile.GNU_FORMAT) as archive:
                    top = tarfile.TarInfo("runtime")
                    top.type = tarfile.DIRTYPE
                    archive.addfile(top)
                    entry = tarfile.TarInfo(name)
                    entry.type, entry.linkname = kind, "/etc/passwd"
                    archive.addfile(entry, io.BytesIO())
                    if "duplicate" in name:
                        archive.addfile(entry, io.BytesIO())
                destination = root / "extracted"
                destination.mkdir(mode=0o700)
                with self.assertRaises((RuntimeError, tarfile.TarError)):
                    guest.unpack_payload(target, guest.digest(target), destination)
                self.assertFalse((root / "escape").exists())

    def test_declared_size_limit_is_checked_before_writing_the_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source"
            source.mkdir()
            payload(source)
            archive = root / "runtime.tar.gz"
            sha = runtime_archive(source, archive)
            destination = root / "extracted"
            destination.mkdir(mode=0o700)
            with patch.object(guest, "MAX_PAYLOAD_BYTES", 1):
                with self.assertRaisesRegex(RuntimeError, "limit"):
                    guest.unpack_payload(archive, sha, destination)
            self.assertEqual(list(destination.rglob("app-server")), [])

    def test_archive_symlink_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            file = root / "file"
            file.write_bytes(b"untrusted")
            link = root / "link"
            link.symlink_to(file)
            destination = root / "extracted"
            destination.mkdir(mode=0o700)
            with self.assertRaises(OSError):
                guest.unpack_payload(link, guest.digest(file), destination)

    def test_direct_and_archive_installations_share_one_private_lease(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(guest, "state_root", return_value=root), patch.object(guest, "install_payload") as install:
                with guest.private_lock(root / "installation.lock"):
                    with self.assertRaises(BlockingIOError):
                        guest.install(root, "0" * 64, True)
                    install.assert_not_called()
                guest.install(root, "0" * 64, True)
                install.assert_called_once_with(root, "0" * 64, True)


if __name__ == "__main__":
    unittest.main()
