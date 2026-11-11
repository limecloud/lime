//! 复用阿里云启动模板，仅提取当前桌面购买合同支持的字段。

use super::*;
use std::collections::HashSet;

fn page<'a>(response: &'a Value, path: &str) -> Result<(&'a Vec<Value>, usize), String> {
    let items = response
        .pointer(path)
        .and_then(Value::as_array)
        .ok_or("Invalid ECS launch template response")?;
    let total = response["TotalCount"]
        .as_u64()
        .filter(|total| *total <= 1000)
        .ok_or("ECS launch template inventory exceeds the supported limit")?
        as usize;
    if total < items.len()
        || response
            .get("NextToken")
            .is_some_and(|v| !v.is_null() && v != "")
    {
        return Err("ECS launch template inventory is incomplete".into());
    }
    Ok((items, total))
}

fn template_id(id: &str) -> Result<(), String> {
    validate_id(id)?;
    if !id.starts_with("lt-") {
        return Err("Invalid ECS launch template ID".into());
    }
    Ok(())
}

fn field(data: &Value, name: &str) -> Result<String, String> {
    data[name]
        .as_str()
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| format!("Launch template must specify {name}"))
}

fn number(data: &Value, name: &str, default: u32) -> Result<u32, String> {
    match data.get(name) {
        None | Some(Value::Null) => Ok(default),
        Some(value) => value
            .as_u64()
            .and_then(|v| u32::try_from(v).ok())
            .ok_or_else(|| format!("Invalid launch template field {name}")),
    }
}

fn spec_from_template(data: &Value, region: &str, profile: &str) -> Result<EcsDesktopSpec, String> {
    // Never execute template UserData or silently add disks, network interfaces,
    // roles or spot/subscription commitments outside the approved purchase contract.
    for name in [
        "UserData",
        "RamRoleName",
        "DeploymentSetId",
        "PrivateIpAddress",
        "SystemDisk.KMSKeyId",
    ] {
        if data.get(name).is_some_and(|v| !v.is_null() && v != "") {
            return Err(format!(
                "Launch template uses unsupported field {name}; choose a Linux desktop template"
            ));
        }
    }
    for (path, name, entry) in [
        ("/DataDisks/DataDisk", "DataDisks", "DataDisk"),
        (
            "/NetworkInterfaces/NetworkInterface",
            "NetworkInterfaces",
            "NetworkInterface",
        ),
    ] {
        if data
            .pointer(path)
            .is_some_and(|v| v.as_array().is_none_or(|items| !items.is_empty()))
        {
            return Err(format!("Launch template contains unsupported {name}"));
        }
        if data.get(name).is_some_and(|v| {
            !v.is_null()
                && v.as_object()
                    .is_none_or(|value| value.keys().any(|key| key != entry))
        }) {
            return Err(format!("Invalid launch template {name}"));
        }
    }
    for (name, allowed) in [
        ("InstanceChargeType", "PostPaid"),
        ("InternetChargeType", "PayByTraffic"),
        ("NetworkType", "vpc"),
        ("SpotStrategy", "NoSpot"),
        ("SystemDisk.Category", "cloud_essd"),
        ("SystemDisk.PerformanceLevel", "PL1"),
    ] {
        if data
            .get(name)
            .is_some_and(|v| !v.is_null() && v != "" && v != allowed)
        {
            return Err(format!(
                "Launch template requires {name}={allowed} for this desktop purchase"
            ));
        }
    }
    for name in ["AutoRenew", "PasswordInherit"] {
        if data.get(name).is_some_and(|v| !v.is_null() && v != false) {
            return Err(format!("Launch template cannot enable {name}"));
        }
    }
    let groups = data
        .pointer("/SecurityGroupIds/SecurityGroupId")
        .and_then(Value::as_array);
    let security_group_id = match (
        data["SecurityGroupId"].as_str().filter(|v| !v.is_empty()),
        groups,
    ) {
        (Some(id), None) => id.to_owned(),
        (legacy, Some(ids)) if ids.len() == 1 => {
            let id = ids[0]
                .as_str()
                .ok_or("Invalid launch template security group")?;
            if legacy.is_some_and(|legacy| legacy != id) {
                return Err("Conflicting launch template security groups".into());
            }
            id.to_owned()
        }
        _ => return Err("Launch template must specify exactly one security group".into()),
    };
    let spec = EcsDesktopSpec {
        region_id: region.into(),
        profile: profile.into(),
        v_switch_id: field(data, "VSwitchId")?,
        security_group_id,
        key_pair_name: field(data, "KeyPairName")?,
        instance_type: field(data, "InstanceType")?,
        image_id: field(data, "ImageId")?,
        system_disk_gib: number(data, "SystemDisk.Size", 80)?,
        outbound_mbps: number(data, "InternetMaxBandwidthOut", 5)?,
    };
    validate_spec(&spec)?;
    Ok(spec)
}

impl CloudDesktopService {
    pub(in crate::cloud_desktop_service) async fn list_ecs_templates(
        &self,
        region: &str,
        profile: &str,
    ) -> Result<Value, String> {
        validate_id(region)?;
        validate_id(profile)?;
        let mut templates = Vec::new();
        let mut seen = HashSet::new();
        let mut expected = None;
        for number in 1..=10 {
            let response = self
                .call_cli(
                    "ecs",
                    None,
                    region,
                    profile,
                    &[
                        "DescribeLaunchTemplates".into(),
                        "--PageNumber".into(),
                        number.to_string(),
                        "--PageSize".into(),
                        "100".into(),
                    ],
                )
                .await?;
            let (items, total) = page(&response, "/LaunchTemplateSets/LaunchTemplateSet")?;
            if expected.is_some_and(|expected| expected != total)
                || response["PageNumber"].as_u64() != Some(number)
            {
                return Err("ECS launch template inventory changed; refresh the list".into());
            }
            expected = Some(total);
            for item in items {
                let id = field(item, "LaunchTemplateId")?;
                template_id(&id)?;
                if !seen.insert(id.clone()) {
                    return Err("Duplicate ECS launch template".into());
                }
                let name = field(item, "LaunchTemplateName")?;
                if name.len() > 256 {
                    return Err("Invalid launch template name".into());
                }
                let version = item["DefaultVersionNumber"]
                    .as_u64()
                    .filter(|v| (1..=u32::MAX as u64).contains(v))
                    .ok_or("Invalid launch template default version")?;
                templates.push(json!({"id":id,"name":name,"version":version}));
            }
            if templates.len() == total {
                return Ok(json!({"templates":templates}));
            }
            if items.is_empty() || templates.len() > total {
                break;
            }
        }
        Err("ECS launch template inventory is incomplete; refresh the list".into())
    }

    pub(in crate::cloud_desktop_service) async fn quote_ecs_template(
        &self,
        region: &str,
        profile: &str,
        id: &str,
        version: u32,
    ) -> Result<Value, String> {
        validate_id(region)?;
        validate_id(profile)?;
        template_id(id)?;
        if version == 0 {
            return Err("An exact launch template version is required".into());
        }
        let response = self
            .call_cli(
                "ecs",
                None,
                region,
                profile,
                &[
                    "DescribeLaunchTemplateVersions".into(),
                    "--LaunchTemplateId".into(),
                    id.into(),
                    "--LaunchTemplateVersion.1".into(),
                    version.to_string(),
                    "--DetailFlag".into(),
                    "true".into(),
                ],
            )
            .await?;
        let (items, total) = page(
            &response,
            "/LaunchTemplateVersionSets/LaunchTemplateVersionSet",
        )?;
        if total != 1
            || items.len() != 1
            || items[0]["LaunchTemplateId"] != id
            || items[0]["VersionNumber"].as_u64() != Some(u64::from(version))
        {
            return Err("Launch template version does not match the selected template".into());
        }
        let item = &items[0];
        let spec = spec_from_template(&item["LaunchTemplateData"], region, profile)?;
        let mut quote = self.quote_ecs(spec.clone()).await?;
        quote["spec"] = serde_json::to_value(spec).map_err(|_| "Invalid template specification")?;
        quote["template"] =
            json!({"id":id,"version":version,"name":field(item,"LaunchTemplateName")?});
        Ok(quote)
    }
}
