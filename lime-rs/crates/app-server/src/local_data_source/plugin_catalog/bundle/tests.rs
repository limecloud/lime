use super::*;
use flate2::{write::GzEncoder, Compression};

mod corpus;

fn archive(entries: &[(&str, tar::EntryType, &[u8])]) -> Vec<u8> {
    let encoder = GzEncoder::new(Vec::new(), Compression::default());
    let mut builder = tar::Builder::new(encoder);
    for (path, kind, data) in entries {
        let mut header = tar::Header::new_gnu();
        header.set_mode(0o755);
        header.set_entry_type(*kind);
        header.set_size(data.len() as u64);
        // Write hostile paths directly so the test does not exercise tar's pack guard.
        header.as_mut_bytes()[..path.len()].copy_from_slice(path.as_bytes());
        header.set_cksum();
        builder.append(&header, *data).unwrap();
    }
    builder.into_inner().unwrap().finish().unwrap()
}

fn extract_bytes(bytes: &[u8], limit: u64) -> Result<tempfile::TempDir, String> {
    let mut file = tempfile::NamedTempFile::new().unwrap();
    file.write_all(bytes).unwrap();
    extract_with_limit(file.path(), limit)
}

#[test]
fn bundle_extracts_into_private_directory_and_preserves_file_bytes() {
    let bytes = archive(&[
        ("./", tar::EntryType::Directory, b""),
        (
            ".lime-plugin/plugin.json",
            tar::EntryType::Regular,
            b"{\"name\":\"example\"}",
        ),
        ("bin/run", tar::EntryType::Regular, b"#!/bin/sh\n"),
    ]);
    let extracted = extract_bytes(&bytes, 1024).unwrap();
    assert_eq!(
        fs::read(extracted.path().join("bin/run")).unwrap(),
        b"#!/bin/sh\n"
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(extracted.path().join("bin/run"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o755
        );
    }
    let path = extracted.path().to_owned();
    drop(extracted);
    assert!(!path.exists());
}

#[test]
fn bundle_rejects_traversal_and_windows_paths_on_every_host() {
    for path in [
        "../escape",
        "folder/../escape",
        "/absolute",
        "C:/windows",
        "\\\\host\\share",
        "folder\\file",
    ] {
        assert!(
            extract_bytes(&archive(&[(path, tar::EntryType::Regular, b"bad")]), 1024).is_err(),
            "accepted {path}"
        );
    }
}

#[test]
fn bundle_rejects_links_special_types_duplicates_and_conflicts() {
    for kind in [
        tar::EntryType::Symlink,
        tar::EntryType::Link,
        tar::EntryType::Fifo,
        tar::EntryType::Char,
        tar::EntryType::Block,
    ] {
        assert!(
            extract_bytes(&archive(&[("unsafe", kind, b"")]), 1024).is_err(),
            "accepted {kind:?}"
        );
    }
    for entries in [
        vec![
            ("file", tar::EntryType::Regular, b"".as_slice()),
            ("./file", tar::EntryType::Regular, b"".as_slice()),
        ],
        vec![
            ("parent", tar::EntryType::Regular, b"".as_slice()),
            ("parent/child", tar::EntryType::Regular, b"".as_slice()),
        ],
        vec![
            ("parent/child", tar::EntryType::Regular, b"".as_slice()),
            ("parent", tar::EntryType::Regular, b"".as_slice()),
        ],
        vec![
            ("same", tar::EntryType::Directory, b"".as_slice()),
            ("same", tar::EntryType::Regular, b"".as_slice()),
        ],
    ] {
        assert!(extract_bytes(&archive(&entries), 1024).is_err());
    }
}

#[test]
fn bundle_rejects_crc_truncation_extra_stream_and_expansion_budget() {
    let valid = archive(&[("file", tar::EntryType::Regular, b"12345")]);
    assert!(extract_bytes(&valid, 4).is_err());
    let mut corrupt = valid.clone();
    let trailer = corrupt.len() - 8;
    corrupt[trailer] ^= 0x80;
    assert!(extract_bytes(&corrupt, 100).is_err());
    assert!(extract_bytes(&valid[..valid.len() - 3], 100).is_err());
    let mut extra = valid.clone();
    extra.extend(&valid);
    assert!(extract_bytes(&extra, 100).is_err());
    assert!(extract_bytes(b"PK\x03\x04zip is not tar.gz", 100).is_err());
}

#[test]
fn bundle_bounds_zero_padding_even_when_the_file_content_budget_is_unused() {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::fast());
    let zeros = [0; 64 * 1024];
    for _ in 0..(33 * 16) {
        encoder.write_all(&zeros).unwrap();
    }
    let error = extract_bytes(&encoder.finish().unwrap(), 1).unwrap_err();
    assert!(
        error.contains("metadata") || error.contains("padding"),
        "{error}"
    );
}

#[test]
fn bundle_accepts_gnu_long_name_metadata_within_the_archive_budget() {
    let path = format!("{}/file.txt", ["segment"; 35].join("/"));
    let encoder = GzEncoder::new(Vec::new(), Compression::default());
    let mut builder = tar::Builder::new(encoder);
    let mut header = tar::Header::new_gnu();
    header.set_size(4);
    header.set_mode(0o644);
    header.set_cksum();
    builder
        .append_data(&mut header, &path, b"long".as_slice())
        .unwrap();
    let bytes = builder.into_inner().unwrap().finish().unwrap();
    let directory = extract_bytes(&bytes, 4).unwrap();
    assert_eq!(fs::read(directory.path().join(path)).unwrap(), b"long");
}
