//! 数据模型模块
//!
//! 包含 Lime 的所有核心数据模型定义。

pub mod anthropic;
pub mod app_type;
pub mod client_type;
pub mod injection_types;
pub mod machine_id;
pub mod mcp_model;
pub mod model_registry;
pub mod openai;
pub mod project_model;
pub mod prompt_model;
pub mod provider_model;
pub mod provider_type;
pub mod runtime_provider_model;
pub mod skill_model;
pub mod vertex_model;

#[allow(unused_imports)]
pub use anthropic::*;
pub use app_type::AppType;
pub use client_type::{select_provider, ClientType};
pub use injection_types::{InjectionMode, InjectionRule};
pub use mcp_model::McpServer;
#[allow(unused_imports)]
pub use openai::*;
pub use project_model::Persona;
pub use prompt_model::Prompt;
pub use provider_model::Provider;
pub use provider_type::ProviderType;
pub use runtime_provider_model::{
    runtime_api_key_credential_uuid, runtime_api_key_id_from_credential_uuid,
    ProviderPromptCacheMode, RuntimeCredentialData, RuntimeProviderCredential, RuntimeProviderType,
    RUNTIME_API_KEY_CREDENTIAL_UUID_PREFIX,
};
pub use skill_model::{
    parse_skill_manifest_from_content, resolve_skill_source_kind, split_skill_frontmatter,
    summarize_skill_resources_dir, ParsedSkillManifest, Skill, SkillCatalogSource, SkillMetadata,
    SkillPackageInspection, SkillRepo, SkillResourceSummary, SkillSourceKind,
    SkillStandardCompliance, SkillState, SkillStates, ANALYSIS_SKILL_DIRECTORY,
    BROADCAST_GENERATE_SKILL_DIRECTORY, CONTENT_POST_WITH_COVER_SKILL_DIRECTORY,
    COVER_GENERATE_SKILL_DIRECTORY, DEFAULT_LIME_SKILL_DIRECTORIES, FORM_GENERATE_SKILL_DIRECTORY,
    IMAGE_GENERATE_SKILL_DIRECTORY, KNOWLEDGE_BUILDER_SKILL_DIRECTORY, LIBRARY_SKILL_DIRECTORY,
    MODAL_RESOURCE_SEARCH_SKILL_DIRECTORY, PDF_READ_SKILL_DIRECTORY,
    PRESENTATION_GENERATE_SKILL_DIRECTORY, REPORT_GENERATE_SKILL_DIRECTORY,
    RESEARCH_SKILL_DIRECTORY, SITE_SEARCH_SKILL_DIRECTORY, SUMMARY_SKILL_DIRECTORY,
    TRANSCRIPTION_GENERATE_SKILL_DIRECTORY, TRANSLATION_SKILL_DIRECTORY,
    TYPESETTING_SKILL_DIRECTORY, URL_PARSE_SKILL_DIRECTORY, VIDEO_GENERATE_SKILL_DIRECTORY,
    WEBPAGE_GENERATE_SKILL_DIRECTORY,
};
pub use vertex_model::{VertexApiKeyEntry, VertexModelAlias};
