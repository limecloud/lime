use super::*;
use crate::market::selection::Selection;

fn release(index: usize) -> Release {
    let raw = &fixtures()[index];
    serde_json::from_value(serde_json::json!({
        "id": raw["id"], "itemId": raw["item_id"], "manifest": raw["manifest"],
        "manifestSha256": raw["manifest_sha256"], "archiveSha256": raw["archive_sha256"],
        "archiveSize": raw["archive_size"], "status": raw["status"], "revision": raw["revision"],
    }))
    .unwrap()
}

fn valid_after_change(index: usize, change: impl FnOnce(&mut Manifest)) -> bool {
    let mut release = release(index);
    change(&mut release.manifest);
    release.manifest_sha256 = release.manifest.sha256().unwrap();
    release.validate().is_ok()
}

fn make_selection(release: Release) -> Selection {
    let item = Item {
        id: release.item_id.clone(),
        publisher_application_id: "publisher".into(),
        environment: "sandbox".into(),
        kind: release.manifest.kind.clone(),
        name: "Fixture".into(),
        published_release_id: release.id.clone(),
        revision: 1,
        release: release.clone(),
        compatibility: Compatibility {
            status: "supported".into(),
            reasons: vec![],
        },
    };
    Selection { item, release }
}

#[test]
fn skill_mcp_and_plugin_releases_validate_without_changing_their_type() {
    for index in 0..3 {
        let selection = make_selection(release(index));
        selection.validate().unwrap();
        assert_eq!(selection.validate_plugin().is_ok(), index == 2);
    }
}

#[test]
fn selected_release_cannot_change_the_items_resource_type() {
    let mut selection = make_selection(release(0));
    selection.release = release(1);
    selection.release.item_id = selection.item.id.clone();
    assert!(selection.validate().is_err());
    let mut selection = make_selection(release(2));
    selection.item.kind = "skill".into();
    assert!(selection.validate().is_err());
}

#[test]
fn resource_payloads_cannot_be_mixed_or_omitted() {
    for index in 0..3 {
        assert!(!valid_after_change(index, |m| m.kind = "unknown".into()));
        assert!(!valid_after_change(index, |m| {
            m.skill = None;
            m.mcp = None;
            m.plugin = None;
        }));
        assert!(!valid_after_change(index, |m| {
            if index == 0 {
                m.plugin = release(2).manifest.plugin;
            } else {
                m.skill = release(0).manifest.skill;
            }
        }));
    }
}

#[test]
fn skills_require_the_exact_skill_entry_and_bounded_unique_actions() {
    for entry in ["missing/SKILL.md", "skill.md", "../SKILL.md"] {
        assert!(!valid_after_change(0, |m| m
            .skill
            .as_mut()
            .unwrap()
            .entry = entry.into()));
    }
    assert!(!valid_after_change(0, |m| m
        .skill
        .as_mut()
        .unwrap()
        .actions =
        vec!["run".into(); 2]));
    assert!(!valid_after_change(0, |m| m
        .skill
        .as_mut()
        .unwrap()
        .actions =
        vec!["Run".into()]));
    assert!(!valid_after_change(0, |m| m
        .skill
        .as_mut()
        .unwrap()
        .actions =
        (0..65).map(|i| format!("action{i}")).collect()));
}

#[test]
fn http_mcp_may_have_no_files_but_cannot_include_local_execution() {
    release(1).validate().unwrap();
    assert!(!valid_after_change(1, |m| m
        .mcp
        .as_mut()
        .unwrap()
        .executable =
        Some("run".into())));
    assert!(!valid_after_change(1, |m| m
        .mcp
        .as_mut()
        .unwrap()
        .arguments =
        vec!["run".into()]));
    assert!(!valid_after_change(1, |m| m
        .mcp
        .as_mut()
        .unwrap()
        .transport = "sse".into()));
}

#[test]
fn mcp_endpoint_must_be_fixed_public_https_without_credentials() {
    for endpoint in [
        "http://mcp.test.invalid/mcp",
        "https://localhost/mcp",
        "https://a.localhost./mcp",
        "https://host.local/mcp",
        "https://127.0.0.1/mcp",
        "https://10.0.0.1/mcp",
        "https://169.254.169.254/mcp",
        "https://0.0.0.0/mcp",
        "https://224.0.0.1/mcp",
        "https://255.255.255.255/mcp",
        "https://[::1]/mcp",
        "https://[::]/mcp",
        "https://[fc00::1]/mcp",
        "https://[fe80::1]/mcp",
        "https://[ff02::1]/mcp",
        "https://[::ffff:127.0.0.1]/mcp",
        "https://user:secret@mcp.test.invalid/mcp",
        "https://@mcp.test.invalid/mcp",
        "https://mcp.test.invalid/mcp?key=secret",
        "https://mcp.test.invalid/mcp#fragment",
        "https://mcp.test.invalid\\path",
    ] {
        assert!(
            !valid_after_change(1, |m| m.mcp.as_mut().unwrap().endpoint =
                Some(endpoint.into())),
            "{endpoint}"
        );
    }
    assert!(valid_after_change(1, |m| m
        .mcp
        .as_mut()
        .unwrap()
        .endpoint =
        Some("https://mcp.test.invalid/user@host/mcp".into())));
}

#[test]
fn stdio_mcp_requires_an_archived_executable_and_bounded_arguments() {
    let stdio = |m: &mut Manifest| {
        m.files = release(0).manifest.files;
        let mcp = m.mcp.as_mut().unwrap();
        mcp.transport = "stdio".into();
        mcp.endpoint = None;
        mcp.executable = Some("SKILL.md".into());
    };
    assert!(valid_after_change(1, stdio));
    assert!(!valid_after_change(1, |m| {
        stdio(m);
        m.mcp.as_mut().unwrap().executable = Some("missing".into());
    }));
    assert!(!valid_after_change(1, |m| {
        stdio(m);
        m.mcp.as_mut().unwrap().endpoint = Some("https://mcp.test.invalid".into());
    }));
    for arguments in [
        vec!["a".into(); 33],
        vec!["a".repeat(1025)],
        vec!["a\nb".into()],
    ] {
        assert!(!valid_after_change(1, |m| {
            stdio(m);
            m.mcp.as_mut().unwrap().arguments = arguments;
        }));
    }
}

#[test]
fn mcp_authentication_has_no_implicit_credentials_or_unbounded_scopes() {
    for auth in ["none", "bearer", "oauth2"] {
        assert!(valid_after_change(1, |m| m
            .mcp
            .as_mut()
            .unwrap()
            .auth
            .r#type = auth.into()));
    }
    assert!(!valid_after_change(1, |m| m
        .mcp
        .as_mut()
        .unwrap()
        .auth
        .r#type = "basic".into()));
    for auth in ["none", "bearer"] {
        assert!(!valid_after_change(1, |m| {
            m.mcp.as_mut().unwrap().auth = Authentication {
                r#type: auth.into(),
                scopes: vec!["read".into()],
            };
        }));
    }
    for scopes in [
        vec!["read".into(); 2],
        vec!["read write".into()],
        vec!["read\nwrite".into()],
        vec!["x".repeat(257)],
        (0..33).map(|i| format!("scope{i}")).collect(),
    ] {
        assert!(!valid_after_change(1, |m| m.mcp.as_mut().unwrap().auth =
            Authentication {
                r#type: "oauth2".into(),
                scopes
            }));
    }
}

#[test]
fn plugin_dependencies_are_exact_distinct_skill_or_mcp_releases() {
    let dep = |kind: &str| Dependency {
        release_id: "release_skill".into(),
        sha256: "a".repeat(64),
        kind: kind.into(),
    };
    for kind in ["skill", "mcp"] {
        assert!(valid_after_change(2, |m| m
            .plugin
            .as_mut()
            .unwrap()
            .dependencies =
            vec![dep(kind)]));
    }
    for dependencies in [
        vec![dep("plugin")],
        vec![dep("skill"), dep("mcp")],
        vec![Dependency {
            sha256: "wrong".into(),
            ..dep("skill")
        }],
        (0..33)
            .map(|i| Dependency {
                release_id: format!("release{i}"),
                ..dep("skill")
            })
            .collect(),
    ] {
        assert!(!valid_after_change(2, |m| m
            .plugin
            .as_mut()
            .unwrap()
            .dependencies = dependencies));
    }
}

#[test]
fn paths_must_be_portable_nfc_and_case_fold_distinct() {
    for path in [
        "NUL",
        "con.txt",
        "COM1/readme",
        "lpt9.txt",
        "trailing.",
        "trailing ",
        "a<b",
        "a|b",
        "a?b",
        "a*b",
        "e\u{301}.md",
    ] {
        assert!(!safe_path(path), "{path}");
    }
    assert!(!safe_path(&"a".repeat(241)));
    for path in ["COM10.txt", "CONSOLE.md", "技能/说明.md", "é.md"] {
        assert!(safe_path(path), "{path}");
    }
    for names in [
        ["Straße.md", "STRASSE.md"],
        ["Σ.md", "ς.md"],
        ["files", "FILES/guide.md"],
    ] {
        assert!(!valid_after_change(0, |m| {
            let file = m.files[0].clone();
            for name in names {
                m.files.push(File {
                    path: name.into(),
                    ..file.clone()
                });
            }
        }));
    }
}

#[test]
fn manifest_names_versions_hosts_and_text_follow_the_published_contract() {
    for name in ["Uppercase", "a b", "", ".hidden"] {
        assert!(!valid_after_change(0, |m| m.name = name.into()));
    }
    for value in [
        "1.0.0-beta",
        "1.0.0+build",
        "01.0.0",
        "1.0",
        "1000000000.0.0",
    ] {
        assert!(!valid_after_change(0, |m| m.version = value.into()));
    }
    assert!(!valid_after_change(0, |m| m.hosts.clear()));
    assert!(!valid_after_change(0, |m| m.hosts.push(m.hosts[0].clone())));
    assert!(!valid_after_change(0, |m| m.hosts[0].max_version = Some("0.9.0".into())));
    assert!(!valid_after_change(0, |m| m.hosts[0].capabilities = vec!["skills".into(); 2]));
    assert!(!valid_after_change(0, |m| m.title.source.clear()));
    assert!(!valid_after_change(0, |m| m.description.source = "a".repeat(4001)));
}

#[test]
fn empty_translation_maps_use_clouds_canonical_omission_rule() {
    let mut manifest = release(0).manifest;
    manifest.title.translations.clear();
    let encoded = serde_json::to_value(&manifest).unwrap();
    assert!(encoded["title"].get("translations").is_none());
    let decoded: Manifest = serde_json::from_value(encoded).unwrap();
    assert_eq!(decoded.sha256().unwrap(), manifest.sha256().unwrap());
}
