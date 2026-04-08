//! 代码签名类型定义

use serde::{Deserialize, Serialize};

/// 哈希算法
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum HashAlgorithm {
    #[default]
    Sha256,
    Sha384,
    Sha512,
}

impl HashAlgorithm {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Sha256 => "sha256",
            Self::Sha384 => "sha384",
            Self::Sha512 => "sha512",
        }
    }
}

/// 代码签名
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeSignature {
    /// 内容哈希
    pub hash: String,
    /// 哈希算法
    pub algorithm: HashAlgorithm,
    /// 签名时间戳
    pub timestamp: i64,
    /// 签名者 ID
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signed_by: Option<String>,
    /// 加密签名
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
}

/// 已签名文件
#[derive(Debug, Clone)]
pub struct SignedFile {
    /// 文件路径
    pub path: String,
    /// 文件内容
    pub content: String,
    /// 签名信息
    pub signature: CodeSignature,
}

/// 签名密钥
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SigningKey {
    /// 密钥 ID
    pub id: String,
    /// 公钥 (PEM 格式)
    pub public_key: String,
    /// 私钥 (PEM 格式，可选)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub private_key: Option<String>,
    /// 创建时间
    pub created_at: i64,
    /// 密钥名称
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

/// 验证结果
#[derive(Debug, Clone)]
pub struct VerifyResult {
    /// 是否有效
    pub valid: bool,
    /// 原因（如果无效）
    pub reason: Option<String>,
    /// 签名信息
    pub signature: Option<CodeSignature>,
}

impl VerifyResult {
    pub fn ok(signature: CodeSignature) -> Self {
        Self {
            valid: true,
            reason: None,
            signature: Some(signature),
        }
    }

    pub fn err(reason: impl Into<String>) -> Self {
        Self {
            valid: false,
            reason: Some(reason.into()),
            signature: None,
        }
    }

    pub fn err_with_sig(reason: impl Into<String>, sig: CodeSignature) -> Self {
        Self {
            valid: false,
            reason: Some(reason.into()),
            signature: Some(sig),
        }
    }
}
