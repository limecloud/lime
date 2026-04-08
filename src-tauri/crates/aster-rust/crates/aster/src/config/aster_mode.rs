use std::str::FromStr;

use serde::{Deserialize, Serialize};

#[derive(Copy, Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AsterMode {
    Auto,
    Approve,
    SmartApprove,
    Chat,
}

impl FromStr for AsterMode {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "auto" => Ok(AsterMode::Auto),
            "approve" => Ok(AsterMode::Approve),
            "smart_approve" => Ok(AsterMode::SmartApprove),
            "chat" => Ok(AsterMode::Chat),
            _ => Err(format!("invalid mode: {}", s)),
        }
    }
}
