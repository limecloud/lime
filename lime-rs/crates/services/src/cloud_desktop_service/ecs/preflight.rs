//! 付费采购前核对本机网络；短期检查记录绑定不可变报价，不保存公网地址。

use super::*;
use chrono::{DateTime, Utc};
use std::future::Future;

const REQUIRED: &str = "CLOUD_PURCHASE_PREFLIGHT_REQUIRED";

impl CloudDesktopService {
    pub(in crate::cloud_desktop_service) async fn preflight_ecs_purchase(
        &self,
        spec: &EcsDesktopSpec,
        quote_id: &str,
    ) -> Result<Value, String> {
        self.preflight_ecs_purchase_with_network(spec, quote_id, access::check_network())
            .await
    }

    pub(in crate::cloud_desktop_service) async fn preflight_ecs_purchase_with_network(
        &self,
        spec: &EcsDesktopSpec,
        quote_id: &str,
        network: impl Future<Output = Result<(), String>>,
    ) -> Result<Value, String> {
        validate_spec(spec)?;
        self.ensure_root()?;
        let spec = serde_json::to_value(spec).map_err(|_| "Invalid preflight specification")?;
        self.approved_quote(&spec, quote_id)?;
        network.await?;
        let _lock = self.lock_operations()?;
        let quote = self.approved_quote(&spec, quote_id)?;
        let checked = Utc::now();
        let expiry = DateTime::parse_from_rfc3339(quote["expiresAt"].as_str().unwrap())
            .map_err(|_| "Invalid quote expiry")?
            .with_timezone(&Utc)
            .min(checked + chrono::Duration::seconds(60));
        let proof = json!({
            "quoteId": quote_id,
            "networkReady": true,
            "checkedAt": checked.to_rfc3339(),
            "expiresAt": expiry.to_rfc3339(),
        });
        // Quote files remain immutable. The existing private atomic writer owns
        // the independent, short-lived observation; operation listings skip it.
        self.replace_receipt(&format!("quote-network-{quote_id}"), &proof)?;
        Ok(proof)
    }

    pub(super) fn require_ecs_purchase_preflight(
        &self,
        quote: &Value,
        quote_id: &str,
    ) -> Result<(), String> {
        let valid = || -> Option<()> {
            if !super::super::purchase::valid_quote_id(quote_id) {
                return None;
            }
            let path = self.root.join(format!("quote-network-{quote_id}.json"));
            if !path.try_exists().ok()? {
                return None;
            }
            let file = private_open(&path, false).ok()?;
            if file.metadata().ok()?.len() > 1024 {
                return None;
            }
            let proof: Value = serde_json::from_reader(file).ok()?;
            let checked = DateTime::parse_from_rfc3339(proof["checkedAt"].as_str()?).ok()?;
            let expires = DateTime::parse_from_rfc3339(proof["expiresAt"].as_str()?).ok()?;
            let quote_expiry = DateTime::parse_from_rfc3339(quote["expiresAt"].as_str()?).ok()?;
            let now = Utc::now();
            (proof["quoteId"] == quote_id
                && proof["networkReady"] == true
                && checked <= now
                && expires > now
                && expires == quote_expiry.min(checked + chrono::Duration::seconds(60)))
            .then_some(())
        };
        valid().ok_or_else(|| REQUIRED.into())
    }
}

#[cfg(all(test, unix))]
#[path = "preflight/tests.rs"]
mod tests;
