use super::{selection::Selection, RuntimeCoreError};
use app_server_protocol::protocol::v2::{
    MarketInstallation, MarketMcp, MarketResource, MarketResourceKind,
};

pub(crate) fn resource(
    selection: &Selection,
    language: &str,
    installation: Option<MarketInstallation>,
) -> Result<MarketResource, RuntimeCoreError> {
    selection.validate()?;
    let manifest = &selection.release.manifest;
    let kind = match manifest.kind.as_str() {
        "skill" => MarketResourceKind::Skill,
        "mcp" => MarketResourceKind::Mcp,
        _ => {
            return Err(RuntimeCoreError::InvalidRequest(
                "market_resource_type_mismatch".into(),
            ))
        }
    };
    Ok(MarketResource {
        item_id: selection.item.id.clone(),
        publisher_application_id: selection.item.publisher_application_id.clone(),
        kind,
        name: manifest.name.clone(),
        title: manifest.title.value(language),
        description: manifest.description.value(language),
        version: manifest.version.clone(),
        license: manifest.license.clone(),
        release: selection.release.reference(),
        compatible: selection.compatible(),
        actions: manifest
            .skill
            .as_ref()
            .map(|s| s.actions.clone())
            .unwrap_or_default(),
        mcp: manifest.mcp.as_ref().map(|m| MarketMcp {
            transport: m.transport.clone(),
            endpoint: m.endpoint.clone(),
            executable: m.executable.clone(),
            arguments: m.arguments.clone(),
            authentication: m.auth.r#type.clone(),
            scopes: m.auth.scopes.clone(),
            tools: m.tools.clone(),
        }),
        installation,
    })
}
