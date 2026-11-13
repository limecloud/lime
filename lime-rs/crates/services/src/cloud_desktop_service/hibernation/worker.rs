//! 有界本机推进器。进程退出只释放租约；接续沿原收据查询，不重发未知操作。

use super::*;

#[derive(Debug, PartialEq, Eq)]
pub(super) enum Progress {
    Complete,
    Advanced,
    Pending,
}

impl CloudDesktopService {
    pub(super) async fn run_hibernation(&self, id: &str) {
        self.run_hibernation_with_wait(id, || tokio::time::sleep(Duration::from_secs(3)))
            .await;
    }

    pub(super) async fn run_hibernation_with_wait<W, F>(&self, id: &str, mut wait: W)
    where
        W: FnMut() -> F,
        F: std::future::Future<Output = ()>,
    {
        let result = tokio::time::timeout(Duration::from_secs(1800), async {
            loop {
                match self.advance_hibernation(id).await? {
                    Progress::Complete => return Ok::<(), String>(()),
                    Progress::Advanced => {}
                    Progress::Pending => wait().await,
                }
            }
        })
        .await;
        if !matches!(result, Ok(Ok(()))) {
            // Keep diagnostics bounded and supplier output private. The original child receipt
            // contains its own safe diagnostic; resuming cannot submit that child twice.
            let _ = self.update_hibernation(id, |receipt| {
                receipt["outcome"] = json!("paused");
                receipt["failureCode"] = json!(if result.is_err() {
                    "workerTimedOut"
                } else {
                    "stepNeedsInspection"
                });
                Ok(())
            });
        }
    }

    fn update_hibernation(
        &self,
        id: &str,
        change: impl FnOnce(&mut Value) -> Result<(), String>,
    ) -> Result<(), String> {
        let _lock = self.lock_operations()?;
        let mut receipt = self
            .read_receipt(id)?
            .ok_or("Missing environment preservation operation")?;
        if terminal(&receipt) {
            return Ok(());
        }
        change(&mut receipt)?;
        self.validate_hibernation_receipt(&receipt)?;
        self.replace_receipt(id, &receipt)
    }

    fn hibernation_phase(&self, id: &str, phase: &str) -> Result<(), String> {
        self.update_hibernation(id, |receipt| {
            let prerequisite = match phase {
                "imaging" => Some(("snapshot", "snapshotReady")),
                "releasing" => Some(("createEcsImage", "imageReady")),
                _ => None,
            };
            if let Some((action, outcome)) = prerequisite {
                let child = self
                    .read_receipt(receipt["children"][action].as_str().unwrap())?
                    .ok_or("Missing durable preservation prerequisite")?;
                if child["outcome"] != outcome {
                    return Err("Preservation prerequisite was not durably verified".into());
                }
            }
            receipt["phase"] = json!(phase);
            receipt["outcome"] = json!("running");
            receipt.as_object_mut().unwrap().remove("failureCode");
            Ok(())
        })
    }

    pub(super) async fn advance_hibernation(&self, id: &str) -> Result<Progress, String> {
        let receipt = self
            .read_receipt(id)?
            .ok_or("Missing environment preservation operation")?;
        if terminal(&receipt) {
            return Ok(Progress::Complete);
        }
        let resource: CloudDesktopResource =
            serde_json::from_value(receipt["request"]["resource"].clone())
                .map_err(|_| "Invalid preservation resource")?;
        let child = |action: &str| receipt["children"][action].as_str().unwrap().to_owned();
        let disk = receipt["diskId"].as_str().unwrap();
        match receipt["phase"].as_str().unwrap() {
            "stopping" => {
                if self.inspect(&resource).await?["status"] == "Stopped" {
                    let operation = child("stop");
                    if self.read_receipt(&operation)?.is_some()
                        && self.inspect_lifecycle_operation(&operation).await?["outcome"]
                            != "lifecycleVerified"
                    {
                        return Ok(Progress::Pending);
                    }
                    self.hibernation_phase(id, "snapshotting")?;
                    return Ok(Progress::Advanced);
                }
                let operation = child("stop");
                self.mutate_for_hibernation(
                    resource.clone(),
                    operation,
                    format!("stop:{}:{}", resource.region_id, resource.resource_id),
                    LifecycleChange::Stop,
                    true,
                    Some(id),
                )
                .await?;
                let observed = self.inspect(&resource).await?;
                match observed["status"].as_str() {
                    Some("Stopped") => {
                        if self.inspect_lifecycle_operation(&child("stop")).await?["outcome"]
                            != "lifecycleVerified"
                        {
                            return Ok(Progress::Pending);
                        }
                        self.hibernation_phase(id, "snapshotting")?;
                    }
                    Some("Running" | "Stopping") => return Ok(Progress::Pending),
                    _ => return Err("Original desktop cannot be verified after stop".into()),
                }
            }
            "snapshotting" => {
                let observed = self.inspect(&resource).await?;
                if observed["status"] != "Stopped" {
                    return Err("Cold environment preservation requires the original desktop to remain stopped".into());
                }
                self.hibernation_disk(&resource, Some(disk)).await?;
                let operation = child("snapshot");
                self.mutate_for_hibernation(
                    resource.clone(),
                    operation.clone(),
                    format!(
                        "snapshot:{}:{}:{disk}",
                        resource.region_id, resource.resource_id
                    ),
                    LifecycleChange::Snapshot(disk.into()),
                    true,
                    Some(id),
                )
                .await?;
                let snapshot = self.inspect_snapshot_operation(&operation).await?;
                if snapshot["outcome"] == "snapshotReady" {
                    self.hibernation_phase(id, "imaging")?;
                } else {
                    return Ok(Progress::Pending);
                }
            }
            "imaging" => {
                let snapshot = child("snapshot");
                let image = child("createEcsImage");
                self.create_ecs_image_for_hibernation(
                    &snapshot,
                    &image,
                    &format!("createEcsImage:{snapshot}"),
                    true,
                    Some(id),
                )
                .await?;
                let image = self.inspect_ecs_image_operation(&image).await?;
                match image["outcome"].as_str() {
                    Some("imageReady") => self.hibernation_phase(id, "releasing")?,
                    Some("imageFailed") => {
                        return Err("System image creation failed; original desktop retained".into())
                    }
                    _ => return Ok(Progress::Pending),
                }
            }
            "releasing" => {
                let release = child("release");
                let image = child("createEcsImage");
                let submitted = self
                    .mutate_for_hibernation(
                        resource.clone(),
                        release.clone(),
                        format!(
                            "release:{}:{}:discard-data:image:{image}",
                            resource.region_id, resource.resource_id
                        ),
                        LifecycleChange::Release(Some(image)),
                        true,
                        Some(id),
                    )
                    .await?;
                if submitted["outcome"] == "notSubmitted" {
                    return Err("Retained image could not be verified; desktop retained".into());
                }
                let verified = self.inspect_operation(&release).await?;
                if verified["outcome"] == "released" {
                    self.update_hibernation(id, |receipt| {
                        receipt["outcome"] = json!("hibernated");
                        receipt["requiresInspection"] = json!(false);
                        receipt["releaseImage"] = verified["releaseImage"].clone();
                        receipt["observedAfter"] = verified["observedAfter"].clone();
                        receipt["verifiedAt"] = verified["verifiedAt"].clone();
                        Ok(())
                    })?;
                    return Ok(Progress::Complete);
                }
                return Ok(Progress::Pending);
            }
            _ => return Err("Invalid preservation phase".into()),
        }
        Ok(Progress::Advanced)
    }
}
