use super::*;
use market::{resource, wire::Release};

pub(super) fn kind(selection: &Selection) -> Result<MarketResourceKind, String> {
    match selection.release.manifest.kind.as_str() {
        "skill" => Ok(MarketResourceKind::Skill),
        "mcp" => Ok(MarketResourceKind::Mcp),
        _ => Err("market_resource_type_mismatch".into()),
    }
}

pub(super) fn validate(root: &Path, release: &Release) -> Result<(), String> {
    match release.manifest.kind.as_str() {
        "skill" => {
            resource::skill(root, release)?;
        }
        "mcp" => {
            resource::mcp_config(root, release, "staging")?;
        }
        _ => return Err("market_resource_type_mismatch".into()),
    }
    Ok(())
}

pub(super) fn mcp_name(account_id: &str, release: &Release) -> String {
    resource::mcp_name(&format!("standalone:{account_id}"), release)
}

impl MarketStore {
    pub fn skills(&self) -> Result<Vec<lime_skills::AgentSkillMetadata>, String> {
        let Some(context) = self.context()? else {
            return Ok(Vec::new());
        };
        let (records, errors) = self.records(&context, Some(MarketResourceKind::Skill))?;
        for error in errors {
            tracing::warn!(item_id=%error.item_id, "跳过损坏的市场技能");
        }
        let mut skills = Vec::new();
        for record in records.into_iter().filter(|r| r.enabled) {
            let root = self
                .base(
                    &context,
                    MarketResourceKind::Skill,
                    &record.selection.item.id,
                )?
                .join("package");
            let mut skill = resource::skill(&root, &record.selection.release)?;
            skill.skill_id = format!(
                "market:{}:{}",
                record.account_id, record.selection.release.id
            );
            skills.push(skill);
        }
        context.ensure_current().map_err(|e| e.to_string())?;
        Ok(skills)
    }

    pub fn mcp_specs(&self) -> Result<Vec<lime_mcp::McpRuntimeServerSpec>, String> {
        let Some(context) = self.context()? else {
            return Ok(Vec::new());
        };
        let (records, errors) = self.records(&context, Some(MarketResourceKind::Mcp))?;
        for error in errors {
            tracing::warn!(item_id=%error.item_id, "跳过损坏的市场MCP");
        }
        let mut specs = Vec::new();
        for record in records.into_iter().filter(|r| r.enabled) {
            let name = mcp_name(&record.account_id, &record.selection.release);
            let root = self
                .base(&context, MarketResourceKind::Mcp, &record.selection.item.id)?
                .join("package");
            specs.push(lime_mcp::McpRuntimeServerSpec {
                config: resource::mcp_config(&root, &record.selection.release, &name)?,
                name,
                plugin_id: None,
            });
        }
        context.ensure_current().map_err(|e| e.to_string())?;
        Ok(specs)
    }
}
