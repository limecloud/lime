use super::*;

#[test]
fn root_appends_piped_context_while_resume_explicit_prompt_keeps_its_input() {
    for stdin in ["context", "context\n"] {
        let root =
            resolve_prompt_with_stdin(Some("review".into()), true, false, &mut stdin.as_bytes())
                .unwrap();
        assert_eq!(root, "review\n\n<stdin>\ncontext\n</stdin>");
        let resumed = resolve_prompt_with_stdin(
            Some("follow up".into()),
            false,
            false,
            &mut stdin.as_bytes(),
        )
        .unwrap();
        assert_eq!(resumed, "follow up");
    }
    for terminal in [true, false] {
        assert_eq!(
            resolve_prompt_with_stdin(
                Some("quoted prompt".into()),
                true,
                terminal,
                &mut b" \n".as_slice()
            )
            .unwrap(),
            "quoted prompt"
        );
    }
}

#[test]
fn missing_or_dash_reads_stdin_and_empty_or_invalid_input_fails_closed() {
    for prompt in [None, Some("-".into())] {
        assert_eq!(
            resolve_prompt_with_stdin(prompt.clone(), true, false, &mut "中文\n".as_bytes())
                .unwrap(),
            "中文\n"
        );
        assert!(resolve_prompt_with_stdin(prompt, false, false, &mut b" \n".as_slice()).is_err());
    }
    assert!(resolve_prompt_with_stdin(None, true, true, &mut b"ignored".as_slice()).is_err());
    assert_eq!(
        resolve_prompt_with_stdin(Some("-".into()), false, true, &mut b"forced".as_slice())
            .unwrap(),
        "forced"
    );
    assert!(decode_prompt_bytes(&[0xff]).is_err());
}

#[test]
fn bom_decoding_preserves_unicode_and_rejects_malformed_utf16_or_utf32() {
    let text = "中文 🦀\n";
    let mut utf8 = vec![0xef, 0xbb, 0xbf];
    utf8.extend_from_slice(text.as_bytes());
    assert_eq!(decode_prompt_bytes(&utf8).unwrap(), text);
    for (bom, big_endian) in [(vec![0xff, 0xfe], false), (vec![0xfe, 0xff], true)] {
        let mut bytes = bom;
        for unit in text.encode_utf16() {
            bytes.extend_from_slice(&if big_endian {
                unit.to_be_bytes()
            } else {
                unit.to_le_bytes()
            });
        }
        assert_eq!(decode_prompt_bytes(&bytes).unwrap(), text);
    }
    for bytes in [
        vec![0xff, 0xfe, 1],
        vec![0xff, 0xfe, 0, 0xd8],
        vec![0xff, 0xfe, 0, 0],
        vec![0, 0, 0xfe, 0xff],
    ] {
        assert!(decode_prompt_bytes(&bytes).is_err(), "{bytes:?}");
    }
}

fn fork(prompt: Option<&str>, images: &[&str]) -> Option<Command> {
    Some(Command::Fork(super::super::cli::ForkArgs {
        connection: Default::default(),
        session_id: "source".into(),
        prompt: prompt.map(str::to_owned),
        images: images.iter().map(PathBuf::from).collect(),
    }))
}

#[test]
fn fork_only_never_needs_stdin_and_rejects_turn_only_options() {
    assert_eq!(
        resolve_initial_operation(&mut fork(None, &[]), None, Vec::new(), false, None).unwrap(),
        InitialOperation::ForkOnly
    );
    for (root_images, child_images, output) in [
        (vec![PathBuf::from("root.png")], vec![], false),
        (vec![], vec!["child.png"], false),
        (vec![], vec![], true),
    ] {
        assert!(resolve_initial_operation(
            &mut fork(None, &child_images),
            None,
            root_images,
            output,
            None
        )
        .is_err());
    }
    assert!(
        resolve_initial_operation(&mut fork(Some(" \n"), &[]), None, Vec::new(), false, None)
            .is_err()
    );
}

#[test]
fn fork_prompt_preserves_root_then_child_images_before_the_text() {
    let initial = resolve_initial_operation(
        &mut fork(Some("inspect"), &["child.png"]),
        None,
        vec![PathBuf::from("root.png")],
        false,
        None,
    )
    .unwrap();
    assert_eq!(
        initial,
        InitialOperation::UserTurn {
            output_schema: None,
            input: vec![
                UserInput::LocalImage {
                    path: "root.png".into(),
                    detail: None
                },
                UserInput::LocalImage {
                    path: "child.png".into(),
                    detail: None
                },
                UserInput::Text {
                    text: "inspect".into(),
                    text_elements: Vec::new()
                },
            ]
        }
    );
}

#[test]
fn output_schema_reads_json_and_fails_closed_before_fork_only_connects() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("shape.json");
    let schema = serde_json::json!({
        "type": "object", "properties": { "结果": { "type": "string" } },
        "required": ["结果"], "additionalProperties": false
    });
    std::fs::write(&path, serde_json::to_vec(&schema).unwrap()).unwrap();
    assert_eq!(
        load_output_schema(Some(path.clone())).unwrap(),
        Some(schema.clone())
    );
    assert_eq!(load_output_schema(None).unwrap(), None);
    let initial = resolve_initial_operation(
        &mut fork(Some("structured reply"), &[]),
        None,
        Vec::new(),
        false,
        Some(path.clone()),
    )
    .unwrap();
    assert!(
        matches!(initial, InitialOperation::UserTurn { output_schema: Some(value), .. } if value == schema)
    );
    let missing = temp.path().join("missing.json");
    assert!(load_output_schema(Some(missing.clone()))
        .unwrap_err()
        .to_string()
        .contains("Failed to read output schema file"));
    let error =
        resolve_initial_operation(&mut fork(None, &[]), None, Vec::new(), false, Some(missing))
            .unwrap_err();
    assert_eq!(
        error.to_string(),
        "Forking with output options requires a prompt"
    );
    for invalid in [b"{".as_slice(), &[0xff]] {
        std::fs::write(&path, invalid).unwrap();
        assert!(load_output_schema(Some(path.clone())).is_err());
    }
    std::fs::write(&path, "true").unwrap();
    assert_eq!(
        load_output_schema(Some(path)).unwrap(),
        Some(serde_json::json!(true))
    );
}

#[test]
fn review_request_keeps_typed_targets_and_requires_explicit_instructions() {
    for (args, expected) in [
        (
            ReviewArgs {
                uncommitted: true,
                ..Default::default()
            },
            ReviewTarget::UncommittedChanges,
        ),
        (
            ReviewArgs {
                base: Some("main".into()),
                ..Default::default()
            },
            ReviewTarget::BaseBranch {
                branch: "main".into(),
            },
        ),
        (
            ReviewArgs {
                commit: Some("abc".into()),
                commit_title: Some("subject".into()),
                ..Default::default()
            },
            ReviewTarget::Commit {
                sha: "abc".into(),
                title: Some("subject".into()),
            },
        ),
        (
            ReviewArgs {
                prompt: Some("  check 中文  \n".into()),
                ..Default::default()
            },
            ReviewTarget::Custom {
                instructions: "check 中文".into(),
            },
        ),
    ] {
        assert_eq!(build_review_request(&args).unwrap(), expected);
        let initial = resolve_initial_operation(
            &mut Some(Command::Review(args)),
            Some("ignored root prompt".into()),
            vec![PathBuf::from("ignored-image.png")],
            false,
            Some(PathBuf::from("ignored-schema.json")),
        )
        .unwrap();
        assert_eq!(
            initial,
            InitialOperation::Review {
                review_request: expected
            }
        );
    }
    assert!(build_review_request(&ReviewArgs::default())
        .unwrap_err()
        .to_string()
        .contains("Specify --uncommitted"));
    assert_eq!(
        build_review_request(&ReviewArgs {
            prompt: Some(" \n".into()),
            ..Default::default()
        })
        .unwrap_err()
        .to_string(),
        "Review prompt cannot be empty"
    );
}
