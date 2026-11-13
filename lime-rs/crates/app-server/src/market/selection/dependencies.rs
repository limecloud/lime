use super::*;

impl Context<'_> {
    /// Resolve exact releases once, before persisting an attempt or dispatching writes.
    pub(crate) async fn select_dependencies(
        &self,
        parent: &Selection,
    ) -> Result<Vec<Selection>, RuntimeCoreError> {
        parent.validate_plugin()?;
        let mut selections = Vec::new();
        for dependency in &parent
            .release
            .manifest
            .plugin
            .as_ref()
            .ok_or_else(invalid)?
            .dependencies
        {
            let release: wire::Release = self
                .get(&format!("/market/releases/{}", dependency.release_id))
                .await?;
            release.validate()?;
            if release.id != dependency.release_id
                || release.archive_sha256 != dependency.sha256
                || release.manifest.kind != dependency.kind
            {
                return Err(invalid());
            }
            let item: wire::Item = self
                .get(&format!(
                    "/market/items/{}?{}",
                    release.item_id,
                    wire::host_query()
                ))
                .await?;
            let selection = Selection { item, release };
            selection.validate()?;
            if selection.item.environment != parent.item.environment || !selection.compatible() {
                return Err(invalid());
            }
            selections.push(selection);
        }
        validate_dependencies(parent, &selections)?;
        Ok(selections)
    }
}

pub(crate) fn validate_dependencies(
    parent: &Selection,
    selections: &[Selection],
) -> Result<(), RuntimeCoreError> {
    parent.validate_plugin()?;
    let dependencies = &parent
        .release
        .manifest
        .plugin
        .as_ref()
        .ok_or_else(invalid)?
        .dependencies;
    if dependencies.len() != selections.len() {
        return Err(invalid());
    }
    let mut files = parent.release.manifest.files.len();
    let mut bytes: u64 = parent
        .release
        .manifest
        .files
        .iter()
        .map(|file| file.size)
        .sum();
    for (dependency, selection) in dependencies.iter().zip(selections) {
        selection.validate()?;
        if dependency.release_id != selection.release.id
            || dependency.sha256 != selection.release.archive_sha256
            || dependency.kind != selection.release.manifest.kind
            || selection.item.environment != parent.item.environment
            || !selection.compatible()
        {
            return Err(invalid());
        }
        files += selection.release.manifest.files.len();
        bytes += selection
            .release
            .manifest
            .files
            .iter()
            .map(|file| file.size)
            .sum::<u64>();
    }
    // Keep the entire installation inside the existing local package budget.
    if files > 10_000 || bytes > 512 * 1024 * 1024 {
        return Err(invalid());
    }
    Ok(())
}
