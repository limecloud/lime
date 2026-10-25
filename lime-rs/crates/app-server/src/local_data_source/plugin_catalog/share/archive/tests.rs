use super::*;
use flate2::read::GzDecoder;
use std::io::Read;

fn plugin(root: &Path, standard: bool) {
    fs::create_dir_all(root.join(".lime-plugin")).unwrap();
    if standard {
        fs::write(root.join("plugin.json"), r#"{"$schema":"https://agent-plugins.org/schemas/1.0.0/plugin.schema.json","name":"fixture"}"#).unwrap();
    } else {
        // An omitted native name uses the directory/archive filename stem.
        fs::write(root.join(".lime-plugin/plugin.json"), "{}").unwrap();
    }
    fs::create_dir_all(root.join("skills/guide")).unwrap();
    fs::write(
        root.join("skills/guide/SKILL.md"),
        "---\nname: guide\ndescription: guide\n---\nContent",
    )
    .unwrap();
    fs::write(root.join(".hidden"), "included").unwrap();
}

#[test]
fn share_archive_preserves_relative_tree_hidden_files_and_modes() {
    for standard in [false, true] {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("fixture");
        plugin(&root, standard);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(root.join(".hidden"), fs::Permissions::from_mode(0o755)).unwrap();
        }
        let (filename, bytes) = pack(&root).unwrap();
        assert_eq!(filename, "fixture.tar.gz");
        let mut archive = tar::Archive::new(GzDecoder::new(bytes.as_slice()));
        let mut names = Vec::new();
        for entry in archive.entries().unwrap() {
            let mut entry = entry.unwrap();
            let path = entry.path().unwrap().into_owned();
            if path == Path::new(".hidden") {
                let mut text = String::new();
                entry.read_to_string(&mut text).unwrap();
                assert_eq!(text, "included");
                #[cfg(unix)]
                assert_eq!(entry.header().mode().unwrap() & 0o777, 0o755);
            }
            assert!(!path.starts_with("fixture"));
            names.push(path);
        }
        assert!(names.contains(&"skills/guide/SKILL.md".into()));
        assert!(names.contains(&".hidden".into()));
        let archive_file = temp.path().join("package.tar.gz");
        fs::write(&archive_file, bytes).unwrap();
        let extracted = bundle::extract(&archive_file).unwrap();
        assert_eq!(
            fs::read_to_string(extracted.path().join(".hidden")).unwrap(),
            "included"
        );
    }
}

#[test]
fn share_archive_rejects_missing_manifest_and_compressed_overflow() {
    let temp = tempfile::tempdir().unwrap();
    assert!(pack(temp.path()).is_err());
    let root = temp.path().join("fixture");
    plugin(&root, false);
    assert!(pack_with_limit(&root, 16)
        .unwrap_err()
        .contains("compressed size"));
}

#[test]
fn share_archive_roundtrips_shared_core_corpus_without_changing_package_bytes() {
    use sha2::{Digest, Sha256};
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/plugin-archive");
    let index: serde_json::Value =
        serde_json::from_slice(&fs::read(fixtures.join("index.json")).unwrap()).unwrap();
    for case in index["cases"].as_array().unwrap() {
        if case["manifestAccepted"] != true {
            continue;
        }
        let id = case["id"].as_str().unwrap();
        let original = bundle::extract(&fixtures.join(case["file"].as_str().unwrap())).unwrap();
        let (_, bytes) = pack(original.path()).unwrap();
        let mut file = tempfile::NamedTempFile::new().unwrap();
        file.write_all(&bytes).unwrap();
        let repacked = bundle::extract(file.path()).unwrap();
        let selected = manifest::find_manifest_path(repacked.path()).unwrap();
        assert_eq!(
            format!("{:x}", Sha256::digest(fs::read(selected).unwrap())),
            case["manifestHash"].as_str().unwrap(),
            "{id} manifest bytes"
        );
        if let Some(files) = case["files"].as_object() {
            for (path, hash) in files {
                assert_eq!(
                    format!(
                        "{:x}",
                        Sha256::digest(fs::read(repacked.path().join(path)).unwrap())
                    ),
                    hash.as_str().unwrap(),
                    "{id} file {path}"
                );
            }
        }
    }
}

#[cfg(unix)]
#[test]
fn share_archive_rejects_links_and_special_files() {
    use std::os::unix::{fs::symlink, net::UnixListener};
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("fixture");
    plugin(&root, false);
    symlink(root.join(".hidden"), root.join("link")).unwrap();
    assert!(pack(&root).unwrap_err().contains("links and special"));
    fs::remove_file(root.join("link")).unwrap();
    let _socket = UnixListener::bind(root.join("socket")).unwrap();
    assert!(pack(&root).unwrap_err().contains("links and special"));
}
