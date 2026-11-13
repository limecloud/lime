//! 固定端口、精确规则与不携带认证信息的公网地址发现。

use super::*;
use std::net::Ipv4Addr;

pub(super) fn validate_cidr(cidr: &str) -> Result<(), String> {
    let address: Ipv4Addr = cidr
        .strip_suffix("/32")
        .ok_or("Connection source must be one IPv4 address")?
        .parse()
        .map_err(|_| "Invalid connection source IPv4")?;
    let [a, b, c, _] = address.octets();
    if address.is_private()
        || address.is_loopback()
        || address.is_link_local()
        || address.is_broadcast()
        || address.is_documentation()
        || address.is_multicast()
        || a == 0
        || a >= 240
        || (a == 100 && (64..=127).contains(&b))
        || (a == 198 && (b == 18 || b == 19))
        || (a == 192 && b == 0 && c == 0)
        || cidr != format!("{address}/32")
    {
        return Err("Connection source must be a public IPv4 address".into());
    }
    Ok(())
}

pub(super) async fn public_ipv4() -> Result<String, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|_| "Cannot prepare public address discovery")?;
    discover_public_ipv4(
        &client,
        &[
            "https://api.ipify.org",
            "https://checkip.amazonaws.com",
            "https://ipv4.icanhazip.com",
        ],
    )
    .await
}

async fn discover_public_ipv4(
    client: &reqwest::Client,
    endpoints: &[&str],
) -> Result<String, String> {
    let mut known = None;
    // One unavailable source cannot authorize an address. Two fixed HTTPS sources
    // must still agree, and malformed or conflicting answers remain fatal.
    for endpoint in endpoints {
        let Some(cidr) = read_public_ipv4(client, endpoint).await? else {
            continue;
        };
        if known.as_ref().is_some_and(|old| old != &cidr) {
            return Err(
                "Public address discovery disagreed; no connection rules were submitted".into(),
            );
        }
        if known.is_some() {
            return Ok(cidr);
        }
        known = Some(cidr);
    }
    Err("Cannot verify current public IPv4 address".into())
}

async fn read_public_ipv4(
    client: &reqwest::Client,
    endpoint: &str,
) -> Result<Option<String>, String> {
    // These public requests contain no cloud credentials, tokens or custom headers.
    let Ok(mut response) = client.get(endpoint).send().await else {
        return Ok(None);
    };
    if !response.status().is_success() {
        return Ok(None);
    }
    if response.content_length().is_some_and(|n| n > 64) {
        return Err("Invalid public address discovery response".into());
    }
    let mut body = Vec::new();
    loop {
        let chunk = match response.chunk().await {
            Ok(Some(chunk)) => chunk,
            Ok(None) => break,
            Err(_) => return Ok(None),
        };
        if body.len() + chunk.len() > 64 {
            return Err("Invalid public address discovery response".into());
        }
        body.extend_from_slice(&chunk);
    }
    let text = std::str::from_utf8(&body)
        .map_err(|_| "Invalid public address discovery response")?
        .trim();
    let cidr = format!("{text}/32");
    validate_cidr(&cidr)?;
    Ok(Some(cidr))
}

pub(super) fn description(operation: &str, port: &str) -> String {
    format!(
        "Lime-connection-{}-{port}",
        token(operation, "rule").get(..24).unwrap()
    )
}

pub(super) fn ingress(group: &Value) -> Result<Vec<&Value>, String> {
    if group
        .get("NextToken")
        .is_some_and(|value| !value.is_null() && value != "")
    {
        return Err("Incomplete connection security group inventory".into());
    }
    let rules = group
        .pointer("/Permissions/Permission")
        .and_then(Value::as_array)
        .ok_or("Missing connection security group permissions")?;
    if rules
        .iter()
        .any(|rule| !matches!(rule["Direction"].as_str(), Some("ingress" | "egress")))
    {
        return Err("Invalid connection security group direction".into());
    }
    let ingress: Vec<_> = rules
        .iter()
        .filter(|rule| rule["Direction"] == "ingress")
        .collect();
    if ingress.len() > 4 {
        return Err("Unexpected connection security group rule count".into());
    }
    Ok(ingress)
}

fn matches_rule(rule: &Value, cidr: &str, port: &str, label: &str) -> bool {
    rule["Direction"] == "ingress"
        && rule["IpProtocol"]
            .as_str()
            .is_some_and(|v| v.eq_ignore_ascii_case("tcp"))
        && rule["PortRange"] == format!("{port}/{port}")
        && rule["SourceCidrIp"] == cidr
        && rule["Description"] == label
        && rule["Policy"]
            .as_str()
            .is_some_and(|v| v.eq_ignore_ascii_case("accept"))
        && (rule["Priority"].as_u64() == Some(1) || rule["Priority"].as_str() == Some("1"))
        && rule["NicType"] == "intranet"
        && [
            "Ipv6SourceCidrIp",
            "SourceGroupId",
            "SourceGroupOwnerId",
            "SourceGroupOwnerAccount",
            "SourcePrefixListId",
            "PortRangeListId",
            "DestCidrIp",
            "Ipv6DestCidrIp",
            "DestGroupId",
            "DestGroupOwnerAccount",
            "DestPrefixListId",
        ]
        .iter()
        .all(|field| rule.get(*field).is_none_or(|v| v.is_null() || v == ""))
        && rule
            .get("SourcePortRange")
            .is_none_or(|v| v.is_null() || v == "" || v == "-1/-1")
        && rule["SecurityGroupRuleId"]
            .as_str()
            .is_some_and(|id| id.starts_with("sgr-") && validate_id(id).is_ok())
}

pub(super) fn matches_expected(rule: &Value, receipt: &Value, port: &str) -> bool {
    let operation = receipt["operationId"].as_str().unwrap_or("");
    let cidr = receipt["request"]["sourceCidr"].as_str().unwrap_or("");
    matches_rule(rule, cidr, port, &description(operation, port))
        && receipt["rules"].as_array().is_some_and(|registered| {
            registered.is_empty()
                || registered
                    .iter()
                    .any(|old| old["port"] == port && old["id"] == rule["SecurityGroupRuleId"])
        })
}

pub(super) fn matches_registered(rule: &Value, registered: &Value) -> bool {
    matches_rule(
        rule,
        registered["sourceCidr"].as_str().unwrap_or(""),
        registered["port"].as_str().unwrap_or(""),
        registered["description"].as_str().unwrap_or(""),
    ) && rule["SecurityGroupRuleId"] == registered["id"]
}

pub(super) fn registered_rule(rule: &Value, port: &str) -> Value {
    json!({"id":rule["SecurityGroupRuleId"],"sourceCidr":rule["SourceCidrIp"],"port":port,"description":rule["Description"]})
}

pub(super) fn validate_registered_rule(rule: &Value) -> Result<(), String> {
    let id = rule["id"]
        .as_str()
        .ok_or("Missing registered connection rule ID")?;
    validate_id(id)?;
    validate_cidr(
        rule["sourceCidr"]
            .as_str()
            .ok_or("Missing registered connection source")?,
    )?;
    let description = rule["description"]
        .as_str()
        .ok_or("Missing registered connection label")?;
    if !id.starts_with("sgr-")
        || !matches!(rule["port"].as_str(), Some("8787" | "6080"))
        || description.len() > 64
        || !description.starts_with("Lime-connection-")
        || !description
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return Err("Invalid registered connection rule".into());
    }
    Ok(())
}

#[cfg(test)]
#[path = "rules/tests.rs"]
mod tests;
