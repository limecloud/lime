//! 签名密钥管理

use super::storage::{load_keys, save_key};
use super::types::SigningKey;

/// 生成新的签名密钥对
///
/// 注意：当前实现仅生成密钥 ID，不包含加密签名功能
/// 如需完整的 Ed25519 签名，需要添加 ring 或 ed25519-dalek 依赖
pub fn generate_key_pair() -> Result<SigningKey, String> {
    use rand::RngCore;

    let mut rng = rand::thread_rng();

    // 生成随机 ID
    let mut id_bytes = [0u8; 16];
    rng.fill_bytes(&mut id_bytes);
    let id = hex::encode(id_bytes);

    // 生成占位符密钥（实际使用需要真正的密钥生成）
    let mut key_bytes = [0u8; 32];
    rng.fill_bytes(&mut key_bytes);
    let public_key = hex::encode(key_bytes);

    let mut private_bytes = [0u8; 64];
    rng.fill_bytes(&mut private_bytes);
    let private_key = hex::encode(private_bytes);

    let key = SigningKey {
        id: id.clone(),
        public_key,
        private_key: Some(private_key),
        created_at: chrono::Utc::now().timestamp_millis(),
        name: None,
    };

    // 保存密钥
    save_key(&key)?;

    Ok(key)
}

/// 根据 ID 获取密钥
pub fn get_key(id: &str) -> Option<SigningKey> {
    let keys = load_keys();
    keys.into_iter().find(|k| k.id == id)
}

/// 获取第一个可用的签名密钥（有私钥的）
pub fn get_signing_key() -> Option<SigningKey> {
    let keys = load_keys();
    keys.into_iter().find(|k| k.private_key.is_some())
}
