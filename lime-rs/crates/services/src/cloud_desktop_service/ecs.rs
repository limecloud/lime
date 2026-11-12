//! 普通 Linux VM 的显式核价与现有网络校验；不接管用户的网络或 SSH 私钥。

use super::*;
use app_server_protocol::protocol::v2::EcsDesktopSpec;

mod network;
mod purchase;
mod recommendation;
mod templates;

fn validate_spec(spec: &EcsDesktopSpec) -> Result<(), String> {
    for value in [
        &spec.region_id,
        &spec.profile,
        &spec.v_switch_id,
        &spec.security_group_id,
    ] {
        validate_id(value)?;
    }
    if !spec.key_pair_name.is_empty() {
        validate_id(&spec.key_pair_name)?;
    }
    for value in [&spec.instance_type, &spec.image_id] {
        if value.is_empty()
            || value.len() > 128
            || !value.as_bytes()[0].is_ascii_alphanumeric()
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
        {
            return Err("Invalid ECS image or instance type".into());
        }
    }
    if !spec.instance_type.starts_with("ecs.")
        || !spec.v_switch_id.starts_with("vsw-")
        || !spec.security_group_id.starts_with("sg-")
        || !(60..=500).contains(&spec.system_disk_gib)
        || !(1..=100).contains(&spec.outbound_mbps)
    {
        return Err("Invalid ECS network, disk size or bandwidth".into());
    }
    Ok(())
}

fn exact_item<'a>(
    response: &'a Value,
    path: &str,
    key: &str,
    id: &str,
) -> Result<&'a Value, String> {
    let items = response
        .pointer(path)
        .and_then(Value::as_array)
        .ok_or("Invalid ECS inventory response")?;
    if items.len() != 1
        || items[0][key] != id
        || response
            .get("TotalCount")
            .is_some_and(|count| count.as_u64() != Some(1))
        || response
            .get("NextToken")
            .is_some_and(|token| !token.is_null() && token != "")
    {
        return Err("ECS inventory does not match the exact selected resource".into());
    }
    Ok(&items[0])
}

impl CloudDesktopService {
    async fn ecs(&self, spec: &EcsDesktopSpec, args: &[String]) -> Result<Value, String> {
        self.call_api(
            CloudDesktopProvider::Ecs,
            &spec.region_id,
            &spec.profile,
            args,
        )
        .await
    }

    async fn validate_ecs_inventory(&self, spec: &EcsDesktopSpec) -> Result<Value, String> {
        let switch = self
            .call_cli(
                "vpc",
                None,
                &spec.region_id,
                &spec.profile,
                &[
                    "DescribeVSwitchAttributes".into(),
                    "--VSwitchId".into(),
                    spec.v_switch_id.clone(),
                ],
            )
            .await?;
        if switch["VSwitchId"] != spec.v_switch_id
            || switch["Status"] != "Available"
            || switch["AvailableIpAddressCount"]
                .as_u64()
                .is_none_or(|count| count == 0)
        {
            return Err("Selected ECS switch is unavailable or has no free addresses".into());
        }
        let zone = switch["ZoneId"].as_str().ok_or("Missing switch zone")?;
        let vpc = switch["VpcId"].as_str().ok_or("Missing switch VPC")?;
        validate_id(zone)?;
        validate_id(vpc)?;
        let group = self
            .ecs(
                spec,
                &[
                    "DescribeSecurityGroupAttribute".into(),
                    "--SecurityGroupId".into(),
                    spec.security_group_id.clone(),
                ],
            )
            .await?;
        if group["SecurityGroupId"] != spec.security_group_id
            || group["VpcId"] != vpc
            || group["RegionId"] != spec.region_id
        {
            return Err(
                "ECS security group and switch must belong to the same region and VPC".into(),
            );
        }
        let images = self
            .ecs(
                spec,
                &[
                    "DescribeImages".into(),
                    "--ImageId".into(),
                    spec.image_id.clone(),
                ],
            )
            .await?;
        let image = exact_item(&images, "/Images/Image", "ImageId", &spec.image_id)?;
        if image["Status"] != "Available"
            || image["OSType"] != "linux"
            || image["Architecture"] != "x86_64"
            || image["Platform"] != "Ubuntu"
            || !matches!(image["ImageOwnerAlias"].as_str(), Some("system" | "self"))
            || image["Usable"] == false
            || image["Size"]
                .as_u64()
                .is_none_or(|size| size > u64::from(spec.system_disk_gib))
        {
            return Err("ECS desktop requires an available x86_64 Ubuntu system or owned image that fits the system disk".into());
        }
        let types = self
            .ecs(
                spec,
                &[
                    "DescribeInstanceTypes".into(),
                    "--InstanceTypes.1".into(),
                    spec.instance_type.clone(),
                ],
            )
            .await?;
        let kind = exact_item(
            &types,
            "/InstanceTypes/InstanceType",
            "InstanceTypeId",
            &spec.instance_type,
        )?;
        if kind["CpuArchitecture"] != "X86"
            || kind["GPUAmount"].as_u64() != Some(0)
            || kind["CpuCoreCount"].as_u64().is_none_or(|cores| cores < 2)
            || kind["MemorySize"].as_f64().is_none_or(|gib| gib < 4.0)
        {
            return Err("ECS desktop requires x86 without GPU and at least 2 cores/4 GiB".into());
        }
        if !spec.key_pair_name.is_empty() {
            let keys = self
                .ecs(
                    spec,
                    &[
                        "DescribeKeyPairs".into(),
                        "--KeyPairName".into(),
                        spec.key_pair_name.clone(),
                    ],
                )
                .await?;
            exact_item(
                &keys,
                "/KeyPairs/KeyPair",
                "KeyPairName",
                &spec.key_pair_name,
            )?;
        }
        // Do not project the keypair public key, network permissions or image metadata.
        Ok(json!({ "zoneId": zone, "vpcId": vpc }))
    }

    async fn ecs_price(&self, spec: &EcsDesktopSpec, zone: &str) -> Result<Value, String> {
        let response = self
            .ecs(
                spec,
                &[
                    "DescribePrice".into(),
                    "--ResourceType".into(),
                    "instance".into(),
                    "--InstanceType".into(),
                    spec.instance_type.clone(),
                    "--ImageId".into(),
                    spec.image_id.clone(),
                    "--ZoneId".into(),
                    zone.into(),
                    "--InstanceNetworkType".into(),
                    "vpc".into(),
                    "--IoOptimized".into(),
                    "optimized".into(),
                    "--PriceUnit".into(),
                    "Hour".into(),
                    "--Amount".into(),
                    "1".into(),
                    "--SystemDisk.Category".into(),
                    "cloud_essd".into(),
                    "--SystemDisk.PerformanceLevel".into(),
                    "PL1".into(),
                    "--SystemDisk.Size".into(),
                    spec.system_disk_gib.to_string(),
                    "--InternetChargeType".into(),
                    "PayByTraffic".into(),
                    "--InternetMaxBandwidthOut".into(),
                    spec.outbound_mbps.to_string(),
                ],
            )
            .await?;
        let price = response
            .pointer("/PriceInfo/Price/TradePrice")
            .and_then(Value::as_f64)
            .filter(|value| value.is_finite() && *value > 0.0)
            .ok_or("ECS did not return a valid hourly price")?;
        let currency = response
            .pointer("/PriceInfo/Price/Currency")
            .and_then(Value::as_str)
            .filter(|currency| matches!(*currency, "CNY" | "USD"))
            .ok_or("Unsupported ECS quote currency")?;
        Ok(
            json!({ "hourlyPrice": price, "currency": currency, "systemDiskEncrypted": true,
            "retainedStorageChargedSeparately": true, "networkOrSnapshotNotIncluded": true,
            "keyManagementMayBeChargedSeparately": true }),
        )
    }

    pub(super) async fn quote_ecs(&self, spec: EcsDesktopSpec) -> Result<Value, String> {
        validate_spec(&spec)?;
        let network = self.validate_ecs_inventory(&spec).await?;
        let price = self
            .ecs_price(
                &spec,
                network["zoneId"].as_str().ok_or("Missing switch zone")?,
            )
            .await?;
        self.store_quote(
            serde_json::to_value(spec).map_err(|_| "Invalid ECS quote spec")?,
            price,
        )
    }
}
