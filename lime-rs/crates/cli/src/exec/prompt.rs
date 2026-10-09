//! Exec prompt decoding and stdin behavior; no transport or runtime ownership.

use std::io::{self, IsTerminal, Read};
use std::path::PathBuf;

use anyhow::{bail, Context, Result};
use app_server_protocol::protocol::v2::{ReviewTarget, UserInput};

use super::{
    cli::{Command, ReviewArgs},
    InitialOperation,
};

pub(super) fn resolve_initial_operation(
    command: &mut Option<Command>,
    root_prompt: Option<String>,
    mut images: Vec<PathBuf>,
    last_message_file: bool,
    output_schema_path: Option<PathBuf>,
) -> Result<InitialOperation> {
    if let Some(Command::Review(args)) = command {
        return Ok(InitialOperation::Review {
            review_request: build_review_request(args)?,
        });
    }
    let prompt = match command {
        Some(Command::Resume(args)) => {
            images.append(&mut args.images);
            resolve_prompt(args.prompt.take().or(root_prompt))?
        }
        Some(Command::Fork(args)) => {
            images.append(&mut args.images);
            let Some(prompt) = args.prompt.take().or(root_prompt) else {
                if !images.is_empty() {
                    bail!("Forking with images requires a prompt");
                }
                if last_message_file || output_schema_path.is_some() {
                    bail!("Forking with output options requires a prompt");
                }
                return Ok(InitialOperation::ForkOnly);
            };
            resolve_prompt(Some(prompt))?
        }
        None => resolve_root_prompt(root_prompt)?,
        Some(Command::Review(_)) => unreachable!("review was resolved above"),
    };
    if prompt.trim().is_empty() {
        bail!("prompt must not be empty");
    }
    let mut input = images
        .into_iter()
        .map(|path| UserInput::LocalImage {
            path: path.to_string_lossy().into_owned(),
            detail: None,
        })
        .collect::<Vec<_>>();
    input.push(UserInput::Text {
        text: prompt,
        text_elements: Vec::new(),
    });
    let output_schema = load_output_schema(output_schema_path)?;
    Ok(InitialOperation::UserTurn {
        input,
        output_schema,
    })
}

fn build_review_request(args: &ReviewArgs) -> Result<ReviewTarget> {
    if args.uncommitted {
        Ok(ReviewTarget::UncommittedChanges)
    } else if let Some(branch) = &args.base {
        Ok(ReviewTarget::BaseBranch {
            branch: branch.clone(),
        })
    } else if let Some(sha) = &args.commit {
        Ok(ReviewTarget::Commit {
            sha: sha.clone(),
            title: args.commit_title.clone(),
        })
    } else if let Some(prompt) = &args.prompt {
        let instructions = resolve_prompt(Some(prompt.clone()))?.trim().to_owned();
        if instructions.is_empty() {
            bail!("Review prompt cannot be empty");
        }
        Ok(ReviewTarget::Custom { instructions })
    } else {
        bail!("Specify --uncommitted, --base, --commit, or provide custom review instructions");
    }
}

fn load_output_schema(path: Option<PathBuf>) -> Result<Option<serde_json::Value>> {
    let Some(path) = path else {
        return Ok(None);
    };
    let contents = std::fs::read_to_string(&path)
        .with_context(|| format!("Failed to read output schema file {}", path.display()))?;
    serde_json::from_str(&contents)
        .map(Some)
        .with_context(|| format!("Output schema file {} is not valid JSON", path.display()))
}

pub(super) fn resolve_root_prompt(prompt: Option<String>) -> Result<String> {
    resolve_prompt_with_stdin(prompt, true, io::stdin().is_terminal(), &mut io::stdin())
}

pub(super) fn resolve_prompt(prompt: Option<String>) -> Result<String> {
    resolve_prompt_with_stdin(prompt, false, io::stdin().is_terminal(), &mut io::stdin())
}

fn resolve_prompt_with_stdin(
    prompt: Option<String>,
    append: bool,
    terminal: bool,
    stdin: &mut impl Read,
) -> Result<String> {
    if let Some(prompt) = prompt.as_ref().filter(|prompt| prompt.as_str() != "-") {
        if append && !terminal {
            let text = read_prompt_from_stdin(stdin)?;
            if !text.trim().is_empty() {
                return Ok(prompt_with_stdin_context(prompt, &text));
            }
        }
        return Ok(prompt.clone());
    }
    if prompt.is_none() && terminal {
        bail!("prompt is required when stdin is a terminal");
    }
    let text = read_prompt_from_stdin(stdin)?;
    if text.trim().is_empty() {
        bail!("prompt must not be empty");
    }
    Ok(text)
}

fn read_prompt_from_stdin(stdin: &mut impl Read) -> Result<String> {
    let mut bytes = Vec::new();
    stdin
        .read_to_end(&mut bytes)
        .context("failed to read prompt from stdin")?;
    decode_prompt_bytes(&bytes)
}

fn prompt_with_stdin_context(prompt: &str, stdin: &str) -> String {
    let mut combined = format!("{prompt}\n\n<stdin>\n{stdin}");
    if !stdin.ends_with('\n') {
        combined.push('\n');
    }
    combined.push_str("</stdin>");
    combined
}

fn decode_prompt_bytes(bytes: &[u8]) -> Result<String> {
    let bytes = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes);
    if bytes.starts_with(&[0xff, 0xfe, 0, 0]) || bytes.starts_with(&[0, 0, 0xfe, 0xff]) {
        bail!("UTF-32 stdin is unsupported; convert it to UTF-8 and retry");
    }
    if let Some(bytes) = bytes.strip_prefix(&[0xff, 0xfe]) {
        return decode_utf16(bytes, u16::from_le_bytes);
    }
    if let Some(bytes) = bytes.strip_prefix(&[0xfe, 0xff]) {
        return decode_utf16(bytes, u16::from_be_bytes);
    }
    std::str::from_utf8(bytes)
        .map(str::to_owned)
        .context("stdin is not valid UTF-8")
}

fn decode_utf16(bytes: &[u8], decode_unit: fn([u8; 2]) -> u16) -> Result<String> {
    if !bytes.len().is_multiple_of(2) {
        bail!("stdin is not valid UTF-16");
    }
    let units: Vec<_> = bytes
        .chunks_exact(2)
        .map(|pair| decode_unit([pair[0], pair[1]]))
        .collect();
    String::from_utf16(&units).context("stdin is not valid UTF-16")
}

#[cfg(test)]
#[path = "prompt_tests.rs"]
mod tests;
