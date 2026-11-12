use super::{cloud::MAX_RESPONSE_BYTES, store, AccountManager};
use app_server_protocol::protocol::v2::Account;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Read, Write},
};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Operation {
    pub key: String,
    pub task_id: String,
    pub path: String,
    pub input: serde_json::Value,
    pub language: String,
    pub recovery_path: String,
    pub status: String,
    pub created_at: String,
}

impl AccountManager {
    fn operation_path(&self, account: &Account, key: &str) -> Result<std::path::PathBuf, String> {
        if !(16..=128).contains(&key.len())
            || !key
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
        {
            return Err("operation_key_invalid".into());
        }
        let credentials = self.path.parent().ok_or("account_store_unavailable")?;
        store::check_directory(credentials)?;
        let operations = credentials.join("operations");
        store::check_directory(&operations)?;
        let parent = operations.join(Self::plugin_identity_for(account));
        store::check_directory(&parent)?;
        Ok(parent.join(format!("{key}.json")))
    }

    pub(super) fn operation(
        &self,
        account: &Account,
        key: &str,
    ) -> Result<Option<Operation>, String> {
        let path = self.operation_path(account, key)?;
        let metadata = match fs::symlink_metadata(&path) {
            Ok(meta) if meta.is_file() && !meta.file_type().is_symlink() => meta,
            Ok(_) => return Err("operation_store_invalid".into()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err("operation_store_unavailable".into()),
        };
        if metadata.len() > MAX_RESPONSE_BYTES as u64 {
            return Err("operation_store_invalid".into());
        }
        lime_infra::secure_file::ensure_owner_only_permissions(&path)
            .map_err(|_| "operation_store_unavailable")?;
        let mut bytes = Vec::new();
        fs::File::open(path)
            .map_err(|_| "operation_store_unavailable")?
            .take(MAX_RESPONSE_BYTES as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "operation_store_unavailable")?;
        if bytes.len() > MAX_RESPONSE_BYTES {
            return Err("operation_store_invalid".into());
        }
        serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|_| "operation_store_invalid".into())
    }

    pub(super) fn save_operation(
        &self,
        account: &Account,
        value: &Operation,
    ) -> Result<(), String> {
        let path = self.operation_path(account, &value.key)?;
        let parent = path.parent().ok_or("operation_store_unavailable")?;
        store::private_directory(parent.parent().ok_or("operation_store_unavailable")?)?;
        store::private_directory(parent)?;
        let mut file =
            tempfile::NamedTempFile::new_in(parent).map_err(|_| "operation_store_unavailable")?;
        lime_infra::secure_file::ensure_owner_only_permissions(file.path())
            .map_err(|_| "operation_store_unavailable")?;
        let bytes = serde_json::to_vec(value).map_err(|_| "operation_store_invalid")?;
        if bytes.len() > MAX_RESPONSE_BYTES {
            return Err("operation_store_full".into());
        }
        file.write_all(&bytes)
            .and_then(|_| file.as_file().sync_all())
            .map_err(|_| "operation_store_unavailable")?;
        file.persist(path)
            .map_err(|_| "operation_store_unavailable")?;
        Ok(())
    }

    pub(super) fn begin_operation(
        &self,
        account: &Account,
        epoch: &str,
        value: &Operation,
    ) -> Result<bool, String> {
        store::with_lock(&self.path, || {
            let state = store::load(&self.path)?;
            if state.epoch != epoch {
                return Err("account_changed".into());
            }
            if let Some(original) = self.operation(account, &value.key)? {
                if original.task_id != value.task_id
                    || original.path != value.path
                    || original.input != value.input
                {
                    return Err("operation_key_conflict".into());
                }
                return Ok(false);
            }
            self.save_operation(account, value)?;
            Ok(true)
        })
    }
}
