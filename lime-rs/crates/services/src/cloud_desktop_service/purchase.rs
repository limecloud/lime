//! 购买共用的报价确认与持久去重。未知操作不能靠换编号或 profile 别名重购。

use super::*;
use sha2::{Digest, Sha256};

pub(super) fn validate_confirmation(
    provider: &str,
    region: &str,
    name: &str,
    quote_id: &str,
    confirmation: &str,
) -> Result<(), String> {
    if quote_id.len() != 64
        || !quote_id.bytes().all(|byte| byte.is_ascii_hexdigit())
        || name.is_empty()
        || name.len() > 64
        || !name.as_bytes()[0].is_ascii_alphabetic()
        || !name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(&byte))
        || confirmation != format!("purchase:{provider}:{region}:{name}:{quote_id}")
    {
        return Err(
            "Explicit purchase confirmation for the exact quote and desktop name is required"
                .into(),
        );
    }
    Ok(())
}

impl CloudDesktopService {
    pub(super) fn store_quote(&self, spec: Value, price: Value) -> Result<Value, String> {
        self.ensure_root()?;
        let created = chrono::Utc::now();
        let quote = json!({ "spec": spec, "price": price, "createdAt": created.to_rfc3339(),
            "expiresAt": (created + chrono::Duration::minutes(15)).to_rfc3339(),
            "amount": 1, "chargeType": "PostPaid", "autoRenew": false,
            "requiresExplicitPurchase": true });
        let bytes = serde_json::to_vec(&quote).map_err(|_| "Cannot encode quote")?;
        let id = format!("{:x}", Sha256::digest(&bytes));
        let mut file = private_open(&self.root.join(format!("quote-{id}.json")), true)?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| "Cannot persist quote")?;
        Ok(json!({ "quoteId": id, "quote": quote }))
    }

    pub(super) fn approved_quote(&self, spec: &Value, id: &str) -> Result<Value, String> {
        let path = self.root.join(format!("quote-{id}.json"));
        if !path.try_exists().map_err(|_| "Cannot inspect quote")? {
            return Err("Quote is unavailable".into());
        }
        let file = private_open(&path, false)?;
        if file.metadata().map_err(|_| "Cannot inspect quote")?.len() > 16384 {
            return Err("Invalid quote size".into());
        }
        let quote: Value = serde_json::from_reader(file).map_err(|_| "Quote is unavailable")?;
        if quote["spec"] != *spec
            || quote["expiresAt"]
                .as_str()
                .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
                .is_none_or(|value| value <= chrono::Utc::now())
        {
            return Err("Quote expired or does not match the selected specification".into());
        }
        let bytes = serde_json::to_vec(&quote).map_err(|_| "Cannot encode quote")?;
        if format!("{:x}", Sha256::digest(&bytes)) != id {
            return Err("Quote integrity check failed; obtain and approve a new quote".into());
        }
        Ok(quote)
    }

    pub(super) fn check_purchase_available(
        &self,
        action: &str,
        region: &str,
        name: &str,
        quote_id: &str,
    ) -> Result<(), String> {
        let mut receipts = Vec::new();
        for entry in fs::read_dir(&self.root).map_err(|_| "Cannot list cloud operations")? {
            let entry = entry.map_err(|_| "Cannot inspect cloud operation")?;
            let name_on_disk = entry.file_name();
            let Some(file) = name_on_disk.to_str() else {
                continue;
            };
            if !file.ends_with(".json")
                || file.starts_with("quote-")
                || file.starts_with("resource-")
            {
                continue;
            }
            let id = file.trim_end_matches(".json");
            validate_id(id)?;
            let receipt = self.read_receipt(id)?.ok_or("Missing cloud operation")?;
            receipts.push((id.to_owned(), receipt));
        }
        for (id, receipt) in &receipts {
            let request = &receipt["request"];
            let provider = if action == "purchaseEcs" {
                "ecs"
            } else {
                "wuying"
            };
            let purchased_ids: Vec<&str> = if action == "purchaseEcs" {
                receipt["instanceId"].as_str().into_iter().collect()
            } else {
                receipt["desktopIds"]
                    .as_array()
                    .map(|ids| ids.iter().filter_map(Value::as_str).collect())
                    .unwrap_or_default()
            };
            let released = !purchased_ids.is_empty()
                && purchased_ids.iter().all(|instance| {
                    receipts.iter().any(|(_, release)| {
                        release["request"]["action"] == "release"
                            && release["outcome"] == "released"
                            && release["request"]["resource"]["provider"] == provider
                            && release["request"]["resource"]["regionId"] == region
                            && release["request"]["resource"]["resourceId"] == *instance
                    })
                });
            if request["action"] == action
                && request["spec"]["regionId"] == region
                && (request["quoteId"] == quote_id
                    || (request["desktopName"] == name
                        && receipt["outcome"] != "provisioned"
                        && !released))
            {
                return Err(format!("A purchase already exists for this name or quote; inspect operation {id} before purchasing again"));
            }
        }
        Ok(())
    }
}
