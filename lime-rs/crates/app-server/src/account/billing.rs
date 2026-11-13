use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const MAX_CREDITS: u64 = 9_000_000_000_000_000;

pub(super) struct Budget {
    pub version: String,
    pub maximum: u64,
}

impl Budget {
    pub fn parse(input: &Value, version: &str, maximum: &str) -> Result<Option<Self>, String> {
        match (input.get(version), input.get(maximum)) {
            (None, None) => Ok(None),
            (Some(version), Some(maximum)) => {
                let version = version.as_str().filter(|s| valid_version(s));
                let maximum = maximum.as_str().and_then(amount);
                match (version, maximum) {
                    (Some(version), Some(maximum)) => Ok(Some(Self {
                        version: version.into(),
                        maximum,
                    })),
                    _ => Err("cloud_tool_input_invalid".into()),
                }
            }
            _ => Err("cloud_tool_input_invalid".into()),
        }
    }
}

fn valid_version(value: &str) -> bool {
    (1..=80).contains(&value.len())
        && value.as_bytes()[0].is_ascii_alphanumeric()
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'-'))
}

fn amount(value: &str) -> Option<u64> {
    if value.is_empty()
        || value.len() > 16
        || value.len() > 1 && value.starts_with('0')
        || !value.bytes().all(|c| c.is_ascii_digit())
    {
        return None;
    }
    value.parse().ok().filter(|n| *n <= MAX_CREDITS)
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Price {
    price_version: String,
    credits_per_operation: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Quote {
    kind: String,
    billing_status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    price: Option<Price>,
}

/// A quote never supplies acceptance or a budget on the caller's behalf.
pub(super) fn acceptance(path: &str, input: &Value, body: Value) -> Result<Option<Value>, String> {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Prices {
        items: Vec<Quote>,
    }
    let invalid = || "cloud_response_invalid".to_owned();
    let prices: Prices = serde_json::from_value(body).map_err(|_| invalid())?;
    if !(1..=2).contains(&prices.items.len()) {
        return Err(invalid());
    }
    let kind = if path == "/web/searches" {
        "search"
    } else {
        "page"
    };
    let mut seen = std::collections::HashSet::new();
    for quote in &prices.items {
        if !matches!(quote.kind.as_str(), "search" | "page") || !seen.insert(&quote.kind) {
            return Err(invalid());
        }
        match (quote.billing_status.as_str(), quote.price.as_ref()) {
            ("unpriced", None) => {}
            ("priced", Some(price))
                if valid_version(&price.price_version)
                    && amount(&price.credits_per_operation).is_some_and(|n| n > 0) => {}
            _ => return Err(invalid()),
        }
    }
    let quote = prices
        .items
        .iter()
        .find(|q| q.kind == kind)
        .ok_or_else(invalid)?;
    accept_quote(
        quote.price.as_ref(),
        input,
        serde_json::to_value(quote).map_err(|_| invalid())?,
    )
}

pub(super) fn file_acceptance(input: &Value, body: Value) -> Result<Option<Value>, String> {
    #[derive(Deserialize, Serialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct FileQuote {
        action: String,
        billing_status: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        price: Option<Price>,
    }
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Prices {
        items: Vec<FileQuote>,
    }
    let invalid = || "connection_response_invalid".to_owned();
    let prices: Prices = serde_json::from_value(body).map_err(|_| invalid())?;
    if prices.items.len() != 1 {
        return Err(invalid());
    }
    let quote = &prices.items[0];
    if quote.action != "drive.files.read" {
        return Err(invalid());
    }
    match (quote.billing_status.as_str(), quote.price.as_ref()) {
        ("unpriced", None) => {}
        ("priced", Some(price))
            if valid_version(&price.price_version)
                && amount(&price.credits_per_operation).is_some_and(|n| n > 0) => {}
        _ => return Err(invalid()),
    }
    accept_quote(
        quote.price.as_ref(),
        input,
        serde_json::to_value(quote).map_err(|_| invalid())?,
    )
}

fn accept_quote(
    price: Option<&Price>,
    input: &Value,
    quote: Value,
) -> Result<Option<Value>, String> {
    let budget = Budget::parse(input, "priceVersion", "maxCredits")?;
    let code = match (price, budget) {
        (None, None) => return Ok(None),
        (None, Some(_)) => "INTEGRATION_PRICE_CHANGED",
        (Some(_), None) => "INTEGRATION_PRICE_ACCEPTANCE_REQUIRED",
        (Some(price), Some(budget)) if price.price_version != budget.version => {
            "INTEGRATION_PRICE_CHANGED"
        }
        (Some(price), Some(budget))
            if amount(&price.credits_per_operation).unwrap() > budget.maximum =>
        {
            "INTEGRATION_BUDGET_EXCEEDED"
        }
        _ => return Ok(None),
    };
    Ok(Some(json!({
        "status": if code == "INTEGRATION_PRICE_ACCEPTANCE_REQUIRED" { "price_acceptance_required" } else { "failed" },
        "errorCode": code, "executionStarted": false, "quote": quote
    })))
}

pub(super) fn budget_error(code: &str) -> bool {
    matches!(
        code,
        "INTEGRATION_PRICE_ACCEPTANCE_REQUIRED"
            | "INTEGRATION_PRICE_CHANGED"
            | "INTEGRATION_BUDGET_EXCEEDED"
            | "INTEGRATION_CREDITS_INSUFFICIENT"
            | "INTEGRATION_CREDITS_POLICY_UNVERIFIED"
    )
}

/// Only an explicit pre-execution rejection on a fixed billable route is terminal.
pub(super) fn rejection<'a>(path: &str, status: u16, body: &'a Value) -> Option<&'a str> {
    let parts: Vec<_> = path.split('/').collect();
    let file_read = matches!(parts.as_slice(), ["", "connections", id, "file-reads"] if super::cloud::identifier(id));
    if status != 409
        || !(matches!(path, "/web/searches" | "/web/pages") || file_read)
        || body.as_object()?.len() != 1
    {
        return None;
    }
    body["error"].as_str().filter(|code| budget_error(code))
}

pub(super) fn validate_usage(usage: &Value, status: &str, input: &Value) -> Result<(), String> {
    let invalid = || "cloud_response_invalid".to_owned();
    let object = usage.as_object().ok_or_else(invalid)?;
    if usage["requests"].as_u64().is_none() || usage["responseBytes"].as_u64().is_none() {
        return Err(invalid());
    }
    let budget = Budget::parse(input, "priceVersion", "maxCredits").map_err(|_| invalid())?;
    if usage["billingStatus"] == "unpriced" {
        return if object.len() == 3 && budget.is_none() {
            Ok(())
        } else {
            Err(invalid())
        };
    }
    let budget = budget.ok_or_else(invalid)?;
    let bill = usage["billing"].as_object().ok_or_else(invalid)?;
    let unit = bill
        .get("creditsPerUnit")
        .and_then(Value::as_str)
        .and_then(amount);
    if object.len() != 4
        || bill.len() != 6
        || usage["billing"]["unit"] != "credit"
        || usage["billing"]["priceVersion"] != budget.version
        || unit.is_none_or(|n| n == 0 || n > budget.maximum)
        || usage["billing"]["reservedCredits"] != usage["billing"]["creditsPerUnit"]
    {
        return Err(invalid());
    }
    let settled = usage["billing"]["quantity"] == "1"
        && usage["billing"]["chargedCredits"] == usage["billing"]["reservedCredits"];
    let unused = usage["billing"]["quantity"] == "0" && usage["billing"]["chargedCredits"] == "0";
    let valid = match usage["billingStatus"].as_str() {
        Some("settled") => settled && status != "failed",
        Some("released") => unused && !matches!(status, "completed" | "result_expired"),
        Some("reserved") => unused && matches!(status, "running" | "outcome_unknown"),
        _ => false,
    };
    if valid {
        Ok(())
    } else {
        Err(invalid())
    }
}

pub(super) fn tool_definition(
    mut definition: tool_runtime::tool_definition::RuntimeToolDefinition,
) -> tool_runtime::tool_definition::RuntimeToolDefinition {
    let schema = &mut definition.input_schema;
    schema["properties"]["price_version"] =
        json!({"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$"});
    schema["properties"]["max_credits"] =
        json!({"type":"string","pattern":"^(0|[1-9][0-9]{0,15})$"});
    schema["dependentRequired"] =
        json!({"price_version":["max_credits"],"max_credits":["price_version"]});
    definition
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn original_usage_preserves_early_settlement_and_rejects_changed_prices_or_amounts() {
        let input = json!({"priceVersion":"v1","maxCredits":"7"});
        for (state, quantity, charged, statuses) in [
            (
                "settled",
                "1",
                "7",
                vec!["completed", "running", "outcome_unknown"],
            ),
            ("reserved", "0", "0", vec!["running", "outcome_unknown"]),
            (
                "released",
                "0",
                "0",
                vec!["failed", "running", "outcome_unknown"],
            ),
        ] {
            let usage = json!({"requests":1,"responseBytes":32,"billingStatus":state,"billing":{
                "priceVersion":"v1","unit":"credit","creditsPerUnit":"7","reservedCredits":"7","chargedCredits":charged,"quantity":quantity
            }});
            for status in statuses {
                assert!(validate_usage(&usage, status, &input).is_ok());
                for (field, changed) in [
                    ("priceVersion", json!("v2")),
                    ("creditsPerUnit", json!(7)),
                    ("reservedCredits", json!("8")),
                    ("chargedCredits", json!("6")),
                    ("quantity", json!("2")),
                ] {
                    let mut changed_usage = usage.clone();
                    changed_usage["billing"][field] = changed;
                    assert!(validate_usage(&changed_usage, status, &input).is_err());
                }
                assert!(validate_usage(&usage, status, &json!({})).is_err());
                assert!(validate_usage(
                    &usage,
                    status,
                    &json!({"priceVersion":"v1","maxCredits":"6"})
                )
                .is_err());
            }
        }
        let unpriced = json!({"requests":1,"responseBytes":32,"billingStatus":"unpriced"});
        assert!(validate_usage(&unpriced, "completed", &json!({})).is_ok());
        assert!(validate_usage(&unpriced, "completed", &input).is_err());
    }
}
