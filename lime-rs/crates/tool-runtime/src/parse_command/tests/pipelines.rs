use super::*;

#[test]
fn supports_tail_n_plus() {
    let inner = "tail -n +522 README.md";
    assert_parsed(
        &vec_str(&["bash", "-lc", inner]),
        vec![ParsedCommand::Read {
            cmd: inner.to_string(),
            name: "README.md".to_string(),
            path: PathBuf::from("README.md"),
        }],
    );
}

#[test]
fn supports_tail_n_last_lines() {
    let inner = "tail -n 30 README.md";
    let out = parse_command(&vec_str(&["bash", "-lc", inner]));
    assert_eq!(
        out,
        vec![ParsedCommand::Read {
            cmd: inner.to_string(),
            name: "README.md".to_string(),
            path: PathBuf::from("README.md"),
        }]
    );
}

#[test]
fn supports_tail_file_only() {
    let inner = "tail README.md";
    assert_parsed(
        &vec_str(&["bash", "-lc", inner]),
        vec![ParsedCommand::Read {
            cmd: inner.to_string(),
            name: "README.md".to_string(),
            path: PathBuf::from("README.md"),
        }],
    );
}

#[test]
fn supports_npm_run_build_is_unknown() {
    assert_parsed(
        &vec_str(&["npm", "run", "build"]),
        vec![ParsedCommand::Unknown {
            cmd: "npm run build".to_string(),
        }],
    );
}

#[test]
fn supports_grep_recursive_current_dir() {
    assert_parsed(
        &vec_str(&["grep", "-R", "LIME_SANDBOX_ENV_VAR", "-n", "."]),
        vec![ParsedCommand::Search {
            cmd: "grep -R LIME_SANDBOX_ENV_VAR -n .".to_string(),
            query: Some("LIME_SANDBOX_ENV_VAR".to_string()),
            path: Some(".".to_string()),
        }],
    );
}

#[test]
fn supports_grep_recursive_specific_file() {
    assert_parsed(
        &vec_str(&[
            "grep",
            "-R",
            "LIME_SANDBOX_ENV_VAR",
            "-n",
            "core/src/spawn.rs",
        ]),
        vec![ParsedCommand::Search {
            cmd: "grep -R LIME_SANDBOX_ENV_VAR -n core/src/spawn.rs".to_string(),
            query: Some("LIME_SANDBOX_ENV_VAR".to_string()),
            path: Some("spawn.rs".to_string()),
        }],
    );
}

#[test]
fn supports_egrep_and_fgrep() {
    assert_parsed(
        &shlex_split_safe("egrep -R TODO src"),
        vec![ParsedCommand::Search {
            cmd: "egrep -R TODO src".to_string(),
            query: Some("TODO".to_string()),
            path: Some("src".to_string()),
        }],
    );
    assert_parsed(
        &shlex_split_safe("fgrep -l TODO src"),
        vec![ParsedCommand::Search {
            cmd: "fgrep -l TODO src".to_string(),
            query: Some("TODO".to_string()),
            path: Some("src".to_string()),
        }],
    );
}

#[test]
fn grep_files_with_matches_flags_are_search() {
    assert_parsed(
        &shlex_split_safe("grep -l TODO src"),
        vec![ParsedCommand::Search {
            cmd: "grep -l TODO src".to_string(),
            query: Some("TODO".to_string()),
            path: Some("src".to_string()),
        }],
    );
    assert_parsed(
        &shlex_split_safe("grep --files-with-matches TODO src"),
        vec![ParsedCommand::Search {
            cmd: "grep --files-with-matches TODO src".to_string(),
            query: Some("TODO".to_string()),
            path: Some("src".to_string()),
        }],
    );
    assert_parsed(
        &shlex_split_safe("grep -L TODO src"),
        vec![ParsedCommand::Search {
            cmd: "grep -L TODO src".to_string(),
            query: Some("TODO".to_string()),
            path: Some("src".to_string()),
        }],
    );
    assert_parsed(
        &shlex_split_safe("grep --files-without-match TODO src"),
        vec![ParsedCommand::Search {
            cmd: "grep --files-without-match TODO src".to_string(),
            query: Some("TODO".to_string()),
            path: Some("src".to_string()),
        }],
    );
}

#[test]
fn supports_grep_query_with_slashes_not_shortened() {
    // Query strings may contain slashes and should not be shortened to the basename.
    // Previously, grep queries were passed through short_display_path, which is incorrect.
    assert_parsed(
        &shlex_split_safe("grep -R src/main.rs -n ."),
        vec![ParsedCommand::Search {
            cmd: "grep -R src/main.rs -n .".to_string(),
            query: Some("src/main.rs".to_string()),
            path: Some(".".to_string()),
        }],
    );
}

#[test]
fn supports_grep_weird_backtick_in_query() {
    assert_parsed(
        &shlex_split_safe("grep -R COD`EX_SANDBOX -n"),
        vec![ParsedCommand::Search {
            cmd: "grep -R 'COD`EX_SANDBOX' -n".to_string(),
            query: Some("COD`EX_SANDBOX".to_string()),
            path: None,
        }],
    );
}

#[test]
fn supports_cd_and_rg_files() {
    assert_parsed(
        &shlex_split_safe("cd codex-rs && rg --files"),
        vec![ParsedCommand::ListFiles {
            cmd: "rg --files".to_string(),
            path: None,
        }],
    );
}

#[test]
fn supports_single_string_script_with_cd_and_pipe() {
    let inner = r#"cd /Users/pakrym/code/codex && rg -n "codex_api" codex-rs -S | head -n 50"#;
    assert_parsed(
        &vec_str(&["bash", "-lc", inner]),
        vec![ParsedCommand::Search {
            cmd: "rg -n codex_api codex-rs -S".to_string(),
            query: Some("codex_api".to_string()),
            path: Some("codex-rs".to_string()),
        }],
    );
}

#[test]
fn supports_python_walks_files() {
    let inner = r#"python -c "import os; print(os.listdir('.'))""#;
    assert_parsed(
        &vec_str(&["bash", "-lc", inner]),
        vec![ParsedCommand::ListFiles {
            cmd: shlex_join(&shlex_split_safe(inner)),
            path: None,
        }],
    );
}

#[test]
fn supports_python3_walks_files() {
    let inner = r#"python3 -c "import glob; print(glob.glob('*.rs'))""#;
    assert_parsed(
        &vec_str(&["bash", "-lc", inner]),
        vec![ParsedCommand::ListFiles {
            cmd: shlex_join(&shlex_split_safe(inner)),
            path: None,
        }],
    );
}

#[test]
fn python_without_file_walk_is_unknown() {
    let inner = r#"python -c "print('hello')""#;
    assert_parsed(
        &vec_str(&["bash", "-lc", inner]),
        vec![ParsedCommand::Unknown {
            cmd: shlex_join(&shlex_split_safe(inner)),
        }],
    );
}

// ---- is_small_formatting_command unit tests ----
#[test]
fn small_formatting_always_true_commands() {
    for cmd in ["wc", "tr", "cut", "sort", "uniq", "xargs", "tee", "column"] {
        assert!(is_small_formatting_command(&shlex_split_safe(cmd)));
        assert!(is_small_formatting_command(&shlex_split_safe(&format!(
            "{cmd} -x"
        ))));
    }
}

#[test]
fn awk_behavior() {
    assert!(is_small_formatting_command(&shlex_split_safe(
        "awk '{print $1}'"
    )));
    assert!(!is_small_formatting_command(&shlex_split_safe(
        "awk '{print $1}' Cargo.toml"
    )));
    assert!(!is_small_formatting_command(&shlex_split_safe(
        "awk -f script.awk Cargo.toml"
    )));
}

#[test]
fn head_behavior() {
    // No args -> small formatting
    assert!(is_small_formatting_command(&vec_str(&["head"])));
    // Numeric count only -> formatting
    assert!(is_small_formatting_command(&shlex_split_safe("head -n 40")));
    // With explicit file -> not small formatting
    assert!(!is_small_formatting_command(&shlex_split_safe(
        "head -n 40 file.txt"
    )));
    // File only (no count) -> not formatting
    assert!(!is_small_formatting_command(&vec_str(&[
        "head", "file.txt"
    ])));
}

#[test]
fn tail_behavior() {
    // No args -> small formatting
    assert!(is_small_formatting_command(&vec_str(&["tail"])));
    // Numeric with plus offset -> formatting
    assert!(is_small_formatting_command(&shlex_split_safe(
        "tail -n +10"
    )));
    assert!(!is_small_formatting_command(&shlex_split_safe(
        "tail -n +10 file.txt"
    )));
    // Numeric count -> formatting
    assert!(is_small_formatting_command(&shlex_split_safe("tail -n 30")));
    assert!(!is_small_formatting_command(&shlex_split_safe(
        "tail -n 30 file.txt"
    )));
    // Byte count -> formatting
    assert!(is_small_formatting_command(&shlex_split_safe("tail -c 30")));
    assert!(is_small_formatting_command(&shlex_split_safe(
        "tail -c +10"
    )));
    // File only (no count) -> not formatting
    assert!(!is_small_formatting_command(&vec_str(&[
        "tail", "file.txt"
    ])));
}

#[test]
fn sed_behavior() {
    // Plain sed -> small formatting
    assert!(is_small_formatting_command(&vec_str(&["sed"])));
    // sed -n <range> (no file) -> still small formatting
    assert!(is_small_formatting_command(&vec_str(&["sed", "-n", "10p"])));
    // Valid range with file -> not small formatting
    assert!(!is_small_formatting_command(&shlex_split_safe(
        "sed -n 10p file.txt"
    )));
    assert!(!is_small_formatting_command(&shlex_split_safe(
        "sed -n -e 10p file.txt"
    )));
    assert!(!is_small_formatting_command(&shlex_split_safe(
        "sed -n 10p -- file.txt"
    )));
    assert!(!is_small_formatting_command(&shlex_split_safe(
        "sed -n 1,200p file.txt"
    )));
    // Invalid ranges with file -> small formatting
    assert!(is_small_formatting_command(&shlex_split_safe(
        "sed -n p file.txt"
    )));
    assert!(is_small_formatting_command(&shlex_split_safe(
        "sed -n +10p file.txt"
    )));
}

#[test]
fn keeps_mutating_sed_in_compound_command() {
    for sed_command in [
        "sed -n -i.bak 1p secret.txt",
        "sed -ni.bak 1p secret.txt",
        "sed -Eni.bak 1p secret.txt",
    ] {
        let inner = format!("cat README.md && {sed_command}");
        assert_parsed(
            &vec_str(&["bash", "-lc", &inner]),
            vec![ParsedCommand::Unknown { cmd: inner }],
        );
    }
}

#[test]
fn ignores_sed_operands_after_double_dash_when_checking_mutation() {
    let inner = "cat README.md && sed 's/a/x/' -- -input.txt";
    assert_parsed(
        &vec_str(&["bash", "-lc", inner]),
        vec![ParsedCommand::Read {
            cmd: "cat README.md".to_string(),
            name: "README.md".to_string(),
            path: PathBuf::from("README.md"),
        }],
    );
}

#[test]
fn empty_tokens_is_not_small() {
    let empty: Vec<String> = Vec::new();
    assert!(!is_small_formatting_command(&empty));
}

#[test]
fn supports_nl_then_sed_reading() {
    let inner = "nl -ba core/src/parse_command.rs | sed -n '1200,1720p'";
    assert_parsed(
        &vec_str(&["bash", "-lc", inner]),
        vec![ParsedCommand::Read {
            cmd: inner.to_string(),
            name: "parse_command.rs".to_string(),
            path: PathBuf::from("core/src/parse_command.rs"),
        }],
    );
}

#[test]
fn supports_sed_n() {
    let inner = "sed -n '2000,2200p' tui/src/history_cell.rs";
    assert_parsed(
        &vec_str(&["bash", "-lc", inner]),
        vec![ParsedCommand::Read {
            cmd: inner.to_string(),
            name: "history_cell.rs".to_string(),
            path: PathBuf::from("tui/src/history_cell.rs"),
        }],
    );
}

#[test]
fn supports_awk_with_file() {
    let inner = "awk '{print $1}' Cargo.toml";
    assert_parsed(
        &vec_str(&["bash", "-lc", inner]),
        vec![ParsedCommand::Read {
            cmd: inner.to_string(),
            name: "Cargo.toml".to_string(),
            path: PathBuf::from("Cargo.toml"),
        }],
    );
}

#[test]
fn filters_out_printf() {
    let inner = r#"printf "\n===== ansi-escape/Cargo.toml =====\n"; cat -- ansi-escape/Cargo.toml"#;
    assert_parsed(
        &vec_str(&["bash", "-lc", inner]),
        vec![ParsedCommand::Read {
            cmd: "cat -- ansi-escape/Cargo.toml".to_string(),
            name: "Cargo.toml".to_string(),
            path: PathBuf::from("ansi-escape/Cargo.toml"),
        }],
    );
}

#[test]
fn drops_yes_in_pipelines() {
    // Inside bash -lc, `yes | rg --files` should focus on the primary command.
    let inner = "yes | rg --files";
    assert_parsed(
        &vec_str(&["bash", "-lc", inner]),
        vec![ParsedCommand::ListFiles {
            cmd: "rg --files".to_string(),
            path: None,
        }],
    );
}

#[test]
fn supports_sed_n_then_nl_as_search() {
    // Ensure `sed -n '<range>' <file> | nl -ba` is summarized as a search for that file.
    let args = shlex_split_safe(
        "sed -n '260,640p' exec/src/event_processor_with_human_output.rs | nl -ba",
    );
    assert_parsed(
        &args,
        vec![ParsedCommand::Read {
            cmd: "sed -n '260,640p' exec/src/event_processor_with_human_output.rs".to_string(),
            name: "event_processor_with_human_output.rs".to_string(),
            path: PathBuf::from("exec/src/event_processor_with_human_output.rs"),
        }],
    );
}
