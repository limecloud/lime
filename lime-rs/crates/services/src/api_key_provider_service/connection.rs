//! 单目标模型连接交付；公开边界只接触一次性公钥、密文及非敏感回执。

use super::*;
use age::secrecy::{ExposeSecret, SecretString};
use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use uuid::Uuid;

const TTL: i64 = 10 * 60;
const MAX_PAYLOAD: usize = 48 * 1024;
const INVALID: &str = "model_connection_invalid";
const STORAGE: &str = "model_connection_storage_failed";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Receipt {
    operation_id: String,
    recipient: String,
    expires_at: i64,
    phase: String,
    provider_id: Option<String>,
    #[serde(skip)]
    identity_ref: String,
    #[serde(skip)]
    payload_sha256: Option<String>,
}

// 故意不实现 Debug，避免把解密后的 key 意外写入 trace。
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Payload {
    version: u32,
    operation_id: String,
    recipient: String,
    expires_at: i64,
    provider: ApiKeyProvider,
    key: String,
    alias: Option<String>,
}

fn operation_id(value: &str) -> Result<Uuid, String> {
    let id = Uuid::parse_str(value).map_err(|_| INVALID)?;
    if id.get_version_num() != 4 || id.to_string() != value {
        return Err(INVALID.into());
    }
    Ok(id)
}

// 稳定、分域的秘密身份让 secret-store 与 SQLite 之间的中断可恢复。
fn reserved_id(id: &str, purpose: &str) -> Uuid {
    let hash = Sha256::digest(format!("lime:model-connection:v1:{purpose}:{id}"));
    Uuid::from_bytes(hash[..16].try_into().expect("SHA256 prefix"))
}

fn reference(id: Uuid) -> String {
    format!(
        "secret:API_KEY_{}",
        id.simple().to_string().to_ascii_uppercase()
    )
}

fn receipt(conn: &rusqlite::Connection, id: &str) -> Result<Option<Receipt>, String> {
    conn.query_row(
        "SELECT recipient, identity_ref, expires_at, payload_sha256, provider_id, phase
         FROM provider_connection_transfers WHERE operation_id = ?1",
        [id],
        |row| {
            Ok(Receipt {
                operation_id: id.into(),
                recipient: row.get(0)?,
                identity_ref: row.get(1)?,
                expires_at: row.get(2)?,
                payload_sha256: row.get(3)?,
                provider_id: row.get(4)?,
                phase: row.get(5)?,
            })
        },
    )
    .optional()
    .map_err(|_| STORAGE.into())
}

fn public_receipt(value: &Receipt) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|_| STORAGE.into())
}

impl ApiKeyProviderService {
    pub fn prepare_model_connection(&self, db: &DbConnection, id: &str) -> Result<Value, String> {
        operation_id(id)?;
        let mut conn = lime_core::database::lock_db(db).map_err(|_| STORAGE)?;
        // 回执先于秘密持久化；公钥可用前只返回 preparing，不延长原有效期。
        conn.execute(
            "INSERT OR IGNORE INTO provider_connection_transfers
             (operation_id, recipient, identity_ref, expires_at, phase)
             VALUES (?1, '', ?2, ?3, 'preparing')",
            params![
                id,
                reference(reserved_id(id, "identity")),
                Utc::now().timestamp() + TTL
            ],
        )
        .map_err(|_| STORAGE)?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| STORAGE)?;
        let mut state = receipt(&tx, id)?.ok_or(STORAGE)?;
        self.expire_model_connection(&tx, &mut state)?;
        if state.phase == "preparing" {
            let identity = match self.credentials.load(&state.identity_ref) {
                Ok(value) => value,
                Err(error) if error == "credential_not_found" => {
                    let generated = age::x25519::Identity::generate().to_string();
                    match self
                        .credentials
                        .save_reserved(reserved_id(id, "identity"), generated.expose_secret())
                    {
                        Ok(_) => generated.expose_secret().to_owned(),
                        Err(error) if error == "credential_reserved_identity_conflict" => {
                            self.credentials.load(&state.identity_ref)?
                        }
                        Err(error) => return Err(error),
                    }
                }
                Err(error) => return Err(error),
            };
            let identity: age::x25519::Identity = identity.parse().map_err(|_| STORAGE)?;
            state.recipient = identity.to_public().to_string();
            tx.execute(
                "UPDATE provider_connection_transfers SET recipient = ?2, phase = 'prepared'
                 WHERE operation_id = ?1 AND phase = 'preparing'",
                params![id, state.recipient],
            )
            .map_err(|_| STORAGE)?;
            state = receipt(&tx, id)?.ok_or(STORAGE)?;
        }
        let result = public_receipt(&state)?;
        tx.commit().map_err(|_| STORAGE)?;
        Ok(result)
    }

    pub fn read_model_connection(&self, db: &DbConnection, id: &str) -> Result<Value, String> {
        operation_id(id)?;
        let conn = lime_core::database::lock_db(db).map_err(|_| STORAGE)?;
        let Some(mut state) = receipt(&conn, id)? else {
            return Ok(json!({"operationId": id, "phase": "notFound"}));
        };
        self.expire_model_connection(&conn, &mut state)?;
        public_receipt(&state)
    }

    fn expire_model_connection(
        &self,
        conn: &rusqlite::Connection,
        state: &mut Receipt,
    ) -> Result<(), String> {
        if state.phase == "complete" {
            // 提交后清理失败或进程退出：只清理临时私钥，不能重新导入。
            self.credentials.delete(&state.identity_ref)?;
        } else if state.expires_at <= Utc::now().timestamp() {
            conn.execute(
                "UPDATE provider_connection_transfers SET phase = 'expired' WHERE operation_id = ?1 AND phase != 'complete'",
                [&state.operation_id],
            ).map_err(|_| STORAGE)?;
            // 跨进程提交必须重新观察，不能误删刚完成的目标 key。
            *state = receipt(conn, &state.operation_id)?.ok_or(STORAGE)?;
            self.credentials.delete(&state.identity_ref)?;
            if state.phase == "expired" {
                self.credentials
                    .delete(&reference(reserved_id(&state.operation_id, "key")))?;
            }
        }
        Ok(())
    }

    pub fn seal_model_connection(
        &self,
        db: &DbConnection,
        id: &str,
        recipient: &str,
        expires_at: i64,
        provider_id: &str,
        key_id: &str,
    ) -> Result<Value, String> {
        operation_id(id)?;
        let now = Utc::now().timestamp();
        if expires_at <= now || expires_at > now + TTL {
            return Err("model_connection_expired".into());
        }
        let public: age::x25519::Recipient = recipient.parse().map_err(|_| INVALID)?;
        let conn = lime_core::database::lock_db(db).map_err(|_| STORAGE)?;
        let provider = ApiKeyProviderDao::get_provider_by_id(&conn, provider_id)
            .map_err(|_| STORAGE)?
            .filter(|p| p.enabled)
            .ok_or(INVALID)?;
        let key = ApiKeyProviderDao::get_api_key_by_id(&conn, key_id)
            .map_err(|_| STORAGE)?
            .filter(|k| k.enabled && k.provider_id == provider.id)
            .ok_or(INVALID)?;
        let payload = Payload {
            version: 1,
            operation_id: id.into(),
            recipient: recipient.into(),
            expires_at,
            provider,
            key: self.read_api_key(&key.api_key_encrypted)?,
            alias: key.alias,
        };
        let plaintext = SecretString::from(serde_json::to_string(&payload).map_err(|_| INVALID)?);
        if plaintext.expose_secret().len() > MAX_PAYLOAD {
            return Err(INVALID.into());
        }
        let mut output = Vec::new();
        let encryptor =
            age::Encryptor::with_recipients(std::iter::once(&public as &dyn age::Recipient))
                .map_err(|_| INVALID)?;
        let mut writer = encryptor.wrap_output(&mut output).map_err(|_| INVALID)?;
        writer
            .write_all(plaintext.expose_secret().as_bytes())
            .map_err(|_| INVALID)?;
        writer.finish().map_err(|_| INVALID)?;
        Ok(json!({"operationId": id, "ciphertext": STANDARD.encode(output)}))
    }

    pub fn apply_model_connection(
        &self,
        db: &DbConnection,
        id: &str,
        ciphertext: &str,
    ) -> Result<Value, String> {
        operation_id(id)?;
        if ciphertext.len() > (MAX_PAYLOAD + 4096) * 2 {
            return Err(INVALID.into());
        }
        let encrypted = STANDARD.decode(ciphertext).map_err(|_| INVALID)?;
        let digest = format!("{:x}", Sha256::digest(&encrypted));
        let mut conn = lime_core::database::lock_db(db).map_err(|_| STORAGE)?;
        let mut state = receipt(&conn, id)?.ok_or(INVALID)?;
        self.expire_model_connection(&conn, &mut state)?;
        if state
            .payload_sha256
            .as_ref()
            .is_some_and(|value| value != &digest)
        {
            return Err("model_connection_payload_conflict".into());
        }
        if state.phase == "complete" {
            return public_receipt(&state);
        }
        if !matches!(state.phase.as_str(), "prepared" | "receiving") {
            return Err("model_connection_expired".into());
        }
        let identity: age::x25519::Identity = self
            .credentials
            .load(&state.identity_ref)?
            .parse()
            .map_err(|_| STORAGE)?;
        let decryptor = age::Decryptor::new(&encrypted[..]).map_err(|_| INVALID)?;
        let mut reader = decryptor
            .decrypt(std::iter::once(&identity as &dyn age::Identity))
            .map_err(|_| INVALID)?;
        let mut plaintext = String::new();
        reader
            .by_ref()
            .take((MAX_PAYLOAD + 1) as u64)
            .read_to_string(&mut plaintext)
            .map_err(|_| INVALID)?;
        let plaintext = SecretString::from(plaintext);
        if plaintext.expose_secret().len() > MAX_PAYLOAD {
            return Err(INVALID.into());
        }
        let payload: Payload =
            serde_json::from_str(plaintext.expose_secret()).map_err(|_| INVALID)?;
        if payload.version != 1
            || payload.operation_id != id
            || payload.recipient != state.recipient
            || payload.expires_at != state.expires_at
            || payload.key.trim().is_empty()
        {
            return Err(INVALID.into());
        }
        // 先固化密文身份，重试不能改用新的 key 或配置；secret 身份也是原操作固定值。
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| STORAGE)?;
        let current = receipt(&tx, id)?.ok_or(STORAGE)?;
        if current.phase == "complete" {
            return public_receipt(&current);
        }
        if current.phase == "expired" || current.expires_at <= Utc::now().timestamp() {
            return Err("model_connection_expired".into());
        }
        if current
            .payload_sha256
            .as_ref()
            .is_some_and(|value| value != &digest)
        {
            return Err("model_connection_payload_conflict".into());
        }
        tx.execute("UPDATE provider_connection_transfers SET phase = 'receiving', payload_sha256 = ?2 WHERE operation_id = ?1", params![id, digest]).map_err(|_| STORAGE)?;
        tx.commit().map_err(|_| STORAGE)?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| STORAGE)?;
        let current = receipt(&tx, id)?.ok_or(STORAGE)?;
        if current.phase == "complete" {
            return public_receipt(&current);
        }
        if current.phase != "receiving" || current.expires_at <= Utc::now().timestamp() {
            return Err("model_connection_expired".into());
        }
        let secret_ref = self
            .credentials
            .save_reserved(reserved_id(id, "key"), &payload.key)?;
        let now = Utc::now();
        let mut provider = payload.provider;
        provider.id = format!("custom-{id}");
        provider.is_system = false;
        provider.group = ProviderGroup::Custom;
        provider.sort_order = 9999;
        provider.enabled = true;
        provider.created_at = now;
        provider.updated_at = now;
        let key = ApiKeyEntry {
            id: reserved_id(id, "key").to_string(),
            provider_id: provider.id.clone(),
            api_key_encrypted: secret_ref,
            alias: payload.alias,
            enabled: true,
            usage_count: 0,
            error_count: 0,
            last_used_at: None,
            created_at: now,
        };
        // INSERT 而非 upsert：目标已有 Provider 永不覆盖。
        ApiKeyProviderDao::insert_provider(&tx, &provider).map_err(|_| STORAGE)?;
        ApiKeyProviderDao::insert_api_key(&tx, &key).map_err(|_| STORAGE)?;
        RouteStateDao::advance_generation(&tx).map_err(|_| STORAGE)?;
        tx.execute("UPDATE provider_connection_transfers SET phase = 'complete', provider_id = ?2 WHERE operation_id = ?1", params![id, provider.id]).map_err(|_| STORAGE)?;
        tx.commit().map_err(|_| STORAGE)?;
        let mut completed = receipt(&conn, id)?.ok_or(STORAGE)?;
        self.expire_model_connection(&conn, &mut completed)?;
        public_receipt(&completed)
    }
}

#[cfg(test)]
mod tests;
