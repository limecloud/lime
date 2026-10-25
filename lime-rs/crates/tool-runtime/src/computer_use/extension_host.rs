//! Chrome launches the installed App Server as a framing/IPC host, without a runtime.

use super::mailbox::{self, Session};
use super::*;
use serde_json::{json, Value};
use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;
use uuid::Uuid;

pub const CHROME_EXTENSION_ORIGIN: &str = "chrome-extension://okipgpdaiijkenehohfgochhhlbifcbc/";

pub fn run_native_messaging_host() -> Result<(), String> {
    run().map_err(|e| e.0)
}

fn run() -> ComputerUseResult<()> {
    let root = mailbox::root()?.join(Uuid::new_v4().to_string());
    mailbox::private_directory(&root)?;
    mailbox::private_directory(&root.join("requests"))?;
    mailbox::private_directory(&root.join("responses"))?;
    let _cleanup = Cleanup(root.clone());
    let mut input = std::io::stdin().lock();
    let mut output = std::io::stdout().lock();
    loop {
        let mut header = [0u8; 4];
        match input.read_exact(&mut header) {
            Ok(()) => (),
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(()),
            Err(e) => return Err(denied(e.to_string())),
        }
        let length = u32::from_le_bytes(header) as usize;
        if length == 0 || length as u64 > mailbox::MAX_BYTES {
            return Err(denied("Invalid native message size"));
        }
        let mut bytes = vec![0; length];
        input
            .read_exact(&mut bytes)
            .map_err(|e| denied(e.to_string()))?;
        let message: Value = serde_json::from_slice(&bytes).map_err(|e| denied(e.to_string()))?;
        let reply = exchange(&root, message, "chrome")?;
        let bytes = serde_json::to_vec(&reply).map_err(|e| denied(e.to_string()))?;
        output
            .write_all(&(bytes.len() as u32).to_le_bytes())
            .map_err(|e| denied(e.to_string()))?;
        output
            .write_all(&bytes)
            .map_err(|e| denied(e.to_string()))?;
        output.flush().map_err(|e| denied(e.to_string()))?;
    }
}

pub(super) fn exchange(
    root: &std::path::Path,
    message: Value,
    adapter: &str,
) -> ComputerUseResult<Value> {
    let snapshot: ComputerUseSnapshot =
        serde_json::from_value(message["snapshot"].clone()).map_err(|e| denied(e.to_string()))?;
    if snapshot.generation == 0
        || snapshot.targets.len() > 128
        || snapshot.targets.iter().any(|t| {
            (match adapter {
                "chrome" => !matches!(t.identity, ComputerUseTargetIdentity::Chrome { .. }),
                "office" => !matches!(t.identity, ComputerUseTargetIdentity::Office { .. }),
                _ => true,
            }) || t.native_app.is_some()
        })
    {
        return Err(denied("Invalid connected snapshot"));
    }
    mailbox::write(
        &root.join("state.json"),
        &Session {
            protocol: 1,
            adapter: adapter.into(),
            updated_at: mailbox::now(),
            snapshot,
        },
    )?;
    if let Some(responses) = message["responses"].as_array() {
        if responses.len() > 16 {
            return Err(denied("Too many adapter responses"));
        }
        for response in responses {
            let id = response["id"]
                .as_str()
                .filter(|id| mailbox::message_id(id))
                .ok_or_else(|| denied("Invalid adapter response id"))?;
            let pending = root.join("requests").join(format!("{id}.pending"));
            if pending.is_file() {
                let Some(command) = read_command(&pending)? else {
                    continue;
                };
                if command["oneWay"] == true
                    && response["error"].is_string()
                    && command["deadline"].as_u64().unwrap_or_default() > mailbox::now()
                {
                    // Cleanup is idempotent; retry a transient Chrome error until
                    // its bounded deadline, without creating an orphan response.
                    fs::rename(&pending, pending.with_extension("json"))
                        .map_err(|e| denied(e.to_string()))?;
                    continue;
                }
                if command["oneWay"] != true {
                    mailbox::write(&root.join("responses").join(format!("{id}.json")), response)?;
                }
                let _ = fs::remove_file(pending);
            }
        }
    }
    let mut commands = Vec::new();
    let mut cancels = Vec::new();
    for entry in fs::read_dir(root.join("requests"))
        .map_err(|e| denied(e.to_string()))?
        .take(128)
    {
        let path = entry.map_err(|e| denied(e.to_string()))?.path();
        if path.extension().and_then(|v| v.to_str()) == Some("pending") {
            let Some(pending) = read_command(&path)? else {
                continue;
            };
            if pending["oneWay"] == true
                && pending["deadline"].as_u64().unwrap_or_default() <= mailbox::now()
            {
                let _ = fs::remove_file(path);
            }
            continue;
        }
        if path.extension().and_then(|v| v.to_str()) == Some("cancel") {
            if let Some(id) = path
                .file_stem()
                .and_then(|v| v.to_str())
                .filter(|id| mailbox::message_id(id))
            {
                cancels.push(id.to_owned());
            }
            continue;
        }
        if path.extension().and_then(|v| v.to_str()) != Some("json") {
            continue;
        }
        let Some(command) = read_command(&path)? else {
            continue;
        };
        if command["deadline"].as_u64().unwrap_or_default() <= mailbox::now() {
            let _ = fs::remove_file(path);
            continue;
        }
        fs::rename(&path, path.with_extension("pending")).map_err(|e| denied(e.to_string()))?;
        commands.push(command);
        if commands.len() == 8 {
            break;
        }
    }
    Ok(json!({"protocol":1,"commands":commands,"cancels":cancels}))
}

fn read_command(path: &std::path::Path) -> ComputerUseResult<Option<Value>> {
    match mailbox::read(path) {
        Ok(value) => Ok(Some(value)),
        Err(error) => match fs::symlink_metadata(path) {
            Err(io) if io.kind() == std::io::ErrorKind::NotFound => Ok(None),
            _ => Err(error),
        },
    }
}

struct Cleanup(PathBuf);
impl Drop for Cleanup {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
