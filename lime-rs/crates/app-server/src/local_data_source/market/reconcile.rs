use super::*;

impl MarketStore {
    pub async fn reconcile(
        &self,
        params: MarketReconcileParams,
    ) -> Result<MarketReconcileResponse, String> {
        let Some(context) = self.context()? else {
            return Ok(Default::default());
        };
        let (records, errors) = self.records(&context, params.kind)?;
        let mut resources = Vec::new();
        // This is a read-only check of the original acquisition, not publication,
        // runtime approval or a request to enable/disable the local package.
        for record in records {
            let acquisition = context
                .get::<market::wire::Acquisition>(&format!(
                    "/market/acquisitions/{}",
                    record.acquisition_id
                ))
                .await;
            context.ensure_current().map_err(|e| e.to_string())?;
            let acquisition_status = match acquisition {
                Ok(value)
                    if value.id == record.acquisition_id
                        && value.release_id == record.selection.release.id
                        && value.revision > 0 =>
                {
                    match value.status.as_str() {
                        "active" => MarketAcquisitionStatus::Active,
                        "revoked" => MarketAcquisitionStatus::Revoked,
                        _ => MarketAcquisitionStatus::Unavailable,
                    }
                }
                _ => MarketAcquisitionStatus::Unavailable,
            };
            resources.push(MarketAcquisitionCheck {
                item_id: record.selection.item.id.clone(),
                kind: components::kind(&record.selection)?,
                release: record.selection.release.reference(),
                acquisition_status,
            });
        }
        context.ensure_current().map_err(|e| e.to_string())?;
        Ok(MarketReconcileResponse { resources, errors })
    }
}
