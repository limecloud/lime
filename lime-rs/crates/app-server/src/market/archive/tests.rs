use super::*;
use crate::market::wire;
use std::io::Cursor;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

#[test]
fn cloud_produced_skill_http_stdio_and_plugin_archives_preserve_their_contracts() {
    let fixtures = wire::tests::cloud_fixtures();
    assert_eq!(fixtures.len(), 4);
    for fixture in &fixtures {
        let item: wire::Item = serde_json::from_value(fixture["item"].clone()).unwrap();
        item.validate().unwrap();
        assert!(item.release.compatible());
        let bytes = hex::decode(fixture["archiveHex"].as_str().unwrap()).unwrap();
        let extracted = extract_bytes(&bytes, &item.release).unwrap();
        assert_eq!(bytes.len() as u64, item.release.archive_size);
        for file in &item.release.manifest.files {
            let body = fs::read(extracted.path().join(&file.path)).unwrap();
            assert_eq!(body.len() as u64, file.size);
            assert_eq!(hex::encode(Sha256::digest(&body)), file.sha256);
        }
        if let Some(mcp) = &item.release.manifest.mcp {
            if mcp.transport == "http" {
                assert!(fs::read_dir(extracted.path()).unwrap().next().is_none());
            } else {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let mode =
                        fs::metadata(extracted.path().join(mcp.executable.as_ref().unwrap()))
                            .unwrap()
                            .permissions()
                            .mode();
                    assert_eq!(mode & 0o100, 0o100);
                }
            }
        }
    }
    let plugin: wire::Item = serde_json::from_value(fixtures[3]["item"].clone()).unwrap();
    let dependencies = &plugin
        .release
        .manifest
        .plugin
        .as_ref()
        .unwrap()
        .dependencies;
    assert_eq!(dependencies.len(), 2);
    for (dependency, fixture) in dependencies.iter().zip(&fixtures) {
        assert_eq!(
            dependency.release_id,
            fixture["item"]["release"]["id"].as_str().unwrap()
        );
        assert_eq!(
            dependency.sha256,
            fixture["item"]["release"]["archiveSha256"]
                .as_str()
                .unwrap()
        );
        assert_eq!(dependency.kind, fixture["item"]["kind"].as_str().unwrap());
    }
}

fn archive(files: &[(&str, &[u8])], method: CompressionMethod) -> Vec<u8> {
    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    for (name, bytes) in files {
        zip.start_file(
            *name,
            SimpleFileOptions::default()
                .compression_method(method)
                .unix_permissions(0o644),
        )
        .unwrap();
        zip.write_all(bytes).unwrap();
    }
    zip.finish().unwrap().into_inner()
}

fn release(files: &[(&str, &[u8])], bytes: &[u8]) -> Release {
    let raw = wire::tests::fixtures().pop().unwrap();
    let mut manifest: wire::Manifest = serde_json::from_value(raw["manifest"].clone()).unwrap();
    manifest.plugin.as_mut().unwrap().entry = files[0].0.into();
    manifest.files = files
        .iter()
        .map(|(name, bytes)| wire::File {
            path: (*name).into(),
            sha256: hex::encode(Sha256::digest(bytes)),
            size: bytes.len() as u64,
        })
        .collect();
    Release {
        id: "release".into(),
        item_id: "item".into(),
        manifest_sha256: manifest.sha256().unwrap(),
        manifest,
        archive_sha256: hex::encode(Sha256::digest(bytes)),
        archive_size: bytes.len() as u64,
        status: "approved".into(),
        revision: 1,
    }
}

fn extract_bytes(bytes: &[u8], release: &Release) -> Result<tempfile::TempDir, String> {
    let mut file = tempfile::NamedTempFile::new().unwrap();
    file.write_all(bytes).unwrap();
    extract(file.path(), release)
}

#[test]
fn cloud_zip_preserves_exact_paths_and_binary_files() {
    let files: &[(&str, &[u8])] = &[
        (".lime-plugin/plugin.json", b"{}"),
        ("assets/payload.bin", &[0, 255, 1, 128]),
    ];
    for method in [CompressionMethod::Stored, CompressionMethod::Deflated] {
        let bytes = archive(files, method);
        let extracted = extract_bytes(&bytes, &release(files, &bytes)).unwrap();
        for (path, content) in files {
            assert_eq!(fs::read(extracted.path().join(path)).unwrap(), *content);
        }
    }
}

#[test]
fn zip_rejects_changed_archive_digest_and_size() {
    let files: &[(&str, &[u8])] = &[("plugin.json", b"original")];
    let bytes = archive(files, CompressionMethod::Stored);
    let mut expected = release(files, &bytes);
    expected.archive_sha256 = "a".repeat(64);
    assert!(extract_bytes(&bytes, &expected).is_err());
    expected = release(files, &bytes);
    expected.archive_size += 1;
    assert!(extract_bytes(&bytes, &expected).is_err());
}

#[test]
fn zip_files_must_match_the_complete_signed_set() {
    let files: &[(&str, &[u8])] = &[("plugin.json", b"original")];
    for replacement in [
        vec![("plugin.json", b"modified".as_slice())],
        vec![("unlisted.sh", b"original".as_slice())],
        vec![
            ("plugin.json", b"original".as_slice()),
            ("unlisted.sh", b"unexpected".as_slice()),
        ],
        Vec::new(),
    ] {
        let bytes = archive(&replacement, CompressionMethod::Deflated);
        assert!(extract_bytes(&bytes, &release(files, &bytes)).is_err());
    }
}

#[test]
fn zip_rejects_symlinks_and_directory_records() {
    let files: &[(&str, &[u8])] = &[("plugin.json", b"target")];
    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    zip.add_symlink("plugin.json", "target", SimpleFileOptions::default())
        .unwrap();
    let bytes = zip.finish().unwrap().into_inner();
    assert!(extract_bytes(&bytes, &release(files, &bytes)).is_err());
    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    zip.add_directory("plugin.json", SimpleFileOptions::default())
        .unwrap();
    let bytes = zip.finish().unwrap().into_inner();
    assert!(extract_bytes(&bytes, &release(files, &bytes)).is_err());
}

#[test]
fn zip_rejects_paths_that_collide_on_case_insensitive_hosts() {
    let files: &[(&str, &[u8])] = &[("plugin.json", b"one"), ("PLUGIN.JSON", b"two")];
    let bytes = archive(files, CompressionMethod::Stored);
    assert!(extract_bytes(&bytes, &release(files, &bytes)).is_err());
}

#[test]
fn zip_rejects_crc_failure_even_with_a_matching_archive_digest() {
    let files: &[(&str, &[u8])] = &[("plugin.json", b"original")];
    let mut bytes = archive(files, CompressionMethod::Stored);
    let central = bytes
        .windows(4)
        .position(|bytes| bytes == b"PK\x01\x02")
        .unwrap();
    bytes[central + 16] ^= 1;
    assert!(extract_bytes(&bytes, &release(files, &bytes)).is_err());
}

#[test]
fn zip_rejects_encrypted_entries_without_requesting_credentials() {
    let files: &[(&str, &[u8])] = &[("plugin.json", b"original")];
    let mut bytes = archive(files, CompressionMethod::Stored);
    let central = bytes
        .windows(4)
        .position(|bytes| bytes == b"PK\x01\x02")
        .unwrap();
    bytes[6] |= 1;
    bytes[central + 8] |= 1;
    assert!(extract_bytes(&bytes, &release(files, &bytes)).is_err());
}

#[test]
fn cloud_archive_does_not_fall_back_to_tar_gz() {
    let files: &[(&str, &[u8])] = &[("plugin.json", b"original")];
    let bytes = include_bytes!("../testdata/rejected-plugin.tar.gz");
    assert!(extract_bytes(bytes, &release(files, bytes)).is_err());
}

#[test]
fn zip_rejects_duplicate_names_hidden_by_the_readers_name_index() {
    let files: &[(&str, &[u8])] = &[("plugin.json", b"original")];
    let mut bytes = archive(
        &[("plugin.json", b"original"), ("plugin.jsom", b"original")],
        CompressionMethod::Stored,
    );
    let occurrences = bytes
        .windows(11)
        .enumerate()
        .filter_map(|(index, name)| (name == b"plugin.jsom").then_some(index))
        .collect::<Vec<_>>();
    assert_eq!(occurrences.len(), 2);
    for index in occurrences {
        bytes[index..index + 11].copy_from_slice(b"plugin.json");
    }
    assert!(extract_bytes(&bytes, &release(files, &bytes)).is_err());
}

#[test]
fn zip_rejects_a_local_header_that_disagrees_with_the_central_directory() {
    let files: &[(&str, &[u8])] = &[("plugin.json", b"original")];
    let mut bytes = archive(files, CompressionMethod::Stored);
    assert_eq!(&bytes[30..41], b"plugin.json");
    bytes[40] = b'm';
    assert!(extract_bytes(&bytes, &release(files, &bytes)).is_err());
}

#[test]
fn zip_respects_cloud_file_and_expansion_limits() {
    let files: &[(&str, &[u8])] = &[("plugin.json", b"original")];
    let bytes = archive(files, CompressionMethod::Stored);
    let mut expected = release(files, &bytes);
    expected.manifest.files[0].size = wire::MAX_EXPANDED_BYTES + 1;
    expected.manifest_sha256 = expected.manifest.sha256().unwrap();
    assert!(extract_bytes(&bytes, &expected).is_err());
    let mut expected = release(files, &bytes);
    expected.manifest.files = (0..=wire::MAX_FILES)
        .map(|index| wire::File {
            path: if index == 0 {
                "plugin.json".into()
            } else {
                format!("file-{index}")
            },
            sha256: hex::encode(Sha256::digest(b"original")),
            size: 8,
        })
        .collect();
    expected.manifest_sha256 = expected.manifest.sha256().unwrap();
    assert!(extract_bytes(&bytes, &expected).is_err());
}
