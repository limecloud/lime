//! 显式真云验收：只消费调用者预先持久化的原操作，失败仍清理该精确意图。

use super::*;

#[tokio::test]
#[ignore = "requires LIME_OSS_RUNTIME_LIVE_INTENT with an explicitly authorized private intent"]
async fn authorized_product_distribution_round_trip_and_cleanup() {
    let path = PathBuf::from(std::env::var_os("LIME_OSS_RUNTIME_LIVE_INTENT").expect("explicit private intent path required"));
    let mut intent: Value = serde_json::from_reader(private_open(&path, false).unwrap()).unwrap();
    let app_data = PathBuf::from(intent["appData"].as_str().unwrap());
    assert!(app_data.is_absolute());
    let service = CloudDesktopService::new(app_data.join("cloud-desktops"));
    let profile = intent["profile"].as_str().unwrap().to_owned();
    let region = intent["regionId"].as_str().unwrap().to_owned();
    let operation = intent["operationId"].as_str().unwrap().to_owned();
    let version = intent["version"].as_str().unwrap().to_owned();
    let bytes = intent["archiveBytes"].as_u64().unwrap();
    let digest = intent["archiveSha256"].as_str().unwrap().to_owned();
    validate_release(&version, bytes, &digest).unwrap();
    let started = std::time::Instant::now();
    let outcome: Result<Value, String> = async {
        let prepared = service.request(CloudDesktopParams::PrepareRuntimeDistribution {
            profile:profile.clone(), region_id:region.clone(), operation_id:operation.clone(),
            version, archive_bytes:bytes, archive_sha256:digest.clone(),
        }).await?;
        if prepared.data["phase"] != "ready" { return Err("LIVE_NOT_READY".into()); }
        let prepared_ms = started.elapsed().as_millis() as u64;
        let repeat = service.request(CloudDesktopParams::PrepareRuntimeDistribution {
            profile:profile.clone(), region_id:region.clone(), operation_id:operation.clone(),
            version:intent["version"].as_str().unwrap().into(), archive_bytes:bytes, archive_sha256:digest.clone(),
        }).await?;
        if repeat.data["phase"] != "ready" || repeat.data["operationId"] != operation { return Err("LIVE_REUSE_FAILED".into()); }
        let signed = service.request(CloudDesktopParams::SignRuntimeDistribution {
            profile:profile.clone(), region_id:region.clone(), operation_id:operation.clone(),
        }).await?;
        let url = signed.data["downloadUrl"].as_str().ok_or("LIVE_NO_CAPABILITY")?;
        let client = reqwest::Client::builder().https_only(true).redirect(reqwest::redirect::Policy::none()).timeout(Duration::from_secs(300)).build().map_err(|_| "LIVE_HTTP_FAILED")?;
        let mut response = client.get(url).send().await.map_err(|_| "LIVE_DOWNLOAD_FAILED")?;
        if response.status().as_u16() != 200 { return Err("LIVE_DOWNLOAD_FAILED".into()); }
        let mut sha = Sha256::new();
        let mut received = 0u64;
        while let Some(block) = response.chunk().await.map_err(|_| "LIVE_DOWNLOAD_FAILED")? {
            received += block.len() as u64;
            if received > bytes { return Err("LIVE_BYTES_INVALID".into()); }
            sha.update(&block);
        }
        if received != bytes || format!("{:x}", sha.finalize()) != digest { return Err("LIVE_HASH_INVALID".into()); }
        let mut anonymous = url::Url::parse(url).map_err(|_| "LIVE_INVALID_CAPABILITY")?;
        anonymous.set_query(None);
        if client.get(anonymous).send().await.map_err(|_| "LIVE_HTTP_FAILED")?.status().as_u16() != 403 { return Err("LIVE_NOT_PRIVATE".into()); }
        Ok(json!({"result":"passed","preparedMs":prepared_ms,"archiveBytes":received,
            "archiveSha256":digest,"anonymousStatus":403,"sameOperationReused":true,"vmCreated":false}))
    }.await;
    let cleanup = service.request(CloudDesktopParams::CleanupRuntimeDistribution {
        profile, region_id:region, operation_id:operation,
    }).await;
    let cleaned = cleanup.as_ref().is_ok_and(|response| matches!(response.data["phase"].as_str(), Some("cleaned" | "absent")));
    let report = match &outcome { Ok(report) => report.clone(), Err(code) => json!({"result":"failed","diagnostic":code,"vmCreated":false}) };
    intent["verification"] = report;
    intent["preciseCleanupVerified"] = json!(cleaned);
    intent["elapsedMs"] = json!(started.elapsed().as_millis() as u64);
    let mut file = private_open(&path, false).unwrap();
    file.set_len(0).unwrap();
    serde_json::to_writer(&mut file, &intent).unwrap();
    file.sync_all().unwrap();
    assert!(cleaned, "exact original distribution cleanup requires inspection");
    assert!(outcome.is_ok(), "product distribution failed; sanitized result retained in the private intent");
}
