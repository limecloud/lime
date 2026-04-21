use aster::hooks::FrontmatterHooks;
use aster::session::extension_data::{ExtensionData, ExtensionState};
use aster::session::Session;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct SubagentSkillSummary {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub directory: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct SubagentProfileSummary {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role_key: Option<String>,
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_contract: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system_overlay: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub skill_ids: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct TeamPresetSummary {
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub profile_ids: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default, PartialEq, Eq)]
pub struct SubagentCustomizationState {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blueprint_role_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blueprint_role_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub team_preset_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_contract: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system_overlay: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub skill_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub skills: Vec<SubagentSkillSummary>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hooks: Option<FrontmatterHooks>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub allowed_tools: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub disallowed_tools: Vec<String>,
}

impl ExtensionState for SubagentCustomizationState {
    const EXTENSION_NAME: &'static str = "subagent_customization";
    const VERSION: &'static str = "v0";
}

impl SubagentCustomizationState {
    pub fn from_extension_data(extension_data: &ExtensionData) -> Option<Self> {
        <Self as ExtensionState>::from_extension_data(extension_data)
    }

    pub fn from_session(session: &Session) -> Option<Self> {
        Self::from_extension_data(&session.extension_data)
    }

    pub fn to_extension_data(&self, extension_data: &mut ExtensionData) -> Result<(), String> {
        <Self as ExtensionState>::to_extension_data(self, extension_data)
            .map_err(|error| error.to_string())
    }

    pub fn into_updated_extension_data(self, session: &Session) -> Result<ExtensionData, String> {
        let mut extension_data = session.extension_data.clone();
        self.to_extension_data(&mut extension_data)?;
        Ok(extension_data)
    }

    pub fn is_empty(&self) -> bool {
        self.blueprint_role_id.is_none()
            && self.blueprint_role_label.is_none()
            && self.profile_id.is_none()
            && self.profile_name.is_none()
            && self.role_key.is_none()
            && self.team_preset_id.is_none()
            && self.theme.is_none()
            && self.output_contract.is_none()
            && self.system_overlay.is_none()
            && self.skill_ids.is_empty()
            && self.skills.is_empty()
            && self
                .hooks
                .as_ref()
                .map(|hooks| hooks.is_empty())
                .unwrap_or(true)
            && self.allowed_tools.is_empty()
            && self.disallowed_tools.is_empty()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubagentSkillPromptBlock {
    pub title: String,
    pub content: String,
}

#[derive(Debug, Clone, Copy)]
pub struct BuiltinSkillDescriptor {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub prompt_overlay: &'static str,
}

#[derive(Debug, Clone, Copy)]
pub struct BuiltinProfileDescriptor {
    pub id: &'static str,
    pub name: &'static str,
    pub role_key: &'static str,
    pub description: &'static str,
    pub theme: &'static str,
    pub output_contract: &'static str,
    pub system_overlay: &'static str,
    pub skill_ids: &'static [&'static str],
}

#[derive(Debug, Clone, Copy)]
pub struct BuiltinTeamPresetDescriptor {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub theme: &'static str,
    pub profile_ids: &'static [&'static str],
}

const BUILTIN_SKILLS: &[BuiltinSkillDescriptor] = &[
    BuiltinSkillDescriptor {
        id: "repo-exploration",
        name: "仓库探索",
        description: "优先读事实源、收敛问题边界，并避免在未确认上下文前直接改动。",
        prompt_overlay:
            "先确认真实事实源，再输出发现、证据、影响面和下一步建议。不要直接跳到实现。",
    },
    BuiltinSkillDescriptor {
        id: "bounded-implementation",
        name: "边界实现",
        description: "实现时只改明确归属的范围，避免与其他子代理写入冲突。",
        prompt_overlay:
            "实现只覆盖明确授权的范围。若存在未知依赖或潜在写入冲突，应先显式说明假设。",
    },
    BuiltinSkillDescriptor {
        id: "verification-report",
        name: "验证汇报",
        description: "强调验证、回归、风险与剩余缺口，而不是泛化总结。",
        prompt_overlay: "优先报告验证步骤、通过项、失败项、残余风险和建议回归范围，避免空泛总结。",
    },
    BuiltinSkillDescriptor {
        id: "source-grounding",
        name: "事实收敛",
        description: "对调研与分析类任务要求明确区分事实、推断和待验证项。",
        prompt_overlay: "输出中要明确区分事实、推断与待验证项；引用来源时尽量给出时间口径。",
    },
    BuiltinSkillDescriptor {
        id: "structured-writing",
        name: "结构写作",
        description: "产出面向开发者可直接执行的方案、摘要或说明文档。",
        prompt_overlay:
            "写作优先输出可直接复用的结构化内容，避免空泛修辞，默认面向有经验的开发者。",
    },
];

const BUILTIN_PROFILES: &[BuiltinProfileDescriptor] = &[
    BuiltinProfileDescriptor {
        id: "code-explorer",
        name: "代码分析员",
        role_key: "explorer",
        description: "负责阅读代码、收敛问题、定位影响面与事实证据。",
        theme: "engineering",
        output_contract: "输出问题定位、证据、影响范围、候选方案，不直接大范围改文件。",
        system_overlay:
            "你是团队中的代码分析员。优先建立事实模型，明确根因和影响面，再给出最小变更建议。",
        skill_ids: &["repo-exploration", "source-grounding"],
    },
    BuiltinProfileDescriptor {
        id: "code-executor",
        name: "代码执行员",
        role_key: "executor",
        description: "负责在清晰边界内实现改动，并回报改动与验证结果。",
        theme: "engineering",
        output_contract: "只在明确写入范围内实现，并说明改动点、验证结果、未覆盖风险。",
        system_overlay:
            "你是团队中的代码执行员。只在边界清晰、职责明确的范围里实现，不要扩散到无关模块。",
        skill_ids: &["bounded-implementation", "verification-report"],
    },
    BuiltinProfileDescriptor {
        id: "code-verifier",
        name: "代码验证员",
        role_key: "verifier",
        description: "负责复核结果、补充测试与列出风险。",
        theme: "engineering",
        output_contract: "输出验证步骤、结论、失败项、剩余风险与建议回归范围。",
        system_overlay:
            "你是团队中的代码验证员。重点是验证与风险，不重复实现过程，不输出泛泛总结。",
        skill_ids: &["verification-report", "source-grounding"],
    },
    BuiltinProfileDescriptor {
        id: "research-analyst",
        name: "研究分析员",
        role_key: "researcher",
        description: "负责多源材料整理、证据归并与结论提炼。",
        theme: "research",
        output_contract: "输出事实、结论、待验证项和来源时间口径。",
        system_overlay: "你是团队中的研究分析员。优先整理来源、比对差异、提炼可支撑的结论。",
        skill_ids: &["source-grounding", "structured-writing"],
    },
    BuiltinProfileDescriptor {
        id: "doc-writer",
        name: "文档起草员",
        role_key: "writer",
        description: "负责把分析结果转成方案、说明、PRD 或面向团队的文档。",
        theme: "documentation",
        output_contract: "输出结构清晰、可直接评审或落地的文档草稿。",
        system_overlay:
            "你是团队中的文档起草员。目标是产出可被开发者直接评审和执行的文档，而不是泛化描述。",
        skill_ids: &["structured-writing"],
    },
    BuiltinProfileDescriptor {
        id: "content-ideator",
        name: "内容策划员",
        role_key: "ideator",
        description: "负责生成创意方向、候选结构与选题角度。",
        theme: "content",
        output_contract: "输出多个可比较方向，并说明适用场景与取舍。",
        system_overlay: "你是团队中的内容策划员。优先给出有区分度的方向，而不是单一平均解。",
        skill_ids: &["structured-writing"],
    },
    BuiltinProfileDescriptor {
        id: "content-reviewer",
        name: "内容复核员",
        role_key: "reviewer",
        description: "负责复核内容一致性、可读性与发布风险。",
        theme: "content",
        output_contract: "输出问题清单、建议修改项和发布前检查项。",
        system_overlay: "你是团队中的内容复核员。重点识别表达问题、逻辑缺口和发布风险。",
        skill_ids: &["verification-report", "structured-writing"],
    },
];

const BUILTIN_TEAM_PRESETS: &[BuiltinTeamPresetDescriptor] = &[
    BuiltinTeamPresetDescriptor {
        id: "code-triage-team",
        name: "代码排障团队",
        description: "适合代码问题的分析、实现、验证闭环。",
        theme: "engineering",
        profile_ids: &["code-explorer", "code-executor", "code-verifier"],
    },
    BuiltinTeamPresetDescriptor {
        id: "research-team",
        name: "研究团队",
        description: "适合事实收敛、资料分析和文档沉淀。",
        theme: "research",
        profile_ids: &["research-analyst", "doc-writer", "code-verifier"],
    },
    BuiltinTeamPresetDescriptor {
        id: "content-creation-team",
        name: "内容创作团队",
        description: "适合创意拆分、内容起草与复核。",
        theme: "content",
        profile_ids: &["content-ideator", "doc-writer", "content-reviewer"],
    },
];

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    let trimmed = value?.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

pub fn builtin_skill_descriptor_by_id(id: &str) -> Option<&'static BuiltinSkillDescriptor> {
    BUILTIN_SKILLS
        .iter()
        .find(|descriptor| descriptor.id == id.trim())
}

pub fn builtin_profile_descriptor_by_id(id: &str) -> Option<&'static BuiltinProfileDescriptor> {
    BUILTIN_PROFILES
        .iter()
        .find(|descriptor| descriptor.id == id.trim())
}

pub fn builtin_team_preset_descriptor_by_id(
    id: &str,
) -> Option<&'static BuiltinTeamPresetDescriptor> {
    BUILTIN_TEAM_PRESETS
        .iter()
        .find(|descriptor| descriptor.id == id.trim())
}

pub fn builtin_team_preset_label_by_id(id: &str) -> Option<&'static str> {
    builtin_team_preset_descriptor_by_id(id).map(|descriptor| descriptor.name)
}

pub fn builtin_profile_name_by_id(id: &str) -> Option<&'static str> {
    builtin_profile_descriptor_by_id(id).map(|descriptor| descriptor.name)
}

pub fn summarize_builtin_skill(id: &str) -> Option<SubagentSkillSummary> {
    let descriptor = builtin_skill_descriptor_by_id(id)?;
    Some(SubagentSkillSummary {
        id: descriptor.id.to_string(),
        name: descriptor.name.to_string(),
        description: Some(descriptor.description.to_string()),
        source: Some("builtin".to_string()),
        directory: None,
    })
}

pub fn summarize_builtin_profile(id: &str) -> Option<SubagentProfileSummary> {
    let descriptor = builtin_profile_descriptor_by_id(id)?;
    Some(SubagentProfileSummary {
        id: descriptor.id.to_string(),
        name: descriptor.name.to_string(),
        role_key: Some(descriptor.role_key.to_string()),
        description: descriptor.description.to_string(),
        theme: Some(descriptor.theme.to_string()),
        output_contract: Some(descriptor.output_contract.to_string()),
        system_overlay: Some(descriptor.system_overlay.to_string()),
        skill_ids: descriptor
            .skill_ids
            .iter()
            .map(|skill_id| (*skill_id).to_string())
            .collect(),
    })
}

pub fn summarize_builtin_team_preset(id: &str) -> Option<TeamPresetSummary> {
    let descriptor = builtin_team_preset_descriptor_by_id(id)?;
    Some(TeamPresetSummary {
        id: descriptor.id.to_string(),
        name: descriptor.name.to_string(),
        description: descriptor.description.to_string(),
        theme: Some(descriptor.theme.to_string()),
        profile_ids: descriptor
            .profile_ids
            .iter()
            .map(|profile_id| (*profile_id).to_string())
            .collect(),
    })
}

pub fn build_subagent_customization_prompt(
    customization: &SubagentCustomizationState,
    local_skill_blocks: &[SubagentSkillPromptBlock],
) -> Option<String> {
    if customization.is_empty() && local_skill_blocks.is_empty() {
        return None;
    }

    let mut sections = Vec::new();
    let mut header_lines = vec!["【Subagent 定制配置】".to_string()];
    if let Some(team_preset_id) = customization.team_preset_id.as_deref() {
        let preset_label =
            builtin_team_preset_label_by_id(team_preset_id).unwrap_or(team_preset_id);
        header_lines.push(format!("- 团队预设：{preset_label} ({team_preset_id})"));
    }
    if let Some(blueprint_role_label) = customization.blueprint_role_label.as_deref() {
        let blueprint_role_id_suffix = customization
            .blueprint_role_id
            .as_deref()
            .map(|role_id| format!(" ({role_id})"))
            .unwrap_or_default();
        header_lines.push(format!(
            "- 蓝图角色：{blueprint_role_label}{blueprint_role_id_suffix}"
        ));
    } else if let Some(blueprint_role_id) = customization.blueprint_role_id.as_deref() {
        header_lines.push(format!("- 蓝图角色 ID：{blueprint_role_id}"));
    }
    if let Some(profile_name) = customization.profile_name.as_deref() {
        let profile_id_suffix = customization
            .profile_id
            .as_deref()
            .map(|profile_id| format!(" ({profile_id})"))
            .unwrap_or_default();
        header_lines.push(format!("- Profile：{profile_name}{profile_id_suffix}"));
    } else if let Some(profile_id) = customization.profile_id.as_deref() {
        let profile_name = builtin_profile_name_by_id(profile_id).unwrap_or(profile_id);
        header_lines.push(format!("- Profile：{profile_name} ({profile_id})"));
    }
    if let Some(role_key) = customization.role_key.as_deref() {
        header_lines.push(format!("- Role Key：{role_key}"));
    }
    if let Some(theme) = customization.theme.as_deref() {
        header_lines.push(format!("- Theme：{theme}"));
    }
    if let Some(output_contract) = customization.output_contract.as_deref() {
        header_lines.push(format!("- 输出契约：{output_contract}"));
    }
    if !customization.allowed_tools.is_empty() {
        header_lines.push(format!(
            "- Allowed Tools：{}",
            customization.allowed_tools.join(", ")
        ));
    }
    if !customization.disallowed_tools.is_empty() {
        header_lines.push(format!(
            "- Disallowed Tools：{}",
            customization.disallowed_tools.join(", ")
        ));
    }
    sections.push(header_lines.join("\n"));

    if let Some(system_overlay) = customization.system_overlay.as_deref() {
        let trimmed = system_overlay.trim();
        if !trimmed.is_empty() {
            sections.push(format!("执行补充要求：\n{trimmed}"));
        }
    }

    let builtin_skill_blocks = customization
        .skill_ids
        .iter()
        .filter_map(|skill_id| builtin_skill_descriptor_by_id(skill_id))
        .map(|descriptor| SubagentSkillPromptBlock {
            title: format!("builtin skill · {}", descriptor.name),
            content: descriptor.prompt_overlay.to_string(),
        })
        .collect::<Vec<_>>();

    let mut all_skill_blocks = builtin_skill_blocks;
    all_skill_blocks.extend(local_skill_blocks.iter().cloned());

    if !all_skill_blocks.is_empty() {
        let rendered_blocks = all_skill_blocks
            .iter()
            .filter_map(|block| {
                let content = normalize_optional_text(Some(block.content.clone()))?;
                Some(format!("### {}\n{}", block.title, content))
            })
            .collect::<Vec<_>>();
        if !rendered_blocks.is_empty() {
            sections.push(format!("附加技能：\n{}", rendered_blocks.join("\n\n")));
        }
    }

    Some(sections.join("\n\n"))
}
