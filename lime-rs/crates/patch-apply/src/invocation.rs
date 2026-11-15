use std::sync::LazyLock;

use tree_sitter::Parser;
use tree_sitter::Query;
use tree_sitter::QueryCursor;
use tree_sitter::StreamingIterator;
use tree_sitter_bash::LANGUAGE as BASH;

use crate::ApplyPatchArgs;
use crate::parser::ParseError;
use crate::parser::parse_patch;
use lime_utils_path_uri::PathConvention;
use lime_utils_path_uri::PathUri;
use std::str::Utf8Error;
use tree_sitter::LanguageError;

const APPLY_PATCH_COMMANDS: [&str; 2] = ["apply_patch", "applypatch"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ApplyPatchShell {
    Unix,
    PowerShell,
    Cmd,
}

#[derive(Debug, PartialEq)]
pub enum MaybeApplyPatch {
    Body(ApplyPatchArgs),
    ShellParseError(ExtractHeredocError),
    PatchParseError(ParseError),
    NotApplyPatch,
}

#[derive(Debug, PartialEq)]
pub enum ExtractHeredocError {
    CommandDidNotStartWithApplyPatch,
    FailedToLoadBashGrammar(LanguageError),
    HeredocNotUtf8(Utf8Error),
    FailedToParsePatchIntoAst,
    FailedToFindHeredocBody,
}

fn classify_shell_name(shell: &str, convention: PathConvention) -> Option<String> {
    let basename = convention.path_segments(shell).next_back()?;
    let stem = basename
        .rsplit_once('.')
        .and_then(|(stem, _extension)| (!stem.is_empty()).then_some(stem))
        .unwrap_or(basename);
    Some(stem.to_ascii_lowercase())
}

fn classify_shell(shell: &str, flag: &str, convention: PathConvention) -> Option<ApplyPatchShell> {
    classify_shell_name(shell, convention).and_then(|name| match name.as_str() {
        "bash" | "zsh" | "sh" if matches!(flag, "-lc" | "-c") => Some(ApplyPatchShell::Unix),
        "pwsh" | "powershell" if flag.eq_ignore_ascii_case("-command") => {
            Some(ApplyPatchShell::PowerShell)
        }
        "cmd" if flag.eq_ignore_ascii_case("/c") => Some(ApplyPatchShell::Cmd),
        _ => None,
    })
}

fn can_skip_flag(shell: &str, flag: &str, convention: PathConvention) -> bool {
    classify_shell_name(shell, convention).is_some_and(|name| {
        matches!(name.as_str(), "pwsh" | "powershell") && flag.eq_ignore_ascii_case("-noprofile")
    })
}

fn parse_shell_script<'a>(argv: &'a [String], cwd: &PathUri) -> Option<(ApplyPatchShell, &'a str)> {
    let convention = cwd.infer_path_convention()?;
    match argv {
        [shell, flag, script] => classify_shell(shell, flag, convention).map(|shell_type| {
            let script = script.as_str();
            (shell_type, script)
        }),
        [shell, skip_flag, flag, script] => {
            if !can_skip_flag(shell, skip_flag, convention) {
                return None;
            }
            classify_shell(shell, flag, convention).map(|shell_type| {
                let script = script.as_str();
                (shell_type, script)
            })
        }
        _ => None,
    }
}

fn extract_apply_patch_from_shell(
    shell: ApplyPatchShell,
    script: &str,
) -> std::result::Result<(String, Option<String>), ExtractHeredocError> {
    match shell {
        ApplyPatchShell::Unix | ApplyPatchShell::PowerShell | ApplyPatchShell::Cmd => {
            extract_apply_patch_from_bash(script)
        }
    }
}

/// `cwd` supplies the path convention used to interpret the shell executable in `argv`.
pub fn maybe_parse_apply_patch(argv: &[String], cwd: &PathUri) -> MaybeApplyPatch {
    match argv {
        // Direct invocation: apply_patch <patch>
        [cmd, body] if APPLY_PATCH_COMMANDS.contains(&cmd.as_str()) => match parse_patch(body) {
            Ok(source) => MaybeApplyPatch::Body(source),
            Err(e) => MaybeApplyPatch::PatchParseError(e),
        },
        // Shell heredoc form: (optional `cd <path> &&`) apply_patch <<'EOF' ...
        _ => match parse_shell_script(argv, cwd) {
            Some((shell, script)) => match extract_apply_patch_from_shell(shell, script) {
                Ok((body, workdir)) => match parse_patch(&body) {
                    Ok(mut source) => {
                        source.workdir = workdir;
                        MaybeApplyPatch::Body(source)
                    }
                    Err(e) => MaybeApplyPatch::PatchParseError(e),
                },
                Err(ExtractHeredocError::CommandDidNotStartWithApplyPatch) => {
                    MaybeApplyPatch::NotApplyPatch
                }
                Err(e) => MaybeApplyPatch::ShellParseError(e),
            },
            None => MaybeApplyPatch::NotApplyPatch,
        },
    }
}

/// `cwd` must identify an absolute environment-native path so relative patch paths can be
/// resolved without projecting them onto the app-server or exec-server host.
fn extract_apply_patch_from_bash(
    src: &str,
) -> std::result::Result<(String, Option<String>), ExtractHeredocError> {
    // This function uses a Tree-sitter query to recognize one of two
    // whole-script forms, each expressed as a single top-level statement:
    //
    // 1. apply_patch <<'EOF'\n...\nEOF
    // 2. cd <path> && apply_patch <<'EOF'\n...\nEOF
    //
    // Key ideas when reading the query:
    // - dots (`.`) between named nodes enforces adjacency among named children and
    //   anchor to the start/end of the expression.
    // - we match a single redirected_statement directly under program with leading
    //   and trailing anchors (`.`). This ensures it is the only top-level statement
    //   (so prefixes like `echo ...;` or suffixes like `... && echo done` do not match).
    //
    // Overall, we want to be conservative and only match the intended forms, as other
    // forms are likely to be model errors, or incorrectly interpreted by later code.
    //
    // If you're editing this query, it's helpful to start by creating a debugging binary
    // which will let you see the AST of an arbitrary bash script passed in, and optionally
    // also run an arbitrary query against the AST. This is useful for understanding
    // how tree-sitter parses the script and whether the query syntax is correct. Be sure
    // to test both positive and negative cases.
    static APPLY_PATCH_QUERY: LazyLock<Query> = LazyLock::new(|| {
        let language = BASH.into();
        #[expect(clippy::expect_used)]
        Query::new(
            &language,
            r#"
            (
              program
                . (redirected_statement
                    body: (command
                            name: (command_name (word) @apply_name) .)
                    (#any-of? @apply_name "apply_patch" "applypatch")
                    redirect: (heredoc_redirect
                                . (heredoc_start)
                                . (heredoc_body) @heredoc
                                . (heredoc_end)
                                .))
                .)

            (
              program
                . (redirected_statement
                    body: (list
                            . (command
                                name: (command_name (word) @cd_name) .
                                argument: [
                                  (word) @cd_path
                                  (string (string_content) @cd_path)
                                  (raw_string) @cd_raw_string
                                ] .)
                            "&&"
                            . (command
                                name: (command_name (word) @apply_name))
                            .)
                    (#eq? @cd_name "cd")
                    (#any-of? @apply_name "apply_patch" "applypatch")
                    redirect: (heredoc_redirect
                                . (heredoc_start)
                                . (heredoc_body) @heredoc
                                . (heredoc_end)
                                .))
                .)
            "#,
        )
        .expect("valid bash query")
    });

    let lang = BASH.into();
    let mut parser = Parser::new();
    parser
        .set_language(&lang)
        .map_err(ExtractHeredocError::FailedToLoadBashGrammar)?;
    let tree = parser
        .parse(src, None)
        .ok_or(ExtractHeredocError::FailedToParsePatchIntoAst)?;

    let bytes = src.as_bytes();
    let root = tree.root_node();

    let mut cursor = QueryCursor::new();
    let mut matches = cursor.matches(&APPLY_PATCH_QUERY, root, bytes);
    while let Some(m) = matches.next() {
        let mut heredoc_text: Option<String> = None;
        let mut cd_path: Option<String> = None;

        for capture in m.captures.iter() {
            let name = APPLY_PATCH_QUERY.capture_names()[capture.index as usize];
            match name {
                "heredoc" => {
                    let text = capture
                        .node
                        .utf8_text(bytes)
                        .map_err(ExtractHeredocError::HeredocNotUtf8)?
                        .trim_end_matches('\n')
                        .to_string();
                    heredoc_text = Some(text);
                }
                "cd_path" => {
                    let text = capture
                        .node
                        .utf8_text(bytes)
                        .map_err(ExtractHeredocError::HeredocNotUtf8)?
                        .to_string();
                    cd_path = Some(text);
                }
                "cd_raw_string" => {
                    let raw = capture
                        .node
                        .utf8_text(bytes)
                        .map_err(ExtractHeredocError::HeredocNotUtf8)?;
                    let trimmed = raw
                        .strip_prefix('\'')
                        .and_then(|s| s.strip_suffix('\''))
                        .unwrap_or(raw);
                    cd_path = Some(trimmed.to_string());
                }
                _ => {}
            }
        }

        if let Some(heredoc) = heredoc_text {
            return Ok((heredoc, cd_path));
        }
    }

    Err(ExtractHeredocError::CommandDidNotStartWithApplyPatch)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Hunk;
    use std::path::PathBuf;

    fn cwd() -> PathUri {
        PathUri::parse("file:///workspace").expect("valid cwd")
    }

    fn patch() -> String {
        "*** Begin Patch\n*** Add File: foo\n+hi\n*** End Patch".to_string()
    }

    #[test]
    fn parses_direct_apply_patch_argv() {
        let args = vec!["apply_patch".to_string(), patch()];
        match maybe_parse_apply_patch(&args, &cwd()) {
            MaybeApplyPatch::Body(parsed) => {
                assert_eq!(
                    parsed.hunks,
                    vec![Hunk::AddFile {
                        path: PathBuf::from("foo"),
                        contents: "hi\n".to_string(),
                    }]
                );
            }
            other => panic!("expected apply_patch body, got {other:?}"),
        }
    }

    #[test]
    fn parses_bash_heredoc_apply_patch() {
        let script = format!("apply_patch <<'EOF'\n{}\nEOF", patch());
        let args = vec!["bash".to_string(), "-lc".to_string(), script];
        match maybe_parse_apply_patch(&args, &cwd()) {
            MaybeApplyPatch::Body(parsed) => {
                assert_eq!(parsed.hunks.len(), 1);
                assert!(parsed.workdir.is_none());
            }
            other => panic!("expected heredoc body, got {other:?}"),
        }
    }

    #[test]
    fn ignores_non_apply_patch_commands() {
        let args = vec!["bash".to_string(), "-lc".to_string(), "echo hi".to_string()];
        assert_eq!(
            maybe_parse_apply_patch(&args, &cwd()),
            MaybeApplyPatch::NotApplyPatch
        );
    }
}
