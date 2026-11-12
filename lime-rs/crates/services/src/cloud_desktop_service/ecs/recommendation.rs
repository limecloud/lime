//! 仅查询供应商推荐、库存与价格；不创建资源，不声称全地域最低价。

use super::*;
use std::collections::BTreeSet;

impl CloudDesktopService {
    pub(super) async fn recommend_ecs_purchase(
        &self,
        region: &str,
        profile: &str,
    ) -> Result<Value, String> {
        let mut spec = EcsDesktopSpec {
            region_id: region.into(),
            profile: profile.into(),
            v_switch_id: String::new(),
            security_group_id: String::new(),
            key_pair_name: String::new(),
            instance_type: String::new(),
            image_id: String::new(),
            system_disk_gib: 80,
            outbound_mbps: 5,
        };
        let images = self
            .ecs(
                &spec,
                &[
                    "DescribeImages".into(),
                    "--ImageOwnerAlias".into(),
                    "system".into(),
                    "--OSType".into(),
                    "linux".into(),
                    "--Architecture".into(),
                    "x86_64".into(),
                    "--ImageName".into(),
                    "ubuntu_24_04*".into(),
                    "--Status".into(),
                    "Available".into(),
                    "--PageSize".into(),
                    "100".into(),
                    "--PageNumber".into(),
                    "1".into(),
                ],
            )
            .await?;
        let items = images
            .pointer("/Images/Image")
            .and_then(Value::as_array)
            .ok_or("Invalid recommended image inventory")?;
        if images["TotalCount"].as_u64() != Some(items.len() as u64) {
            return Err("Recommended image inventory is incomplete".into());
        }
        let image = items
            .iter()
            .filter(|item| {
                item["Platform"] == "Ubuntu"
                    && item["Architecture"] == "x86_64"
                    && item["ImageOwnerAlias"] == "system"
                    && item["Status"] == "Available"
                    && item["OSType"] == "linux"
                    && item["Usable"] != false
                    && item["Size"].as_u64().is_some_and(|size| size <= 80)
                    && item["ImageName"]
                        .as_str()
                        .is_some_and(|name| name.starts_with("ubuntu_24_04"))
            })
            .max_by_key(|item| item["CreationTime"].as_str().unwrap_or_default())
            .ok_or("No available Ubuntu 24.04 system image for this region")?;
        spec.image_id = image["ImageId"]
            .as_str()
            .ok_or("Missing recommended image ID")?
            .into();
        let recommended = self
            .ecs(
                &spec,
                &[
                    "DescribeRecommendInstanceType".into(),
                    "--NetworkType".into(),
                    "vpc".into(),
                    "--InstanceChargeType".into(),
                    "PostPaid".into(),
                    "--SpotStrategy".into(),
                    "NoSpot".into(),
                    "--IoOptimized".into(),
                    "optimized".into(),
                    "--SystemDiskCategory".into(),
                    "cloud_essd".into(),
                    "--Cores".into(),
                    "2".into(),
                    "--Memory".into(),
                    "4".into(),
                    "--Scene".into(),
                    "CREATE".into(),
                ],
            )
            .await?;
        let rows = recommended
            .pointer("/Data/RecommendInstanceType")
            .and_then(Value::as_array)
            .filter(|items| items.len() <= 256)
            .ok_or("Invalid recommended instance inventory")?;
        let mut options = Vec::new();
        let mut seen = BTreeSet::new();
        for item in rows {
            if item["RegionId"] != region
                || item["NetworkType"] != "vpc"
                || item["InstanceChargeType"] != "PostPaid"
                || item["SpotStrategy"] != "NoSpot"
            {
                continue;
            }
            let Some(kind) = item
                .pointer("/InstanceType/InstanceType")
                .and_then(Value::as_str)
            else {
                continue;
            };
            let Some(zone) = item["ZoneId"].as_str() else {
                continue;
            };
            validate_id(zone)?;
            // Reuse the canonical specification validator for provider identifiers.
            let candidate = EcsDesktopSpec {
                instance_type: kind.into(),
                v_switch_id: "vsw-check".into(),
                security_group_id: "sg-check".into(),
                ..spec.clone()
            };
            validate_spec(&candidate)?;
            let pair = (kind.to_owned(), zone.to_owned());
            if seen.insert(pair.clone()) {
                options.push(pair);
            }
        }
        let mut args = vec!["DescribeInstanceTypes".into()];
        let types: BTreeSet<_> = options.iter().map(|(kind, _)| kind.clone()).collect();
        if types.is_empty() || types.len() > 100 {
            return Err("No suitable desktop instance is recommended in this region".into());
        }
        for (index, kind) in types.iter().enumerate() {
            args.extend([format!("--InstanceTypes.{}", index + 1), kind.clone()]);
        }
        let inventory = self.ecs(&spec, &args).await?;
        let kinds = inventory
            .pointer("/InstanceTypes/InstanceType")
            .and_then(Value::as_array)
            .ok_or("Invalid recommended instance specifications")?;
        let eligible: BTreeSet<_> = kinds
            .iter()
            .filter(|item| {
                item["CpuArchitecture"] == "X86"
                    && item["GPUAmount"].as_u64() == Some(0)
                    && item["CpuCoreCount"].as_u64() == Some(2)
                    && item["MemorySize"].as_f64() == Some(4.0)
                    && item["InstanceFamilyLevel"] != "CreditEntryLevel"
            })
            .filter_map(|item| item["InstanceTypeId"].as_str())
            .collect();
        let available = self
            .ecs(
                &spec,
                &[
                    "DescribeAvailableResource".into(),
                    "--DestinationResource".into(),
                    "InstanceType".into(),
                    "--InstanceChargeType".into(),
                    "PostPaid".into(),
                    "--SpotStrategy".into(),
                    "NoSpot".into(),
                    "--NetworkCategory".into(),
                    "vpc".into(),
                    "--SystemDiskCategory".into(),
                    "cloud_essd".into(),
                ],
            )
            .await?;
        let zones = available
            .pointer("/AvailableZones/AvailableZone")
            .and_then(Value::as_array)
            .ok_or("Invalid available desktop zones")?;
        let mut stocked = BTreeSet::new();
        for zone in zones {
            if zone["Status"] != "Available" {
                continue;
            }
            let Some(zone_id) = zone["ZoneId"].as_str() else {
                continue;
            };
            let Some(resources) = zone
                .pointer("/AvailableResources/AvailableResource")
                .and_then(Value::as_array)
            else {
                continue;
            };
            for resource in resources
                .iter()
                .filter(|item| item["Type"] == "InstanceType")
            {
                let Some(items) = resource
                    .pointer("/SupportedResources/SupportedResource")
                    .and_then(Value::as_array)
                else {
                    continue;
                };
                for item in items.iter().filter(|item| {
                    item["Status"] == "Available" && item["StatusCategory"] == "WithStock"
                }) {
                    if let Some(kind) = item["Value"].as_str() {
                        stocked.insert((kind.to_owned(), zone_id.to_owned()));
                    }
                }
            }
        }
        // Keep the managed OAuth config single-writer during possible token refresh.
        // A failed price is not silently treated as zero.
        let mut best: Option<(EcsDesktopSpec, String, Value)> = None;
        for (kind, zone) in options
            .into_iter()
            .filter(|(kind, zone)| {
                eligible.contains(kind.as_str()) && stocked.contains(&(kind.clone(), zone.clone()))
            })
            .take(8)
        {
            let mut candidate = spec.clone();
            candidate.instance_type = kind;
            let price = self.ecs_price(&candidate, &zone).await?;
            let candidate = (candidate, zone, price);
            if let Some(current) = &best {
                if current.2["currency"] != candidate.2["currency"] {
                    return Err("Recommended prices use different currencies".into());
                }
                let left = candidate.2["hourlyPrice"].as_f64().unwrap();
                let right = current.2["hourlyPrice"].as_f64().unwrap();
                if left > right
                    || (left == right
                        && (&candidate.0.instance_type, &candidate.1)
                            >= (&current.0.instance_type, &current.1))
                {
                    continue;
                }
            }
            best = Some(candidate);
        }
        let (spec, zone, price) =
            best.ok_or("No stocked x86 desktop with a valid price; try another region")?;
        Ok(json!({ "spec": spec, "zoneId": zone, "price": price }))
    }
}
