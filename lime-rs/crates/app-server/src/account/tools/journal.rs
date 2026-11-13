use super::{super::store, connections::ConnectionTask, intent::ToolIntent, login::LoginTask};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};

const MAX_BYTES: u64 = 256 * 1024;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Reference {
    key: String,
}

/// All access is serialized by the native account store lock. References do not
/// copy operation status; only a validated tool result releases the pending key.
pub(super) struct CallJournal {
    root: PathBuf,
}

impl CallJournal {
    pub(super) fn new(account_path: &Path) -> Result<Self, String> {
        let parent = account_path.parent().ok_or("account_store_unavailable")?;
        store::check_directory(parent)?;
        let root = parent.join("tool-calls");
        for directory in [
            &root,
            &root.join("bindings"),
            &root.join("pending"),
            &root.join("logins"),
            &root.join("connections"),
        ] {
            store::check_directory(directory)?;
        }
        Ok(Self { root })
    }

    pub(super) fn connection(&self, key: &str) -> Result<Option<ConnectionTask>, String> {
        valid_key(key)?;
        let task: Option<ConnectionTask> =
            read(&self.root.join("connections").join(format!("{key}.json")))?;
        if task.as_ref().is_some_and(|task| task.key != key) {
            return Err("operation_store_invalid".into());
        }
        Ok(task)
    }

    pub(super) fn save_connection(&self, task: &ConnectionTask) -> Result<(), String> {
        valid_key(&task.key)?;
        self.write(
            &self
                .root
                .join("connections")
                .join(format!("{}.json", task.key)),
            task,
        )
    }

    pub(super) fn login(&self, key: &str) -> Result<Option<LoginTask>, String> {
        valid_key(key)?;
        let task: Option<LoginTask> = read(&self.root.join("logins").join(format!("{key}.json")))?;
        if task.as_ref().is_some_and(|task| task.key != key) {
            return Err("operation_store_invalid".into());
        }
        Ok(task)
    }

    pub(super) fn save_login(&self, task: &LoginTask) -> Result<(), String> {
        valid_key(&task.key)?;
        self.write(
            &self.root.join("logins").join(format!("{}.json", task.key)),
            task,
        )
    }

    pub(super) fn intent(&self, key: &str) -> Result<Option<ToolIntent>, String> {
        valid_key(key)?;
        let value: Option<ToolIntent> = read(&self.root.join(format!("{key}.json")))?;
        if value.as_ref().is_some_and(|intent| intent.key != key) {
            return Err("operation_store_invalid".into());
        }
        Ok(value)
    }

    pub(super) fn save_intent(&self, intent: &ToolIntent) -> Result<(), String> {
        valid_key(&intent.key)?;
        self.write(&self.root.join(format!("{}.json", intent.key)), intent)
    }

    pub(super) fn binding(&self, key: &str) -> Result<Option<String>, String> {
        valid_key(key)?;
        reference(&self.root.join("bindings").join(format!("{key}.json")))
    }

    pub(super) fn bind(&self, call_key: &str, key: &str) -> Result<(), String> {
        valid_key(call_key)?;
        valid_key(key)?;
        self.write(
            &self.root.join("bindings").join(format!("{call_key}.json")),
            &Reference { key: key.into() },
        )
    }

    pub(super) fn pending(&self, fingerprint: &str) -> Result<Option<String>, String> {
        reference(&self.pending_path(fingerprint)?)
    }

    pub(super) fn reserve(&self, fingerprint: &str, key: &str) -> Result<(), String> {
        valid_key(key)?;
        self.write(
            &self.pending_path(fingerprint)?,
            &Reference { key: key.into() },
        )
    }

    pub(super) fn finish(&self, fingerprint: &str, key: &str) -> Result<(), String> {
        let path = self.pending_path(fingerprint)?;
        if reference(&path)?.as_deref() == Some(key) {
            // A late recovery of an older call must not release a newer query.
            fs::remove_file(path).map_err(|_| "operation_store_unavailable")?;
        }
        Ok(())
    }

    fn pending_path(&self, fingerprint: &str) -> Result<PathBuf, String> {
        if !hex_digest(fingerprint) {
            return Err("operation_store_invalid".into());
        }
        Ok(self
            .root
            .join("pending")
            .join(format!("{fingerprint}.json")))
    }

    fn write<T: Serialize>(&self, path: &Path, value: &T) -> Result<(), String> {
        let bytes = serde_json::to_vec(value).map_err(|_| "operation_store_invalid")?;
        if bytes.len() as u64 > MAX_BYTES {
            return Err("cloud_tool_input_too_large".into());
        }
        // Validate an existing file before replacing it, including symlinks.
        let _: Option<serde_json::Value> = read(path)?;
        store::private_directory(&self.root)?;
        let parent = path.parent().ok_or("operation_store_unavailable")?;
        store::private_directory(parent)?;
        let mut file =
            tempfile::NamedTempFile::new_in(parent).map_err(|_| "operation_store_unavailable")?;
        lime_infra::secure_file::ensure_owner_only_permissions(file.path())
            .map_err(|_| "operation_store_unavailable")?;
        file.write_all(&bytes)
            .and_then(|_| file.as_file().sync_all())
            .map_err(|_| "operation_store_unavailable")?;
        file.persist(path)
            .map_err(|_| "operation_store_unavailable")?;
        Ok(())
    }
}

fn reference(path: &Path) -> Result<Option<String>, String> {
    let value: Option<Reference> = read(path)?;
    value
        .map(|value| {
            valid_key(&value.key)?;
            Ok(value.key)
        })
        .transpose()
}

fn read<T: DeserializeOwned>(path: &Path) -> Result<Option<T>, String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(meta) if meta.is_file() && !meta.file_type().is_symlink() && meta.len() <= MAX_BYTES => {
            meta
        }
        Ok(_) => return Err("operation_store_invalid".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("operation_store_unavailable".into()),
    };
    lime_infra::secure_file::ensure_owner_only_permissions(path)
        .map_err(|_| "operation_store_unavailable")?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    fs::File::open(path)
        .map_err(|_| "operation_store_unavailable")?
        .take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "operation_store_unavailable")?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("operation_store_invalid".into());
    }
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|_| "operation_store_invalid".into())
}

fn valid_key(key: &str) -> Result<(), String> {
    if key.strip_prefix("tool_").is_some_and(hex_digest) {
        Ok(())
    } else {
        Err("operation_store_invalid".into())
    }
}

fn hex_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn late_result_does_not_release_another_pending_operation() {
        let root = tempfile::tempdir().unwrap();
        let journal = CallJournal::new(&root.path().join("account.json")).unwrap();
        let fingerprint = "a".repeat(64);
        let first = format!("tool_{}", "b".repeat(64));
        let second = format!("tool_{}", "c".repeat(64));
        journal.reserve(&fingerprint, &first).unwrap();
        journal.finish(&fingerprint, &first).unwrap();
        assert!(journal.pending(&fingerprint).unwrap().is_none());
        journal.reserve(&fingerprint, &second).unwrap();
        journal.finish(&fingerprint, &first).unwrap();
        assert_eq!(
            journal.pending(&fingerprint).unwrap().as_deref(),
            Some(second.as_str())
        );
        journal.bind(&first, &second).unwrap();
        assert_eq!(
            journal.binding(&first).unwrap().as_deref(),
            Some(second.as_str())
        );
    }

    #[test]
    fn corrupt_pending_references_fail_closed() {
        let root = tempfile::tempdir().unwrap();
        let journal = CallJournal::new(&root.path().join("account.json")).unwrap();
        let fingerprint = "a".repeat(64);
        let key = format!("tool_{}", "b".repeat(64));
        journal.reserve(&fingerprint, &key).unwrap();
        let path = journal.pending_path(&fingerprint).unwrap();
        for bytes in [
            r#"{"key":"../../outside"}"#,
            r#"{"key":null}"#,
            "invalid-json",
        ] {
            fs::write(&path, bytes).unwrap();
            assert_eq!(
                journal.pending(&fingerprint).unwrap_err(),
                "operation_store_invalid"
            );
        }
        #[cfg(unix)]
        {
            fs::remove_file(&path).unwrap();
            let outside = root.path().join("outside.json");
            fs::write(&outside, format!(r#"{{"key":"{key}"}}"#)).unwrap();
            std::os::unix::fs::symlink(&outside, &path).unwrap();
            assert_eq!(
                journal.pending(&fingerprint).unwrap_err(),
                "operation_store_invalid"
            );
            assert_eq!(
                fs::read_to_string(&outside).unwrap(),
                format!(r#"{{"key":"{key}"}}"#)
            );
        }
    }
}
