use std::path::Path;

use tree_sitter::{Node, Parser};

use crate::path_guard::{PathMutationCandidate, PathMutationKind};
use crate::shell_analysis::{
    collect_bash_invocation_path_candidates, detect_high_risk_bash_reason,
    detect_mutating_bash_invocation_warning,
};

use super::{ShellPermissionDecision, validate_command_paths};

const MAX_WRAPPER_DEPTH: usize = 8;

#[derive(Clone)]
struct Word {
    value: String,
    literal: bool,
}

pub(super) fn check_permission(command: &str, cwd: &Path) -> ShellPermissionDecision {
    check_script(command, cwd, 0)
}

pub(super) fn check_invocation_values(
    values: &[String],
    cwd: &Path,
    depth: usize,
) -> ShellPermissionDecision {
    let words = values
        .iter()
        .map(|value| Word {
            value: value.clone(),
            literal: true,
        })
        .collect::<Vec<_>>();
    check_invocation(&words, cwd, depth)
}

fn confirmation(reason: &str) -> ShellPermissionDecision {
    ShellPermissionDecision::RequiresConfirmation(reason.to_owned())
}

fn merge(current: &mut ShellPermissionDecision, next: ShellPermissionDecision) {
    if matches!(next, ShellPermissionDecision::Deny(_))
        || matches!(current, ShellPermissionDecision::Allow)
    {
        *current = next;
    }
}

fn check_script(script: &str, cwd: &Path, depth: usize) -> ShellPermissionDecision {
    if depth > MAX_WRAPPER_DEPTH {
        return ShellPermissionDecision::Deny(
            "Shell wrapper nesting exceeds the policy limit".into(),
        );
    }
    let mut parser = Parser::new();
    let tree = parser
        .set_language(&tree_sitter_bash::LANGUAGE.into())
        .ok()
        .and_then(|()| parser.parse(script, None));
    let Some(tree) = tree.filter(|tree| !tree.root_node().has_error()) else {
        return confirmation("Shell syntax cannot be validated safely");
    };
    let mut decision = ShellPermissionDecision::Allow;
    let mut stack = vec![tree.root_node()];
    while let Some(node) = stack.pop() {
        let next = match node.kind() {
            "command" => {
                let Some(name) = node.child_by_field_name("name") else {
                    return confirmation("Shell executable cannot be validated safely");
                };
                let mut words = vec![parse_word(name, script)];
                let mut cursor = node.walk();
                words.extend(
                    node.children_by_field_name("argument", &mut cursor)
                        .map(|argument| parse_word(argument, script)),
                );
                check_invocation(&words, cwd, depth)
            }
            "file_redirect" => check_redirect(node, script, cwd),
            "function_definition" if is_fork_bomb(node, script) => {
                ShellPermissionDecision::Deny("Command appears to be a fork bomb".into())
            }
            "declaration_command" if source(node, script).starts_with("export") => {
                let mut cursor = node.walk();
                if node.named_children(&mut cursor).any(|child| {
                    child
                        .child_by_field_name("name")
                        .is_some_and(|name| matches!(source(name, script), "PATH" | "LD_PRELOAD"))
                }) {
                    confirmation("Command changes the shell execution environment")
                } else {
                    ShellPermissionDecision::Allow
                }
            }
            _ => ShellPermissionDecision::Allow,
        };
        merge(&mut decision, next);
        if matches!(decision, ShellPermissionDecision::Deny(_)) {
            return decision;
        }
        let mut cursor = node.walk();
        // Visit substitutions and control flow, including expansions inside here-documents.
        stack.extend(node.named_children(&mut cursor));
    }
    decision
}

fn source<'a>(node: Node<'_>, script: &'a str) -> &'a str {
    &script[node.byte_range()]
}

fn parse_word(node: Node<'_>, script: &str) -> Word {
    fn is_literal(node: Node<'_>) -> bool {
        if !matches!(
            node.kind(),
            "command_name"
                | "word"
                | "number"
                | "string"
                | "string_content"
                | "raw_string"
                | "concatenation"
        ) {
            return false;
        }
        let mut cursor = node.walk();
        let literal = node.named_children(&mut cursor).all(is_literal);
        literal
    }
    let raw = source(node, script);
    let parsed = is_literal(node).then(|| shlex::split(raw)).flatten();
    match parsed {
        Some(mut words) if words.len() == 1 => Word {
            value: words.remove(0),
            literal: true,
        },
        _ => Word {
            value: raw.to_owned(),
            literal: false,
        },
    }
}

fn executable(word: &str) -> &str {
    word.rsplit('/').next().unwrap_or(word)
}

fn is_fork_bomb(node: Node<'_>, script: &str) -> bool {
    let Some(name) = node.child_by_field_name("name") else {
        return false;
    };
    let Some(body) = node.child_by_field_name("body") else {
        return false;
    };
    let name = source(name, script);
    // Match executable recursion in the body rather than text in a quoted argument.
    let mut stack = vec![body];
    let mut calls = 0;
    let mut pipeline = false;
    let mut background = false;
    while let Some(child) = stack.pop() {
        if child.kind() == "command"
            && child
                .child_by_field_name("name")
                .is_some_and(|called| parse_word(called, script).value == name)
        {
            calls += 1;
        }
        pipeline |= child.kind() == "pipeline";
        background |= child.kind() == "&";
        let mut cursor = child.walk();
        stack.extend(child.children(&mut cursor));
    }
    calls > 1 && pipeline && background
}

fn check_redirect(node: Node<'_>, script: &str, cwd: &Path) -> ShellPermissionDecision {
    let mut cursor = node.walk();
    let writes = node
        .children(&mut cursor)
        .any(|child| matches!(child.kind(), ">" | ">>" | ">|" | "&>" | "&>>" | "<>"));
    if !writes {
        return ShellPermissionDecision::Allow;
    }
    let Some(target) = node.child_by_field_name("destination") else {
        return confirmation("Shell redirect target cannot be validated safely");
    };
    let word = parse_word(target, script);
    if word.literal
        && [
            "/dev/sda",
            "/dev/sdb",
            "/dev/sdc",
            "/dev/hda",
            "/dev/hdb",
            "/dev/nvme",
            "/dev/mem",
            "/dev/kmem",
        ]
        .iter()
        .any(|device| word.value.starts_with(device))
    {
        return ShellPermissionDecision::Deny(
            "Command contains dangerous redirect to device file".into(),
        );
    }
    let candidates = [PathMutationCandidate::new(
        &word.value,
        PathMutationKind::Write,
    )];
    if let Some(decision) = validate_command_paths(&candidates, cwd, "") {
        return decision;
    }
    if matches!(
        word.value.as_str(),
        "&1" | "&2" | "/dev/null" | "/dev/stdout" | "/dev/stderr" | "/dev/tty"
    ) {
        ShellPermissionDecision::Allow
    } else {
        confirmation("Command writes to files via shell redirection")
    }
}

fn check_invocation(words: &[Word], cwd: &Path, depth: usize) -> ShellPermissionDecision {
    if depth > MAX_WRAPPER_DEPTH {
        return ShellPermissionDecision::Deny(
            "Shell wrapper nesting exceeds the policy limit".into(),
        );
    }
    let Some(head) = words.first() else {
        return ShellPermissionDecision::Allow;
    };
    if head.value == "./$0" {
        return ShellPermissionDecision::Deny("Command appears to be a fork bomb".into());
    }
    if !head.literal {
        return confirmation("Shell executable cannot be validated safely");
    }
    let name = executable(&head.value);
    let args = &words[1..];
    if crate::shell::shell_kind(&head.value) == Some(crate::shell::ShellKind::PowerShell) {
        if !args.iter().all(|word| word.literal) {
            return confirmation("PowerShell wrapper arguments cannot be validated statically");
        }
        let values = args
            .iter()
            .map(|word| word.value.clone())
            .collect::<Vec<_>>();
        return super::powershell::check_command_args_at_depth(&values, cwd, depth);
    }
    if crate::shell::shell_kind(&head.value) == Some(crate::shell::ShellKind::Cmd) {
        return confirmation("CMD syntax requires confirmation");
    }
    if name == "command"
        && args
            .first()
            .is_some_and(|word| word.literal && matches!(word.value.as_str(), "-v" | "-V"))
    {
        return ShellPermissionDecision::Allow;
    }
    if name == "env" {
        if let Some(index) = env_split_index(args) {
            let inline = args[index]
                .value
                .strip_prefix("--split-string=")
                .or_else(|| {
                    args[index]
                        .value
                        .strip_prefix("-S")
                        .filter(|value| !value.is_empty())
                });
            let (script, consumed) = if let Some(script) = inline {
                (script, 1)
            } else if let Some(script) = args.get(index + 1).filter(|word| word.literal) {
                (script.value.as_str(), 2)
            } else {
                return confirmation("Environment split-string cannot be validated statically");
            };
            if script.contains(['$', '`']) {
                return confirmation("Environment split-string contains dynamic expansion");
            }
            let Some(split) = shlex::split(script) else {
                return confirmation("Environment split-string cannot be validated statically");
            };
            let mut expanded = words[..index + 1].to_vec();
            expanded.extend(split.into_iter().map(|value| Word {
                value,
                literal: true,
            }));
            expanded.extend_from_slice(&args[index + consumed..]);
            return check_invocation(&expanded, cwd, depth + 1);
        }
    }
    if matches!(name, "bash" | "sh" | "zsh" | "dash" | "ksh") {
        if let Some(script) = shell_script_arg(args) {
            return check_script(&script.value, cwd, depth + 1);
        }
        return confirmation("Shell script input cannot be validated statically");
    }
    if name == "eval" {
        if args.iter().all(|word| word.literal) {
            return check_script(
                &args
                    .iter()
                    .map(|word| word.value.as_str())
                    .collect::<Vec<_>>()
                    .join(" "),
                cwd,
                depth + 1,
            );
        }
        return confirmation("Evaluated shell script cannot be validated statically");
    }
    if matches!(
        name,
        "sudo"
            | "env"
            | "command"
            | "builtin"
            | "nohup"
            | "nice"
            | "stdbuf"
            | "timeout"
            | "time"
            | "exec"
    ) {
        let offset = wrapper_offset(name, args);
        let Some(offset) = offset else {
            return confirmation("Shell wrapper arguments cannot be validated statically");
        };
        let next = check_invocation(&args[offset..], cwd, depth + 1);
        return if name == "sudo" && next == ShellPermissionDecision::Allow {
            confirmation("Command executes with elevated privileges")
        } else {
            next
        };
    }

    let values = std::iter::once(name.to_owned())
        .chain(args.iter().map(|word| word.value.clone()))
        .collect::<Vec<_>>();
    if dangerous_invocation(name, &values[1..]) {
        return ShellPermissionDecision::Deny(format!(
            "Command invokes dangerous operation: '{name}'"
        ));
    }
    if name == "git" {
        let command = shlex::try_join(values.iter().map(String::as_str)).unwrap_or_default();
        if let Some(reason) = detect_high_risk_bash_reason(&command) {
            return ShellPermissionDecision::Deny(reason);
        }
    }
    if let Some(decision) =
        validate_command_paths(&collect_bash_invocation_path_candidates(&values), cwd, "")
    {
        return decision;
    }
    if let Some(warning) = detect_mutating_bash_invocation_warning(&values) {
        return confirmation(&warning);
    }
    if name == "killall"
        || (name == "kill" && values.contains(&"-9".into()) && values.contains(&"-1".into()))
        || (name == "docker"
            && (values.get(1).is_some_and(|subcommand| subcommand == "rm")
                && values.iter().any(|word| word == "-f" || word == "--force")
                || values
                    .get(1..3)
                    .is_some_and(|args| args == ["system", "prune"])))
    {
        return confirmation("Command may terminate processes or remove resources");
    }
    ShellPermissionDecision::Allow
}

fn shell_script_arg(args: &[Word]) -> Option<&Word> {
    let mut index = 0;
    while let Some(word) = args.get(index).filter(|word| word.literal) {
        let value = word.value.as_str();
        if !value.starts_with(['-', '+']) || value == "--" {
            return None;
        }
        if value.starts_with('-') && !value.starts_with("--") && value.contains('c') {
            return args.get(index + 1).filter(|word| word.literal);
        }
        index += if matches!(
            value,
            "-o" | "+o" | "-O" | "+O" | "--rcfile" | "--init-file"
        ) {
            2
        } else {
            1
        };
    }
    None
}

fn dangerous_invocation(name: &str, args: &[String]) -> bool {
    let flags = args.iter().take_while(|word| word.as_str() != "--");
    let has_short = |flag: char| {
        flags
            .clone()
            .any(|word| word.starts_with('-') && !word.starts_with("--") && word.contains(flag))
    };
    match name {
        "shutdown" | "reboot" | "halt" | "poweroff" | "fdisk" => true,
        name if name == "mkfs" || name.starts_with("mkfs.") => true,
        "init" => args
            .first()
            .is_some_and(|arg| matches!(arg.as_str(), "0" | "6")),
        "dd" => args
            .iter()
            .any(|arg| matches!(arg.as_str(), "if=/dev/zero" | "if=/dev/random")),
        "nc" | "netcat" => has_short('l') || args.iter().any(|arg| arg == "--listen"),
        "chown" => has_short('R') || has_short('r') || args.iter().any(|arg| arg == "--recursive"),
        "chmod" => args.iter().any(|arg| arg == "777") && args.iter().any(|arg| arg == "/"),
        "rm" => {
            let recursive =
                has_short('r') || has_short('R') || args.iter().any(|arg| arg == "--recursive");
            let force = has_short('f') || args.iter().any(|arg| arg == "--force");
            recursive
                && force
                && args.iter().any(|arg| {
                    matches!(
                        arg.as_str(),
                        "/" | "/*" | "~" | "~/*" | "." | "./*" | ".." | "../*"
                    )
                })
        }
        _ => false,
    }
}

fn wrapper_offset(name: &str, args: &[Word]) -> Option<usize> {
    let mut index = 0;
    while let Some(word) = args.get(index) {
        if !word.literal {
            return None;
        }
        let value = word.value.as_str();
        if value == "--" {
            index += 1;
            break;
        }
        if name == "env" && value.contains('=') {
            index += 1;
            continue;
        }
        if !value.starts_with('-') {
            break;
        }
        let takes_value = match name {
            "sudo" => matches!(
                value,
                "-u" | "--user"
                    | "-g"
                    | "--group"
                    | "-h"
                    | "--host"
                    | "-p"
                    | "--prompt"
                    | "-C"
                    | "-T"
                    | "-R"
                    | "-D"
            ),
            "env" => matches!(value, "-u" | "--unset" | "-C" | "--chdir"),
            "nice" => matches!(value, "-n" | "--adjustment"),
            "timeout" => matches!(value, "-k" | "--kill-after" | "-s" | "--signal"),
            "stdbuf" => matches!(
                value,
                "-i" | "-o" | "-e" | "--input" | "--output" | "--error"
            ),
            "time" => matches!(value, "-f" | "--format" | "-o" | "--output"),
            "exec" => value == "-a",
            _ => false,
        };
        if name == "env" && (value == "-S" || value.starts_with("--split-string")) {
            return None;
        }
        index += if takes_value { 2 } else { 1 };
    }
    if name == "timeout" {
        index += 1;
    }
    (index <= args.len()).then_some(index)
}

fn env_split_index(args: &[Word]) -> Option<usize> {
    let mut index = 0;
    while let Some(word) = args.get(index).filter(|word| word.literal) {
        let value = word.value.as_str();
        if !value.starts_with('-') || value == "--" {
            return None;
        }
        if matches!(value, "-S" | "--split-string")
            || value.starts_with("--split-string=")
            || value.starts_with("-S") && value.len() > 2
        {
            return Some(index);
        }
        index += if matches!(value, "-u" | "--unset" | "-C" | "--chdir") {
            2
        } else {
            1
        };
    }
    None
}
