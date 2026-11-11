//! 无影企业版：当前 API metadata 使用 2020-09-30。购买固定为单台 Linux、
//! PostPaid、无 GPU、无自动续费；新购前校验实时报价并落持久 unknown 收据。
use super::*;
use app_server_protocol::protocol::v2::WuyingDesktopSpec;

fn validate_spec(spec: &WuyingDesktopSpec) -> Result<(), String> {
    for value in [
        &spec.region_id,
        &spec.profile,
        &spec.end_user_id,
        &spec.image_id,
        &spec.policy_group_id,
    ] {
        validate_id(value)?;
    }
    if !spec
        .office_site_id
        .starts_with(&format!("{}+dir-", spec.region_id))
        || spec.office_site_id.len() > 128
        || !spec
            .office_site_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"+-_".contains(&byte))
        || spec.desktop_type.len() > 128
        || !spec.desktop_type.starts_with("eds.")
        || !spec
            .desktop_type
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
        || !(60..=500).contains(&spec.system_disk_gib)
        || spec.system_disk_gib % 10 != 0
        || (spec.data_disk_gib != 0
            && (!(40..=2040).contains(&spec.data_disk_gib) || spec.data_disk_gib % 10 != 0))
    {
        return Err("Invalid Wuying office site, desktop type or disk sizes".into());
    }
    Ok(())
}

impl CloudDesktopService {
    async fn wuying(&self, spec: &WuyingDesktopSpec, args: &[String]) -> Result<Value, String> {
        self.call_api(
            CloudDesktopProvider::Wuying,
            &spec.region_id,
            &spec.profile,
            args,
        )
        .await
    }

    pub(super) async fn inspect_wuying(
        &self,
        resource: &CloudDesktopResource,
    ) -> Result<Value, String> {
        let response = self
            .call(
                resource,
                &[
                    "DescribeDesktops".into(),
                    "--DesktopId.1".into(),
                    resource.resource_id.clone(),
                ],
            )
            .await?;
        let desktops = response["Desktops"]
            .as_array()
            .ok_or("Invalid Wuying desktop response")?;
        if desktops.is_empty() {
            if response
                .get("TotalCount")
                .is_some_and(|count| count.as_u64() != Some(0))
            {
                return Err("Wuying desktop response has inconsistent inventory counts".into());
            }
            return Ok(missing_resource(resource));
        }
        if desktops.len() != 1 || desktops[0]["DesktopId"] != resource.resource_id {
            return Err("Wuying desktop is missing or mismatched".into());
        }
        let desktop = &desktops[0];
        Ok(
            json!({ "resource": resource, "name": desktop["DesktopName"].as_str(), "status": desktop["DesktopStatus"].as_str(),
            "instanceChargeType": desktop["ChargeType"].as_str(), "instanceType": desktop["DesktopType"].as_str(),
            "stoppedMode": null, "computeReleased": null, "stopChargingModeExposedByProvider": false,
            "retainedResourcesMayBeCharged": true, "desktopReady": false }),
        )
    }

    async fn validate_wuying_inventory(&self, spec: &WuyingDesktopSpec) -> Result<(), String> {
        let images = self
            .wuying(
                spec,
                &[
                    "DescribeImages".into(),
                    "--ImageId.1".into(),
                    spec.image_id.clone(),
                    "--OsType".into(),
                    "Linux".into(),
                ],
            )
            .await?;
        let image = images["Images"]
            .as_array()
            .and_then(|images| {
                images
                    .iter()
                    .find(|image| image["ImageId"] == spec.image_id)
            })
            .ok_or("Selected Linux image is unavailable")?;
        if image["Status"] != "Available"
            || !image["OsType"]
                .as_str()
                .is_some_and(|value| value.eq_ignore_ascii_case("linux"))
            || image["GpuCategory"] != false
        {
            return Err("Only available Linux images without GPU are supported".into());
        }
        let types = self
            .wuying(
                spec,
                &[
                    "DescribeDesktopTypes".into(),
                    "--DesktopTypeId".into(),
                    spec.desktop_type.clone(),
                ],
            )
            .await?;
        let kind = types["DesktopTypes"]
            .as_array()
            .and_then(|types| {
                types
                    .iter()
                    .find(|kind| kind["DesktopTypeId"] == spec.desktop_type)
            })
            .ok_or("Selected desktop type is unavailable")?;
        if kind["GpuCount"].as_f64() != Some(0.0)
            || kind["CpuCount"].as_u64().unwrap_or(0) < 2
            || kind["MemorySize"].as_u64().unwrap_or(0) < 4096
            || !kind["SaleTypes"]
                .as_array()
                .is_some_and(|values| values.iter().any(|value| value == "postPaid"))
            || kind["StockState"] != "Sufficient"
        {
            return Err(
                "Desktop type must have stock, PostPaid support, no GPU and at least 2 cores/4 GiB"
                    .into(),
            );
        }
        let sites = self
            .wuying(
                spec,
                &[
                    "DescribeOfficeSites".into(),
                    "--OfficeSiteId.1".into(),
                    spec.office_site_id.clone(),
                ],
            )
            .await?;
        if !sites["OfficeSites"].as_array().is_some_and(|sites| {
            sites.iter().any(|site| {
                site["OfficeSiteId"] == spec.office_site_id && site["Status"] == "REGISTERED"
            })
        }) {
            return Err("Selected Wuying office site is unavailable".into());
        }
        let policies = self
            .wuying(
                spec,
                &[
                    "DescribePolicyGroups".into(),
                    "--PolicyGroupId.1".into(),
                    spec.policy_group_id.clone(),
                ],
            )
            .await?;
        if !policies["DescribePolicyGroups"]
            .as_array()
            .is_some_and(|policies| {
                policies.iter().any(|policy| {
                    policy["PolicyGroupId"] == spec.policy_group_id
                        && policy["PolicyStatus"] == "AVAILABLE"
                })
            })
        {
            return Err("Selected Wuying policy group is unavailable".into());
        }
        Ok(())
    }

    async fn wuying_price(&self, spec: &WuyingDesktopSpec) -> Result<Value, String> {
        let response = self
            .wuying(
                spec,
                &[
                    "DescribePrice".into(),
                    "--ResourceType".into(),
                    "Desktop".into(),
                    "--InstanceType".into(),
                    spec.desktop_type.clone(),
                    "--RootDiskSizeGib".into(),
                    spec.system_disk_gib.to_string(),
                    "--UserDiskSizeGib".into(),
                    spec.data_disk_gib.to_string(),
                    "--OsType".into(),
                    "Linux".into(),
                    "--PeriodUnit".into(),
                    "Hour".into(),
                    "--Period".into(),
                    "1".into(),
                    "--Amount".into(),
                    "1".into(),
                ],
            )
            .await?;
        let price = response
            .pointer("/PriceInfo/Price/TradePrice")
            .and_then(Value::as_f64)
            .filter(|value| value.is_finite() && *value > 0.0)
            .ok_or("Wuying did not return a valid hourly price")?;
        if response
            .pointer("/PriceInfo/Price/Currency")
            .and_then(Value::as_str)
            != Some("CNY")
        {
            return Err("Unsupported quote currency".into());
        }
        Ok(
            json!({ "hourlyPrice": price, "currency": "CNY", "runningHours": 1,
            "retainedStorageChargedSeparately": true, "networkOrSnapshotNotIncluded": true }),
        )
    }

    pub(super) async fn quote_wuying(&self, spec: WuyingDesktopSpec) -> Result<Value, String> {
        validate_spec(&spec)?;
        self.validate_wuying_inventory(&spec).await?;
        let price = self.wuying_price(&spec).await?;
        self.store_quote(
            serde_json::to_value(spec).map_err(|_| "Invalid quote spec")?,
            price,
        )
    }

    pub(super) async fn purchase_wuying(
        &self,
        spec: WuyingDesktopSpec,
        desktop_name: String,
        operation_id: String,
        quote_id: String,
        confirmation: String,
    ) -> Result<Value, String> {
        validate_spec(&spec)?;
        validate_id(&operation_id)?;
        super::purchase::validate_confirmation(
            "wuying",
            &spec.region_id,
            &desktop_name,
            &quote_id,
            &confirmation,
        )?;
        self.ensure_root()?;
        let _lock = self.lock_operations()?;
        let request = json!({ "action": "purchaseWuying", "spec": spec, "desktopName": desktop_name, "quoteId": quote_id });
        if let Some(existing) = self.read_receipt(&operation_id)? {
            if existing["request"] != request {
                return Err("Operation ID belongs to another request".into());
            }
            return Ok(existing);
        }
        self.check_purchase_available("purchaseWuying", &spec.region_id, &desktop_name, &quote_id)?;
        // This block holds the operation lock and contains only read-only calls.
        // Failure here is an explicit non-submission, never an unknown purchase.
        let preflight: Result<Value, String> = async {
            let quote = self.approved_quote(
                &serde_json::to_value(&spec).map_err(|_| "Invalid quote spec")?,
                &quote_id,
            )?;
            self.validate_wuying_inventory(&spec).await?;
            let current = self.wuying_price(&spec).await?;
            if current != quote["price"] {
                return Err("Price changed; obtain and approve a new quote".into());
            }
            let inventory = self
                .wuying(
                    &spec,
                    &[
                        "DescribeDesktops".into(),
                        "--DesktopName".into(),
                        desktop_name.clone(),
                    ],
                )
                .await?;
            if !inventory["Desktops"].as_array().is_some_and(Vec::is_empty)
                || inventory
                    .get("TotalCount")
                    .is_some_and(|count| count.as_u64() != Some(0))
                || inventory
                    .get("NextToken")
                    .is_some_and(|token| !token.is_null() && token != "")
            {
                return Err("Desktop name already exists; reconcile before purchasing".into());
            }
            self.approved_quote(
                &serde_json::to_value(&spec).map_err(|_| "Invalid quote spec")?,
                &quote_id,
            )?;
            Ok(quote)
        }
        .await;
        let quote = match preflight {
            Ok(quote) => quote,
            Err(diagnostic) => {
                return Ok(json!({ "operationId": operation_id,
                "outcome": "notSubmitted", "submitted": false, "requiresInspection": false,
                "diagnostic": diagnostic }))
            }
        };
        let mut receipt = json!({ "operationId": operation_id, "request": request, "outcome": "unknown",
            "createdAt": chrono::Utc::now().to_rfc3339(), "quote": quote["price"], "requiresInspection": true });
        self.create_receipt(&operation_id, &receipt)?;
        // CreateDesktops has no documented ClientToken. Never resend after a lost response.
        let attachment = json!({ "ImageId": spec.image_id, "DesktopType": spec.desktop_type,
            "SystemDiskSize": spec.system_disk_gib, "DataDiskSize": spec.data_disk_gib, "DefaultLanguage": "en-US" });
        let result = self
            .wuying(
                &spec,
                &[
                    "CreateDesktops".into(),
                    "--Amount".into(),
                    "1".into(),
                    "--OfficeSiteId".into(),
                    spec.office_site_id.clone(),
                    "--EndUserId.1".into(),
                    spec.end_user_id.clone(),
                    "--PolicyGroupId".into(),
                    spec.policy_group_id.clone(),
                    "--DesktopName".into(),
                    desktop_name,
                    "--ChargeType".into(),
                    "PostPaid".into(),
                    "--AutoRenew".into(),
                    "false".into(),
                    "--DesktopAttachment".into(),
                    attachment.to_string(),
                ],
            )
            .await;
        match result {
            Ok(response) => {
                receipt["outcome"] = json!("accepted");
                receipt["requestId"] = json!(response["RequestId"].as_str());
                receipt["desktopIds"] = response["DesktopId"].clone();
                if let Some(ids) = response["DesktopId"].as_array() {
                    for id in ids.iter().filter_map(Value::as_str) {
                        let resource = CloudDesktopResource {
                            provider: CloudDesktopProvider::Wuying,
                            region_id: spec.region_id.clone(),
                            profile: spec.profile.clone(),
                            resource_id: id.into(),
                        };
                        if validate_resource(&resource).is_ok() {
                            let _ = self.remember_resource(&resource);
                        }
                    }
                }
            }
            Err(error) => receipt["diagnostic"] = json!(error),
        }
        self.finalize_receipt(&operation_id, &receipt);
        Ok(receipt)
    }
}
