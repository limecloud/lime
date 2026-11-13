use super::selection::Selection;
use super::{wire, Context};
use sha2::{Digest, Sha256};

pub(crate) struct PreparedResource {
    pub root: tempfile::TempDir,
    pub acquisition: wire::Acquisition,
    pub release: wire::Release,
}

/// All market types share the same acquisition, recovery, ticket and ZIP boundary.
pub(crate) async fn prepare(
    context: &Context<'_>,
    selection: &Selection,
    attempt: &str,
    task: &str,
) -> Result<PreparedResource, String> {
    selection.validate().map_err(|e| e.to_string())?;
    if !selection.compatible() {
        return Err("market_host_unsupported".into());
    }
    let item = &selection.item;
    let release = &selection.release;
    let acquisition: wire::Acquisition = context
        .command(
            "/market/acquisitions",
            serde_json::json!({"releaseId":release.id,"host":wire::host(),"expectedItemRevision":item.revision}),
            &operation_key(attempt, &item.id, "acquire"),
            task,
        )
        .await
        .map_err(|e| e.to_string())?;
    if !wire::identifier(&acquisition.id)
        || acquisition.release_id != release.id
        || acquisition.status != "active"
        || acquisition.revision == 0
    {
        return Err("invalid market acquisition".into());
    }
    let ticket: wire::Ticket = context
        .command(
            &format!("/market/acquisitions/{}/download-tickets", acquisition.id),
            serde_json::json!({"revision":acquisition.revision}),
            &operation_key(attempt, &item.id, "download"),
            task,
        )
        .await
        .map_err(|e| e.to_string())?;
    if ticket.sha256 != release.archive_sha256 || ticket.size != release.archive_size {
        return Err("market ticket digest mismatch".into());
    }
    let download = super::bundle::download_ticket(&ticket, &context.account).await?;
    context.ensure_current().map_err(|e| e.to_string())?;
    let release = release.clone();
    tokio::task::spawn_blocking(move || {
        let root = super::archive::extract(download.path(), &release)?;
        Ok(PreparedResource {
            root,
            acquisition,
            release,
        })
    })
    .await
    .map_err(|_| "market staging task failed".to_string())?
}

pub(crate) fn operation_key(attempt: &str, item_id: &str, phase: &str) -> String {
    let mut digest = Sha256::new();
    for value in [attempt, item_id, phase] {
        digest.update((value.len() as u64).to_be_bytes());
        digest.update(value.as_bytes());
    }
    hex::encode(digest.finalize())
}
