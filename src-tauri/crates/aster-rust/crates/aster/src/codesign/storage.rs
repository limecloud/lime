//! 签名存储管理

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::RwLock;

use once_cell::sync::Lazy;

use super::types::{CodeSignature, SigningKey};

/// 签名目录
fn get_signing_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".aster")
        .join("signing")
}

/// 密钥文件路径
fn get_keys_file() -> PathBuf {
    get_signing_dir().join("keys.json")
}

/// 签名文件路径
fn get_signatures_file() -> PathBuf {
    get_signing_dir().join("signatures.json")
}

/// 签名缓存
static SIGNATURE_CACHE: Lazy<RwLock<HashMap<String, CodeSignature>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

/// 初始化签名系统
pub fn init_signing() {
    let dir = get_signing_dir();
    if !dir.exists() {
        let _ = std::fs::create_dir_all(&dir);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
        }
    }
}

/// 保存密钥
pub fn save_key(key: &SigningKey) -> Result<(), String> {
    init_signing();

    let mut keys = load_keys();
    keys.retain(|k| k.id != key.id);
    keys.push(key.clone());

    let json = serde_json::to_string_pretty(&keys)
        .map_err(|e| format!("Failed to serialize keys: {}", e))?;

    std::fs::write(get_keys_file(), json).map_err(|e| format!("Failed to write keys: {}", e))?;

    Ok(())
}

/// 加载密钥
pub fn load_keys() -> Vec<SigningKey> {
    let file = get_keys_file();
    if !file.exists() {
        return Vec::new();
    }

    std::fs::read_to_string(&file)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// 缓存签名
pub fn cache_signature(path: &str, signature: CodeSignature) {
    if let Ok(mut cache) = SIGNATURE_CACHE.write() {
        cache.insert(path.to_string(), signature);
    }
}

/// 获取缓存的签名
pub fn get_cached_signature(path: &str) -> Option<CodeSignature> {
    // 先尝试从缓存获取
    if let Ok(cache) = SIGNATURE_CACHE.read() {
        if let Some(sig) = cache.get(path) {
            return Some(sig.clone());
        }
    }

    // 从文件加载
    load_signatures();

    SIGNATURE_CACHE.read().ok()?.get(path).cloned()
}

/// 保存签名到文件
pub fn save_signatures() {
    init_signing();

    let signatures: HashMap<String, CodeSignature> = SIGNATURE_CACHE
        .read()
        .map(|c| c.clone())
        .unwrap_or_default();

    if let Ok(json) = serde_json::to_string_pretty(&signatures) {
        let _ = std::fs::write(get_signatures_file(), json);
    }
}

/// 从文件加载签名
pub fn load_signatures() {
    let file = get_signatures_file();
    if !file.exists() {
        return;
    }

    if let Ok(content) = std::fs::read_to_string(&file) {
        if let Ok(sigs) = serde_json::from_str::<HashMap<String, CodeSignature>>(&content) {
            if let Ok(mut cache) = SIGNATURE_CACHE.write() {
                for (path, sig) in sigs {
                    cache.insert(path, sig);
                }
            }
        }
    }
}

/// 清除文件签名
pub fn clear_signature(file_path: &str) {
    use std::path::Path;

    let absolute_path = Path::new(file_path)
        .canonicalize()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| file_path.to_string());

    if let Ok(mut cache) = SIGNATURE_CACHE.write() {
        cache.remove(&absolute_path);
    }
    save_signatures();
}

/// 获取所有已签名文件
pub fn get_signed_files() -> Vec<(String, CodeSignature)> {
    load_signatures();

    SIGNATURE_CACHE
        .read()
        .map(|c| c.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
        .unwrap_or_default()
}

/// 检查文件是否已签名
pub fn is_signed(file_path: &str) -> bool {
    use std::path::Path;

    let absolute_path = Path::new(file_path)
        .canonicalize()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| file_path.to_string());

    load_signatures();

    SIGNATURE_CACHE
        .read()
        .map(|c| c.contains_key(&absolute_path))
        .unwrap_or(false)
}
