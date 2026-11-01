//! Provider 凭据身份由 services 管理；加密和系统密钥库复用上游 infra 实现。

use lime_infra::secrets::{SecretName, SecretScope, SecretsBackendKind, SecretsManager};
use std::path::PathBuf;

const REFERENCE_PREFIX: &str = "secret:";

pub(crate) struct ProviderCredentialStore {
    configuration: Result<Configuration, String>,
}

struct Configuration {
    root: PathBuf,
    mode: StoreMode,
}

impl Configuration {
    // Desktop 与独立 CLI 共享同一 age 文件，锁覆盖 keyring 初始化和完整读改写。
    fn lock(&self) -> Result<std::fs::File, String> {
        let directory = self.root.join("credentials");
        let mut builder = std::fs::DirBuilder::new();
        builder.recursive(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder
            .create(&directory)
            .map_err(|_| "credential_store_write_failed")?;
        let mut options = std::fs::OpenOptions::new();
        options.create(true).read(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let file = options
            .open(directory.join("store.lock"))
            .map_err(|_| "credential_store_lock_failed")?;
        // age 的一次 scrypt 读改写在真实平台上可能超过三秒，等待覆盖该操作。
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
        loop {
            match file.try_lock() {
                Ok(()) => break,
                Err(std::fs::TryLockError::WouldBlock) if std::time::Instant::now() < deadline => {
                    std::thread::sleep(std::time::Duration::from_millis(10));
                }
                Err(_) => return Err("credential_store_lock_failed".to_string()),
            }
        }
        Ok(file)
    }
}

enum StoreMode {
    Keyring,
    File,
}

impl ProviderCredentialStore {
    pub(crate) fn new() -> Self {
        Self {
            configuration: (|| {
                let root = lime_core::app_paths::resolve_lime_home_dir()
                    .ok_or_else(|| "credential_store_home_unavailable".to_string())?;
                let mode = match std::env::var("LIME_CREDENTIALS_STORE") {
                    Err(std::env::VarError::NotPresent) => StoreMode::Keyring,
                    Ok(value) if value == "keyring" => StoreMode::Keyring,
                    Ok(value) if value == "file" => StoreMode::File,
                    _ => return Err("credential_store_mode_invalid".to_string()),
                };
                Ok(Configuration { root, mode })
            })(),
        }
    }

    #[cfg(test)]
    pub(crate) fn file(root: PathBuf) -> Self {
        Self {
            configuration: Ok(Configuration {
                root,
                mode: StoreMode::File,
            }),
        }
    }

    fn configuration(&self) -> Result<&Configuration, String> {
        self.configuration.as_ref().map_err(Clone::clone)
    }

    pub(crate) fn save(&self, plaintext: &str) -> Result<String, String> {
        if plaintext.trim().is_empty() {
            return Err("credential_value_empty".to_string());
        }
        let name = SecretName::new(&format!(
            "API_KEY_{}",
            uuid::Uuid::new_v4()
                .simple()
                .to_string()
                .to_ascii_uppercase()
        ))
        .map_err(|_| "credential_reference_invalid".to_string())?;
        let config = self.configuration()?;
        let _lock = config.lock()?;
        match config.mode {
            StoreMode::Keyring => {
                SecretsManager::new(config.root.clone(), SecretsBackendKind::Local)
                    .set(&SecretScope::Global, &name, plaintext)
                    .map_err(|_| "credential_store_write_failed".to_string())?
            }
            StoreMode::File => {
                let path = config
                    .root
                    .join("credentials")
                    .join(format!("{}.json", name.as_str()));
                let parent = path.parent().expect("credential path has parent");
                std::fs::create_dir_all(parent).map_err(|_| "credential_store_write_failed")?;
                let mut options = std::fs::OpenOptions::new();
                options.write(true).create_new(true);
                #[cfg(unix)]
                {
                    use std::os::unix::fs::OpenOptionsExt;
                    options.mode(0o600);
                }
                let mut file = options
                    .open(&path)
                    .map_err(|_| "credential_store_write_failed")?;
                let persisted = (|| -> Result<(), String> {
                    lime_infra::secure_file::ensure_owner_only_permissions(&path)
                        .map_err(|_| "credential_store_permissions_failed")?;
                    serde_json::to_writer(&mut file, plaintext)
                        .map_err(|_| "credential_store_write_failed")?;
                    file.sync_all()
                        .map_err(|_| "credential_store_write_failed")?;
                    Ok(())
                })();
                drop(file);
                if let Err(error) = persisted {
                    std::fs::remove_file(path)
                        .map_err(|_| "credential_store_rollback_cleanup_failed")?;
                    return Err(error);
                }
            }
        }
        Ok(format!("{REFERENCE_PREFIX}{}", name.as_str()))
    }

    pub(crate) fn load(&self, reference: &str) -> Result<String, String> {
        let name = reference_name(reference)?;
        let config = self.configuration()?;
        let _lock = config.lock()?;
        match config.mode {
            StoreMode::Keyring => {
                SecretsManager::new(config.root.clone(), SecretsBackendKind::Local)
                    .get(&SecretScope::Global, &name)
                    .map_err(|_| "credential_store_read_failed".to_string())?
                    .ok_or_else(|| "credential_not_found".to_string())
            }
            StoreMode::File => {
                let path = config
                    .root
                    .join("credentials")
                    .join(format!("{}.json", name.as_str()));
                lime_infra::secure_file::ensure_owner_only_permissions(&path)
                    .map_err(|_| "credential_store_permissions_failed")?;
                let file = std::fs::File::open(path).map_err(|_| "credential_store_read_failed")?;
                serde_json::from_reader(file)
                    .map_err(|_| "credential_store_read_failed".to_string())
            }
        }
    }

    pub(crate) fn delete(&self, reference: &str) -> Result<(), String> {
        // 旧数据库中的 XOR 值没有外部 secret；允许直接移除记录，不再解密旧格式。
        if !reference.starts_with(REFERENCE_PREFIX) {
            return Ok(());
        }
        let name = reference_name(reference)?;
        let config = self.configuration()?;
        let _lock = config.lock()?;
        match config.mode {
            StoreMode::Keyring => {
                SecretsManager::new(config.root.clone(), SecretsBackendKind::Local)
                    .delete(&SecretScope::Global, &name)
                    .map_err(|_| "credential_store_delete_failed")?;
            }
            StoreMode::File => {
                let path = config
                    .root
                    .join("credentials")
                    .join(format!("{}.json", name.as_str()));
                match std::fs::remove_file(path) {
                    Ok(()) => {}
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(_) => return Err("credential_store_delete_failed".to_string()),
                }
            }
        }
        Ok(())
    }
}

fn reference_name(reference: &str) -> Result<SecretName, String> {
    reference
        .strip_prefix(REFERENCE_PREFIX)
        .filter(|name| name.starts_with("API_KEY_"))
        .and_then(|name| SecretName::new(name).ok())
        .ok_or_else(|| "credential_reference_invalid".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_credentials_reopen_delete_and_reject_legacy_values() {
        let root = tempfile::tempdir().unwrap();
        let store = ProviderCredentialStore::file(root.path().to_path_buf());
        let reference = store.save("fixture-key").unwrap();
        assert!(!reference.contains("fixture-key"));
        let reopened = ProviderCredentialStore::file(root.path().to_path_buf());
        assert_eq!(reopened.load(&reference).unwrap(), "fixture-key");
        assert!(reopened.load("cHJldmlvdXMteG9yLWZvcm1hdA==").is_err());
        assert!(reopened.load("secret:API_KEY_../../escape").is_err());
        reopened.delete(&reference).unwrap();
        assert!(store.load(&reference).is_err());
    }

    #[test]
    fn lock_excludes_another_store_and_releases_after_drop() {
        let root = tempfile::tempdir().unwrap();
        let first = ProviderCredentialStore::file(root.path().to_path_buf());
        let held = first.configuration().unwrap().lock().unwrap();
        let second = ProviderCredentialStore::file(root.path().to_path_buf());
        assert_eq!(
            second.save("fixture-key").unwrap_err(),
            "credential_store_lock_failed"
        );
        drop(held);
        let reference = second.save("fixture-key").unwrap();
        assert_eq!(first.load(&reference).unwrap(), "fixture-key");
        assert!(root.path().join("credentials/store.lock").exists());
    }

    #[test]
    #[ignore = "requires an unlocked OS credential store"]
    fn keyring_credentials_round_trip_with_concurrent_stores() {
        use lime_infra::keyring_store::{DefaultKeyringStore, KeyringStore};
        use lime_infra::secrets::{compute_keyring_account, LocalSecretsNamespace};
        let root = tempfile::tempdir().unwrap();
        struct Cleanup(String);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = DefaultKeyringStore.delete("lime", &self.0);
            }
        }
        let _cleanup = Cleanup(compute_keyring_account(
            root.path(),
            LocalSecretsNamespace::ManagedSecrets,
        ));
        let keyring_store = |root| ProviderCredentialStore {
            configuration: Ok(Configuration {
                root,
                mode: StoreMode::Keyring,
            }),
        };
        let first = keyring_store(root.path().to_path_buf());
        let second = keyring_store(root.path().to_path_buf());
        let first_reference = first.save("first-generated-fixture").unwrap();
        let other = std::thread::spawn(move || second.save("second-generated-fixture").unwrap());
        let third_reference = first.save("third-generated-fixture").unwrap();
        let second_reference = other.join().unwrap();
        let reopened = keyring_store(root.path().to_path_buf());
        assert_eq!(
            reopened.load(&first_reference).unwrap(),
            "first-generated-fixture"
        );
        assert_eq!(
            reopened.load(&second_reference).unwrap(),
            "second-generated-fixture"
        );
        assert_eq!(
            reopened.load(&third_reference).unwrap(),
            "third-generated-fixture"
        );
        let ciphertext = std::fs::read(root.path().join("secrets/local.age")).unwrap();
        assert!(!ciphertext
            .windows(b"generated-fixture".len())
            .any(|window| window == b"generated-fixture"));
        for reference in [&first_reference, &second_reference, &third_reference] {
            reopened.delete(reference).unwrap();
            assert_eq!(
                reopened.load(reference).unwrap_err(),
                "credential_not_found"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn file_credentials_are_private() {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::tempdir().unwrap();
        let store = ProviderCredentialStore::file(root.path().to_path_buf());
        let reference = store.save("fixture-key").unwrap();
        let name = reference_name(&reference).unwrap();
        let path = root
            .path()
            .join("credentials")
            .join(format!("{}.json", name.as_str()));
        assert_eq!(
            std::fs::metadata(path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
}
