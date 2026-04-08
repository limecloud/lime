//! 签名和验证功能

use sha2::{Digest, Sha256, Sha384, Sha512};

use super::keys::get_key;
use super::types::*;

/// 计算内容哈希
pub fn hash_content(content: &str, algorithm: HashAlgorithm) -> String {
    match algorithm {
        HashAlgorithm::Sha256 => {
            let mut hasher = Sha256::new();
            hasher.update(content.as_bytes());
            hex::encode(hasher.finalize())
        }
        HashAlgorithm::Sha384 => {
            let mut hasher = Sha384::new();
            hasher.update(content.as_bytes());
            hex::encode(hasher.finalize())
        }
        HashAlgorithm::Sha512 => {
            let mut hasher = Sha512::new();
            hasher.update(content.as_bytes());
            hex::encode(hasher.finalize())
        }
    }
}

/// 使用私钥签名内容
///
/// 注意：当前实现使用 HMAC-SHA256 作为简化签名
/// 如需完整的 Ed25519 签名，需要添加 ring 或 ed25519-dalek 依赖
pub fn sign_content(content: &str, key: &SigningKey) -> Option<CodeSignature> {
    let private_key = key.private_key.as_ref()?;

    let hash = hash_content(content, HashAlgorithm::Sha256);

    // 使用 HMAC-like 签名（简化实现）
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(hash.as_bytes());
    hasher.update(private_key.as_bytes());
    let signature = hex::encode(hasher.finalize());

    Some(CodeSignature {
        hash,
        algorithm: HashAlgorithm::Sha256,
        timestamp: chrono::Utc::now().timestamp_millis(),
        signed_by: Some(key.id.clone()),
        signature: Some(signature),
    })
}

/// 验证签名
pub fn verify_signature(content: &str, signature: &CodeSignature) -> bool {
    let (sig, key) = match (&signature.signature, &signature.signed_by) {
        (Some(sig), Some(signer)) => {
            let key = match get_key(signer) {
                Some(k) => k,
                None => return false,
            };
            (sig.clone(), key)
        }
        _ => return false,
    };

    // 验证哈希
    let hash = hash_content(content, signature.algorithm);
    if hash != signature.hash {
        return false;
    }

    // 验证签名（HMAC-like）
    let private_key = match &key.private_key {
        Some(pk) => pk,
        None => return false,
    };

    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(hash.as_bytes());
    hasher.update(private_key.as_bytes());
    let expected_sig = hex::encode(hasher.finalize());

    sig == expected_sig
}

/// 签名文件
pub fn sign_file(file_path: &str, key_id: Option<&str>) -> Option<SignedFile> {
    use std::path::Path;

    let absolute_path = Path::new(file_path)
        .canonicalize()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| file_path.to_string());

    let content = std::fs::read_to_string(&absolute_path).ok()?;

    // 获取签名密钥
    let key = if let Some(id) = key_id {
        get_key(id)
    } else {
        super::keys::get_signing_key()
    };

    let signature = if let Some(k) = key {
        sign_content(&content, &k)?
    } else {
        // 仅哈希签名
        CodeSignature {
            hash: hash_content(&content, HashAlgorithm::Sha256),
            algorithm: HashAlgorithm::Sha256,
            timestamp: chrono::Utc::now().timestamp_millis(),
            signed_by: None,
            signature: None,
        }
    };

    // 缓存签名
    super::storage::cache_signature(&absolute_path, signature.clone());
    super::storage::save_signatures();

    Some(SignedFile {
        path: absolute_path,
        content,
        signature,
    })
}

/// 验证文件签名
pub fn verify_file(file_path: &str) -> VerifyResult {
    use std::path::Path;

    let absolute_path = Path::new(file_path)
        .canonicalize()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| file_path.to_string());

    let content = match std::fs::read_to_string(&absolute_path) {
        Ok(c) => c,
        Err(_) => return VerifyResult::err("File not found"),
    };

    // 获取签名
    let signature = match super::storage::get_cached_signature(&absolute_path) {
        Some(s) => s,
        None => return VerifyResult::err("No signature found"),
    };

    // 验证哈希
    let current_hash = hash_content(&content, signature.algorithm);
    if current_hash != signature.hash {
        return VerifyResult::err_with_sig("File has been modified", signature);
    }

    // 验证加密签名
    if signature.signature.is_some() && !verify_signature(&content, &signature) {
        return VerifyResult::err_with_sig("Cryptographic signature invalid", signature);
    }

    VerifyResult::ok(signature)
}
