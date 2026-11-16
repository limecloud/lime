//! Decodes unknown error classifications as `Other` so enclosing records stay readable.
//! The wire definition keeps serialization exhaustive and known payload validation strict.

use crate::protocol::LimeErrorInfo;
use crate::protocol::NonSteerableTurnKind;
use serde::Deserialize;
use serde::Deserializer;
use serde::Serialize;
use serde::Serializer;
use serde::de::Error as _;
use serde_json::Value;

#[derive(Serialize, Deserialize)]
#[serde(
    remote = "LimeErrorInfo",
    rename = "LimeErrorInfo",
    rename_all = "snake_case"
)]
enum LimeErrorInfoWire {
    ContextWindowExceeded,
    SessionBudgetExceeded,
    UsageLimitExceeded,
    RateLimitExceeded,
    FlexUnavailable,
    ServerOverloaded,
    ModelNotFound,
    /// Capacity is unavailable on a route restricted by server policy.
    PolicyCapacityUnavailable,
    InferenceHookDenied,
    CyberPolicy,
    BioPolicy,
    MisalignmentPolicyViolation,
    TooManyDenials,
    HttpConnectionFailed {
        http_status_code: Option<u16>,
    },
    ResponseStreamConnectionFailed {
        http_status_code: Option<u16>,
    },
    InternalServerError,
    Unauthorized,
    BadRequest,
    InvalidPrompt,
    SandboxError,
    ResponseStreamDisconnected {
        http_status_code: Option<u16>,
    },
    ResponseTooManyFailedAttempts {
        http_status_code: Option<u16>,
    },
    ActiveTurnNotSteerable {
        turn_kind: NonSteerableTurnKind,
    },
    ThreadRollbackFailed,
    #[serde(other)]
    Other,
}

impl Serialize for LimeErrorInfo {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        LimeErrorInfoWire::serialize(self, serializer)
    }
}

impl<'de> Deserialize<'de> for LimeErrorInfo {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = Value::deserialize(deserializer)?;
        // Probe the tag first so only unknown payloads are discarded: `serde(other)`
        // recognizes unknown tags, but its unit variant rejects their payloads.
        if let Value::Object(fields) = &value
            && fields.len() == 1
            && let Some(kind) = fields.keys().next()
            && kind != "other"
            && matches!(
                LimeErrorInfoWire::deserialize(Value::String(kind.clone())),
                Ok(Self::Other)
            )
        {
            return Ok(Self::Other);
        }
        LimeErrorInfoWire::deserialize(value).map_err(D::Error::custom)
    }
}
