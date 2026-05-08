use std::fs;
use std::path::Path;

#[cfg(test)]
use std::path::PathBuf;

use lime_core::app_paths;
use lime_core::models::parse_skill_manifest_from_content;
use lime_core::models::{
    ANALYSIS_SKILL_DIRECTORY, BRAND_PERSONA_KNOWLEDGE_BUILDER_SKILL_DIRECTORY,
    BRAND_PRODUCT_KNOWLEDGE_BUILDER_SKILL_DIRECTORY, BROADCAST_GENERATE_SKILL_DIRECTORY,
    CAMPAIGN_OPERATIONS_KNOWLEDGE_BUILDER_SKILL_DIRECTORY,
    CONTENT_OPERATIONS_KNOWLEDGE_BUILDER_SKILL_DIRECTORY, CONTENT_POST_WITH_COVER_SKILL_DIRECTORY,
    COVER_GENERATE_SKILL_DIRECTORY, FORM_GENERATE_SKILL_DIRECTORY,
    GROWTH_STRATEGY_KNOWLEDGE_BUILDER_SKILL_DIRECTORY, IMAGE_GENERATE_SKILL_DIRECTORY,
    KNOWLEDGE_BUILDER_SKILL_DIRECTORY, LIBRARY_SKILL_DIRECTORY,
    LIVE_COMMERCE_OPERATIONS_KNOWLEDGE_BUILDER_SKILL_DIRECTORY,
    MODAL_RESOURCE_SEARCH_SKILL_DIRECTORY, ORGANIZATION_KNOWHOW_KNOWLEDGE_BUILDER_SKILL_DIRECTORY,
    PDF_READ_SKILL_DIRECTORY, PERSONAL_IP_KNOWLEDGE_BUILDER_SKILL_DIRECTORY,
    PRESENTATION_GENERATE_SKILL_DIRECTORY,
    PRIVATE_DOMAIN_OPERATIONS_KNOWLEDGE_BUILDER_SKILL_DIRECTORY, REPORT_GENERATE_SKILL_DIRECTORY,
    RESEARCH_SKILL_DIRECTORY, SITE_SEARCH_SKILL_DIRECTORY, SUMMARY_SKILL_DIRECTORY,
    TRANSCRIPTION_GENERATE_SKILL_DIRECTORY, TRANSLATION_SKILL_DIRECTORY,
    TYPESETTING_SKILL_DIRECTORY, URL_PARSE_SKILL_DIRECTORY, VIDEO_GENERATE_SKILL_DIRECTORY,
    WEBPAGE_GENERATE_SKILL_DIRECTORY,
};

const VIDEO_GENERATE_SKILL_CONTENT: &str =
    include_str!("../../resources/default-skills/video_generate/SKILL.md");

const TRANSCRIPTION_GENERATE_SKILL_CONTENT: &str =
    include_str!("../../resources/default-skills/transcription_generate/SKILL.md");

const BROADCAST_GENERATE_SKILL_CONTENT: &str =
    include_str!("../../resources/default-skills/broadcast_generate/SKILL.md");

const COVER_GENERATE_SKILL_CONTENT: &str =
    include_str!("../../resources/default-skills/cover_generate/SKILL.md");

const MODAL_RESOURCE_SEARCH_SKILL_CONTENT: &str =
    include_str!("../../resources/default-skills/modal_resource_search/SKILL.md");

const IMAGE_GENERATE_SKILL_CONTENT: &str =
    include_str!("../../resources/default-skills/image_generate/SKILL.md");

const LIBRARY_SKILL_CONTENT: &str = include_str!("../../resources/default-skills/library/SKILL.md");

const URL_PARSE_SKILL_CONTENT: &str =
    include_str!("../../resources/default-skills/url_parse/SKILL.md");

const RESEARCH_SKILL_CONTENT: &str =
    include_str!("../../resources/default-skills/research/SKILL.md");

const REPORT_GENERATE_SKILL_CONTENT: &str =
    include_str!("../../resources/default-skills/report_generate/SKILL.md");

const SITE_SEARCH_SKILL_CONTENT: &str =
    include_str!("../../resources/default-skills/site_search/SKILL.md");

const PDF_READ_SKILL_CONTENT: &str =
    include_str!("../../resources/default-skills/pdf_read/SKILL.md");

const PRESENTATION_GENERATE_SKILL_CONTENT: &str =
    include_str!("../../resources/default-skills/presentation_generate/SKILL.md");

const FORM_GENERATE_SKILL_CONTENT: &str =
    include_str!("../../resources/default-skills/form_generate/SKILL.md");

const SUMMARY_SKILL_CONTENT: &str = include_str!("../../resources/default-skills/summary/SKILL.md");

const TRANSLATION_SKILL_CONTENT: &str =
    include_str!("../../resources/default-skills/translation/SKILL.md");

const ANALYSIS_SKILL_CONTENT: &str =
    include_str!("../../resources/default-skills/analysis/SKILL.md");

const SITE_SEARCH_ADAPTER_CATALOG_CONTENT: &str =
    include_str!("../../resources/default-skills/site_search/references/adapter-catalog.md");

#[cfg(test)]
const BUNDLED_SITE_ADAPTER_INDEX_CONTENT: &str =
    include_str!("../../resources/site-adapters/bundled/index.json");

const TYPESETTING_SKILL_CONTENT: &str =
    include_str!("../../resources/default-skills/typesetting/SKILL.md");

const WEBPAGE_GENERATE_SKILL_CONTENT: &str =
    include_str!("../../resources/default-skills/webpage_generate/SKILL.md");

const CONTENT_POST_WITH_COVER_SKILL_CONTENT: &str =
    include_str!("../../resources/default-skills/content_post_with_cover/SKILL.md");

const CONTENT_POST_WITH_COVER_WORKFLOW_CONTENT: &str =
    include_str!("../../resources/default-skills/content_post_with_cover/references/workflow.json");

const KNOWLEDGE_BUILDER_SKILL_CONTENT: &str =
    include_str!("../../resources/default-skills/knowledge_builder/SKILL.md");

const PERSONAL_IP_KNOWLEDGE_BUILDER_SKILL_CONTENT: &str =
    include_str!("../../resources/default-skills/personal-ip-knowledge-builder/SKILL.md");
const PERSONAL_IP_KNOWLEDGE_BUILDER_OPENAI_AGENT_CONTENT: &str =
    include_str!("../../resources/default-skills/personal-ip-knowledge-builder/agents/openai.yaml");
const PERSONAL_IP_KNOWLEDGE_BUILDER_TEMPLATE_CONTENT: &str = include_str!(
    "../../resources/default-skills/personal-ip-knowledge-builder/references/personal-ip-template.md"
);
const PERSONAL_IP_KNOWLEDGE_BUILDER_INTERVIEW_QUESTIONS_CONTENT: &str = include_str!(
    "../../resources/default-skills/personal-ip-knowledge-builder/references/interview-questions.md"
);
const PERSONAL_IP_KNOWLEDGE_BUILDER_QUALITY_CHECKLIST_CONTENT: &str = include_str!(
    "../../resources/default-skills/personal-ip-knowledge-builder/references/quality-checklist.md"
);
const PERSONAL_IP_KNOWLEDGE_BUILDER_SKELETON_CONTENT: &str = include_str!(
    "../../resources/default-skills/personal-ip-knowledge-builder/assets/personal-ip-knowledge-skeleton.md"
);
const PERSONAL_IP_KNOWLEDGE_BUILDER_DOCX_TO_MARKDOWN_CONTENT: &str = include_str!(
    "../../resources/default-skills/personal-ip-knowledge-builder/scripts/docx_to_markdown.py"
);

const BRAND_PERSONA_KNOWLEDGE_BUILDER_SKILL_CONTENT: &str =
    include_str!("../../resources/default-skills/brand-persona-knowledge-builder/SKILL.md");
const BRAND_PERSONA_KNOWLEDGE_BUILDER_OPENAI_AGENT_CONTENT: &str = include_str!(
    "../../resources/default-skills/brand-persona-knowledge-builder/agents/openai.yaml"
);
const BRAND_PERSONA_KNOWLEDGE_BUILDER_TEMPLATE_CONTENT: &str = include_str!(
    "../../resources/default-skills/brand-persona-knowledge-builder/references/brand-persona-template.md"
);
const BRAND_PERSONA_KNOWLEDGE_BUILDER_INTERVIEW_QUESTIONS_CONTENT: &str = include_str!(
    "../../resources/default-skills/brand-persona-knowledge-builder/references/interview-questions.md"
);
const BRAND_PERSONA_KNOWLEDGE_BUILDER_QUALITY_CHECKLIST_CONTENT: &str = include_str!(
    "../../resources/default-skills/brand-persona-knowledge-builder/references/quality-checklist.md"
);

const CONTENT_OPERATIONS_KNOWLEDGE_BUILDER_SKILL_CONTENT: &str =
    include_str!("../../resources/default-skills/content-operations-knowledge-builder/SKILL.md");
const CONTENT_OPERATIONS_KNOWLEDGE_BUILDER_OPENAI_AGENT_CONTENT: &str = include_str!(
    "../../resources/default-skills/content-operations-knowledge-builder/agents/openai.yaml"
);
const CONTENT_OPERATIONS_KNOWLEDGE_BUILDER_TEMPLATE_CONTENT: &str = include_str!(
    "../../resources/default-skills/content-operations-knowledge-builder/references/content-operations-template.md"
);
const CONTENT_OPERATIONS_KNOWLEDGE_BUILDER_QUALITY_CHECKLIST_CONTENT: &str = include_str!(
    "../../resources/default-skills/content-operations-knowledge-builder/references/content-operations-quality-checklist.md"
);

const PRIVATE_DOMAIN_OPERATIONS_KNOWLEDGE_BUILDER_SKILL_CONTENT: &str = include_str!(
    "../../resources/default-skills/private-domain-operations-knowledge-builder/SKILL.md"
);
const PRIVATE_DOMAIN_OPERATIONS_KNOWLEDGE_BUILDER_OPENAI_AGENT_CONTENT: &str = include_str!(
    "../../resources/default-skills/private-domain-operations-knowledge-builder/agents/openai.yaml"
);
const PRIVATE_DOMAIN_OPERATIONS_KNOWLEDGE_BUILDER_TEMPLATE_CONTENT: &str = include_str!(
    "../../resources/default-skills/private-domain-operations-knowledge-builder/references/private-domain-operations-template.md"
);
const PRIVATE_DOMAIN_OPERATIONS_KNOWLEDGE_BUILDER_QUALITY_CHECKLIST_CONTENT: &str = include_str!(
    "../../resources/default-skills/private-domain-operations-knowledge-builder/references/private-domain-operations-quality-checklist.md"
);

const LIVE_COMMERCE_OPERATIONS_KNOWLEDGE_BUILDER_SKILL_CONTENT: &str = include_str!(
    "../../resources/default-skills/live-commerce-operations-knowledge-builder/SKILL.md"
);
const LIVE_COMMERCE_OPERATIONS_KNOWLEDGE_BUILDER_OPENAI_AGENT_CONTENT: &str = include_str!(
    "../../resources/default-skills/live-commerce-operations-knowledge-builder/agents/openai.yaml"
);
const LIVE_COMMERCE_OPERATIONS_KNOWLEDGE_BUILDER_TEMPLATE_CONTENT: &str = include_str!(
    "../../resources/default-skills/live-commerce-operations-knowledge-builder/references/live-commerce-operations-template.md"
);
const LIVE_COMMERCE_OPERATIONS_KNOWLEDGE_BUILDER_QUALITY_CHECKLIST_CONTENT: &str = include_str!(
    "../../resources/default-skills/live-commerce-operations-knowledge-builder/references/live-commerce-operations-quality-checklist.md"
);

const CAMPAIGN_OPERATIONS_KNOWLEDGE_BUILDER_SKILL_CONTENT: &str =
    include_str!("../../resources/default-skills/campaign-operations-knowledge-builder/SKILL.md");
const CAMPAIGN_OPERATIONS_KNOWLEDGE_BUILDER_OPENAI_AGENT_CONTENT: &str = include_str!(
    "../../resources/default-skills/campaign-operations-knowledge-builder/agents/openai.yaml"
);
const CAMPAIGN_OPERATIONS_KNOWLEDGE_BUILDER_TEMPLATE_CONTENT: &str = include_str!(
    "../../resources/default-skills/campaign-operations-knowledge-builder/references/campaign-operations-template.md"
);
const CAMPAIGN_OPERATIONS_KNOWLEDGE_BUILDER_QUALITY_CHECKLIST_CONTENT: &str = include_str!(
    "../../resources/default-skills/campaign-operations-knowledge-builder/references/campaign-operations-quality-checklist.md"
);

const BRAND_PRODUCT_KNOWLEDGE_BUILDER_SKILL_CONTENT: &str =
    include_str!("../../resources/default-skills/brand-product-knowledge-builder/SKILL.md");
const BRAND_PRODUCT_KNOWLEDGE_BUILDER_OPENAI_AGENT_CONTENT: &str = include_str!(
    "../../resources/default-skills/brand-product-knowledge-builder/agents/openai.yaml"
);
const BRAND_PRODUCT_KNOWLEDGE_BUILDER_TEMPLATE_CONTENT: &str = include_str!(
    "../../resources/default-skills/brand-product-knowledge-builder/references/brand-product-template.md"
);
const BRAND_PRODUCT_KNOWLEDGE_BUILDER_QUALITY_CHECKLIST_CONTENT: &str = include_str!(
    "../../resources/default-skills/brand-product-knowledge-builder/references/brand-product-quality-checklist.md"
);

const ORGANIZATION_KNOWHOW_KNOWLEDGE_BUILDER_SKILL_CONTENT: &str =
    include_str!("../../resources/default-skills/organization-knowhow-knowledge-builder/SKILL.md");
const ORGANIZATION_KNOWHOW_KNOWLEDGE_BUILDER_OPENAI_AGENT_CONTENT: &str = include_str!(
    "../../resources/default-skills/organization-knowhow-knowledge-builder/agents/openai.yaml"
);
const ORGANIZATION_KNOWHOW_KNOWLEDGE_BUILDER_TEMPLATE_CONTENT: &str = include_str!(
    "../../resources/default-skills/organization-knowhow-knowledge-builder/references/organization-knowhow-template.md"
);
const ORGANIZATION_KNOWHOW_KNOWLEDGE_BUILDER_QUALITY_CHECKLIST_CONTENT: &str = include_str!(
    "../../resources/default-skills/organization-knowhow-knowledge-builder/references/organization-knowhow-quality-checklist.md"
);

const GROWTH_STRATEGY_KNOWLEDGE_BUILDER_SKILL_CONTENT: &str =
    include_str!("../../resources/default-skills/growth-strategy-knowledge-builder/SKILL.md");
const GROWTH_STRATEGY_KNOWLEDGE_BUILDER_OPENAI_AGENT_CONTENT: &str = include_str!(
    "../../resources/default-skills/growth-strategy-knowledge-builder/agents/openai.yaml"
);
const GROWTH_STRATEGY_KNOWLEDGE_BUILDER_TEMPLATE_CONTENT: &str = include_str!(
    "../../resources/default-skills/growth-strategy-knowledge-builder/references/growth-strategy-template.md"
);
const GROWTH_STRATEGY_KNOWLEDGE_BUILDER_QUALITY_CHECKLIST_CONTENT: &str = include_str!(
    "../../resources/default-skills/growth-strategy-knowledge-builder/references/growth-strategy-quality-checklist.md"
);

#[derive(Clone, Copy)]
struct BundledSkillFile {
    relative_path: &'static str,
    content: &'static str,
}

#[derive(Clone, Copy)]
struct BundledSkillDefinition {
    directory: &'static str,
    skill_content: &'static str,
    extra_files: &'static [BundledSkillFile],
}

const CONTENT_POST_WITH_COVER_EXTRA_FILES: &[BundledSkillFile] = &[BundledSkillFile {
    relative_path: "references/workflow.json",
    content: CONTENT_POST_WITH_COVER_WORKFLOW_CONTENT,
}];

const SITE_SEARCH_EXTRA_FILES: &[BundledSkillFile] = &[BundledSkillFile {
    relative_path: "references/adapter-catalog.md",
    content: SITE_SEARCH_ADAPTER_CATALOG_CONTENT,
}];

const PERSONAL_IP_KNOWLEDGE_BUILDER_EXTRA_FILES: &[BundledSkillFile] = &[
    BundledSkillFile {
        relative_path: "agents/openai.yaml",
        content: PERSONAL_IP_KNOWLEDGE_BUILDER_OPENAI_AGENT_CONTENT,
    },
    BundledSkillFile {
        relative_path: "references/personal-ip-template.md",
        content: PERSONAL_IP_KNOWLEDGE_BUILDER_TEMPLATE_CONTENT,
    },
    BundledSkillFile {
        relative_path: "references/interview-questions.md",
        content: PERSONAL_IP_KNOWLEDGE_BUILDER_INTERVIEW_QUESTIONS_CONTENT,
    },
    BundledSkillFile {
        relative_path: "references/quality-checklist.md",
        content: PERSONAL_IP_KNOWLEDGE_BUILDER_QUALITY_CHECKLIST_CONTENT,
    },
    BundledSkillFile {
        relative_path: "assets/personal-ip-knowledge-skeleton.md",
        content: PERSONAL_IP_KNOWLEDGE_BUILDER_SKELETON_CONTENT,
    },
    BundledSkillFile {
        relative_path: "scripts/docx_to_markdown.py",
        content: PERSONAL_IP_KNOWLEDGE_BUILDER_DOCX_TO_MARKDOWN_CONTENT,
    },
];

const BRAND_PERSONA_KNOWLEDGE_BUILDER_EXTRA_FILES: &[BundledSkillFile] = &[
    BundledSkillFile {
        relative_path: "agents/openai.yaml",
        content: BRAND_PERSONA_KNOWLEDGE_BUILDER_OPENAI_AGENT_CONTENT,
    },
    BundledSkillFile {
        relative_path: "references/brand-persona-template.md",
        content: BRAND_PERSONA_KNOWLEDGE_BUILDER_TEMPLATE_CONTENT,
    },
    BundledSkillFile {
        relative_path: "references/interview-questions.md",
        content: BRAND_PERSONA_KNOWLEDGE_BUILDER_INTERVIEW_QUESTIONS_CONTENT,
    },
    BundledSkillFile {
        relative_path: "references/quality-checklist.md",
        content: BRAND_PERSONA_KNOWLEDGE_BUILDER_QUALITY_CHECKLIST_CONTENT,
    },
];

const CONTENT_OPERATIONS_KNOWLEDGE_BUILDER_EXTRA_FILES: &[BundledSkillFile] = &[
    BundledSkillFile {
        relative_path: "agents/openai.yaml",
        content: CONTENT_OPERATIONS_KNOWLEDGE_BUILDER_OPENAI_AGENT_CONTENT,
    },
    BundledSkillFile {
        relative_path: "references/content-operations-template.md",
        content: CONTENT_OPERATIONS_KNOWLEDGE_BUILDER_TEMPLATE_CONTENT,
    },
    BundledSkillFile {
        relative_path: "references/content-operations-quality-checklist.md",
        content: CONTENT_OPERATIONS_KNOWLEDGE_BUILDER_QUALITY_CHECKLIST_CONTENT,
    },
];

const PRIVATE_DOMAIN_OPERATIONS_KNOWLEDGE_BUILDER_EXTRA_FILES: &[BundledSkillFile] = &[
    BundledSkillFile {
        relative_path: "agents/openai.yaml",
        content: PRIVATE_DOMAIN_OPERATIONS_KNOWLEDGE_BUILDER_OPENAI_AGENT_CONTENT,
    },
    BundledSkillFile {
        relative_path: "references/private-domain-operations-template.md",
        content: PRIVATE_DOMAIN_OPERATIONS_KNOWLEDGE_BUILDER_TEMPLATE_CONTENT,
    },
    BundledSkillFile {
        relative_path: "references/private-domain-operations-quality-checklist.md",
        content: PRIVATE_DOMAIN_OPERATIONS_KNOWLEDGE_BUILDER_QUALITY_CHECKLIST_CONTENT,
    },
];

const LIVE_COMMERCE_OPERATIONS_KNOWLEDGE_BUILDER_EXTRA_FILES: &[BundledSkillFile] = &[
    BundledSkillFile {
        relative_path: "agents/openai.yaml",
        content: LIVE_COMMERCE_OPERATIONS_KNOWLEDGE_BUILDER_OPENAI_AGENT_CONTENT,
    },
    BundledSkillFile {
        relative_path: "references/live-commerce-operations-template.md",
        content: LIVE_COMMERCE_OPERATIONS_KNOWLEDGE_BUILDER_TEMPLATE_CONTENT,
    },
    BundledSkillFile {
        relative_path: "references/live-commerce-operations-quality-checklist.md",
        content: LIVE_COMMERCE_OPERATIONS_KNOWLEDGE_BUILDER_QUALITY_CHECKLIST_CONTENT,
    },
];

const CAMPAIGN_OPERATIONS_KNOWLEDGE_BUILDER_EXTRA_FILES: &[BundledSkillFile] = &[
    BundledSkillFile {
        relative_path: "agents/openai.yaml",
        content: CAMPAIGN_OPERATIONS_KNOWLEDGE_BUILDER_OPENAI_AGENT_CONTENT,
    },
    BundledSkillFile {
        relative_path: "references/campaign-operations-template.md",
        content: CAMPAIGN_OPERATIONS_KNOWLEDGE_BUILDER_TEMPLATE_CONTENT,
    },
    BundledSkillFile {
        relative_path: "references/campaign-operations-quality-checklist.md",
        content: CAMPAIGN_OPERATIONS_KNOWLEDGE_BUILDER_QUALITY_CHECKLIST_CONTENT,
    },
];

const BRAND_PRODUCT_KNOWLEDGE_BUILDER_EXTRA_FILES: &[BundledSkillFile] = &[
    BundledSkillFile {
        relative_path: "agents/openai.yaml",
        content: BRAND_PRODUCT_KNOWLEDGE_BUILDER_OPENAI_AGENT_CONTENT,
    },
    BundledSkillFile {
        relative_path: "references/brand-product-template.md",
        content: BRAND_PRODUCT_KNOWLEDGE_BUILDER_TEMPLATE_CONTENT,
    },
    BundledSkillFile {
        relative_path: "references/brand-product-quality-checklist.md",
        content: BRAND_PRODUCT_KNOWLEDGE_BUILDER_QUALITY_CHECKLIST_CONTENT,
    },
];

const ORGANIZATION_KNOWHOW_KNOWLEDGE_BUILDER_EXTRA_FILES: &[BundledSkillFile] = &[
    BundledSkillFile {
        relative_path: "agents/openai.yaml",
        content: ORGANIZATION_KNOWHOW_KNOWLEDGE_BUILDER_OPENAI_AGENT_CONTENT,
    },
    BundledSkillFile {
        relative_path: "references/organization-knowhow-template.md",
        content: ORGANIZATION_KNOWHOW_KNOWLEDGE_BUILDER_TEMPLATE_CONTENT,
    },
    BundledSkillFile {
        relative_path: "references/organization-knowhow-quality-checklist.md",
        content: ORGANIZATION_KNOWHOW_KNOWLEDGE_BUILDER_QUALITY_CHECKLIST_CONTENT,
    },
];

const GROWTH_STRATEGY_KNOWLEDGE_BUILDER_EXTRA_FILES: &[BundledSkillFile] = &[
    BundledSkillFile {
        relative_path: "agents/openai.yaml",
        content: GROWTH_STRATEGY_KNOWLEDGE_BUILDER_OPENAI_AGENT_CONTENT,
    },
    BundledSkillFile {
        relative_path: "references/growth-strategy-template.md",
        content: GROWTH_STRATEGY_KNOWLEDGE_BUILDER_TEMPLATE_CONTENT,
    },
    BundledSkillFile {
        relative_path: "references/growth-strategy-quality-checklist.md",
        content: GROWTH_STRATEGY_KNOWLEDGE_BUILDER_QUALITY_CHECKLIST_CONTENT,
    },
];

fn default_skills() -> [BundledSkillDefinition; 30] {
    [
        BundledSkillDefinition {
            directory: VIDEO_GENERATE_SKILL_DIRECTORY,
            skill_content: VIDEO_GENERATE_SKILL_CONTENT,
            extra_files: &[],
        },
        BundledSkillDefinition {
            directory: TRANSCRIPTION_GENERATE_SKILL_DIRECTORY,
            skill_content: TRANSCRIPTION_GENERATE_SKILL_CONTENT,
            extra_files: &[],
        },
        BundledSkillDefinition {
            directory: BROADCAST_GENERATE_SKILL_DIRECTORY,
            skill_content: BROADCAST_GENERATE_SKILL_CONTENT,
            extra_files: &[],
        },
        BundledSkillDefinition {
            directory: COVER_GENERATE_SKILL_DIRECTORY,
            skill_content: COVER_GENERATE_SKILL_CONTENT,
            extra_files: &[],
        },
        BundledSkillDefinition {
            directory: MODAL_RESOURCE_SEARCH_SKILL_DIRECTORY,
            skill_content: MODAL_RESOURCE_SEARCH_SKILL_CONTENT,
            extra_files: &[],
        },
        BundledSkillDefinition {
            directory: IMAGE_GENERATE_SKILL_DIRECTORY,
            skill_content: IMAGE_GENERATE_SKILL_CONTENT,
            extra_files: &[],
        },
        BundledSkillDefinition {
            directory: LIBRARY_SKILL_DIRECTORY,
            skill_content: LIBRARY_SKILL_CONTENT,
            extra_files: &[],
        },
        BundledSkillDefinition {
            directory: URL_PARSE_SKILL_DIRECTORY,
            skill_content: URL_PARSE_SKILL_CONTENT,
            extra_files: &[],
        },
        BundledSkillDefinition {
            directory: RESEARCH_SKILL_DIRECTORY,
            skill_content: RESEARCH_SKILL_CONTENT,
            extra_files: &[],
        },
        BundledSkillDefinition {
            directory: REPORT_GENERATE_SKILL_DIRECTORY,
            skill_content: REPORT_GENERATE_SKILL_CONTENT,
            extra_files: &[],
        },
        BundledSkillDefinition {
            directory: SITE_SEARCH_SKILL_DIRECTORY,
            skill_content: SITE_SEARCH_SKILL_CONTENT,
            extra_files: SITE_SEARCH_EXTRA_FILES,
        },
        BundledSkillDefinition {
            directory: PDF_READ_SKILL_DIRECTORY,
            skill_content: PDF_READ_SKILL_CONTENT,
            extra_files: &[],
        },
        BundledSkillDefinition {
            directory: PRESENTATION_GENERATE_SKILL_DIRECTORY,
            skill_content: PRESENTATION_GENERATE_SKILL_CONTENT,
            extra_files: &[],
        },
        BundledSkillDefinition {
            directory: FORM_GENERATE_SKILL_DIRECTORY,
            skill_content: FORM_GENERATE_SKILL_CONTENT,
            extra_files: &[],
        },
        BundledSkillDefinition {
            directory: SUMMARY_SKILL_DIRECTORY,
            skill_content: SUMMARY_SKILL_CONTENT,
            extra_files: &[],
        },
        BundledSkillDefinition {
            directory: TRANSLATION_SKILL_DIRECTORY,
            skill_content: TRANSLATION_SKILL_CONTENT,
            extra_files: &[],
        },
        BundledSkillDefinition {
            directory: ANALYSIS_SKILL_DIRECTORY,
            skill_content: ANALYSIS_SKILL_CONTENT,
            extra_files: &[],
        },
        BundledSkillDefinition {
            directory: TYPESETTING_SKILL_DIRECTORY,
            skill_content: TYPESETTING_SKILL_CONTENT,
            extra_files: &[],
        },
        BundledSkillDefinition {
            directory: WEBPAGE_GENERATE_SKILL_DIRECTORY,
            skill_content: WEBPAGE_GENERATE_SKILL_CONTENT,
            extra_files: &[],
        },
        BundledSkillDefinition {
            directory: CONTENT_POST_WITH_COVER_SKILL_DIRECTORY,
            skill_content: CONTENT_POST_WITH_COVER_SKILL_CONTENT,
            extra_files: CONTENT_POST_WITH_COVER_EXTRA_FILES,
        },
        BundledSkillDefinition {
            directory: KNOWLEDGE_BUILDER_SKILL_DIRECTORY,
            skill_content: KNOWLEDGE_BUILDER_SKILL_CONTENT,
            extra_files: &[],
        },
        BundledSkillDefinition {
            directory: PERSONAL_IP_KNOWLEDGE_BUILDER_SKILL_DIRECTORY,
            skill_content: PERSONAL_IP_KNOWLEDGE_BUILDER_SKILL_CONTENT,
            extra_files: PERSONAL_IP_KNOWLEDGE_BUILDER_EXTRA_FILES,
        },
        BundledSkillDefinition {
            directory: BRAND_PERSONA_KNOWLEDGE_BUILDER_SKILL_DIRECTORY,
            skill_content: BRAND_PERSONA_KNOWLEDGE_BUILDER_SKILL_CONTENT,
            extra_files: BRAND_PERSONA_KNOWLEDGE_BUILDER_EXTRA_FILES,
        },
        BundledSkillDefinition {
            directory: CONTENT_OPERATIONS_KNOWLEDGE_BUILDER_SKILL_DIRECTORY,
            skill_content: CONTENT_OPERATIONS_KNOWLEDGE_BUILDER_SKILL_CONTENT,
            extra_files: CONTENT_OPERATIONS_KNOWLEDGE_BUILDER_EXTRA_FILES,
        },
        BundledSkillDefinition {
            directory: PRIVATE_DOMAIN_OPERATIONS_KNOWLEDGE_BUILDER_SKILL_DIRECTORY,
            skill_content: PRIVATE_DOMAIN_OPERATIONS_KNOWLEDGE_BUILDER_SKILL_CONTENT,
            extra_files: PRIVATE_DOMAIN_OPERATIONS_KNOWLEDGE_BUILDER_EXTRA_FILES,
        },
        BundledSkillDefinition {
            directory: LIVE_COMMERCE_OPERATIONS_KNOWLEDGE_BUILDER_SKILL_DIRECTORY,
            skill_content: LIVE_COMMERCE_OPERATIONS_KNOWLEDGE_BUILDER_SKILL_CONTENT,
            extra_files: LIVE_COMMERCE_OPERATIONS_KNOWLEDGE_BUILDER_EXTRA_FILES,
        },
        BundledSkillDefinition {
            directory: CAMPAIGN_OPERATIONS_KNOWLEDGE_BUILDER_SKILL_DIRECTORY,
            skill_content: CAMPAIGN_OPERATIONS_KNOWLEDGE_BUILDER_SKILL_CONTENT,
            extra_files: CAMPAIGN_OPERATIONS_KNOWLEDGE_BUILDER_EXTRA_FILES,
        },
        BundledSkillDefinition {
            directory: BRAND_PRODUCT_KNOWLEDGE_BUILDER_SKILL_DIRECTORY,
            skill_content: BRAND_PRODUCT_KNOWLEDGE_BUILDER_SKILL_CONTENT,
            extra_files: BRAND_PRODUCT_KNOWLEDGE_BUILDER_EXTRA_FILES,
        },
        BundledSkillDefinition {
            directory: ORGANIZATION_KNOWHOW_KNOWLEDGE_BUILDER_SKILL_DIRECTORY,
            skill_content: ORGANIZATION_KNOWHOW_KNOWLEDGE_BUILDER_SKILL_CONTENT,
            extra_files: ORGANIZATION_KNOWHOW_KNOWLEDGE_BUILDER_EXTRA_FILES,
        },
        BundledSkillDefinition {
            directory: GROWTH_STRATEGY_KNOWLEDGE_BUILDER_SKILL_DIRECTORY,
            skill_content: GROWTH_STRATEGY_KNOWLEDGE_BUILDER_SKILL_CONTENT,
            extra_files: GROWTH_STRATEGY_KNOWLEDGE_BUILDER_EXTRA_FILES,
        },
    ]
}

#[cfg(test)]
fn skills_root_from_base(base_dir: &Path) -> PathBuf {
    base_dir.join("skills")
}

/// 从 SKILL.md 内容中提取版本号，返回 (major, minor, patch)
fn parse_skill_version(content: &str) -> Option<(u32, u32, u32)> {
    let manifest = parse_skill_manifest_from_content(content).ok()?;
    let version_str = manifest
        .metadata
        .metadata
        .get("lime_version")
        .cloned()
        .or_else(|| manifest.raw_string("version"))?;
    let parts: Vec<&str> = version_str.split('.').collect();
    if parts.len() == 3 {
        let major = parts[0].trim().parse::<u32>().ok()?;
        let minor = parts[1].trim().parse::<u32>().ok()?;
        let patch = parts[2].trim().parse::<u32>().ok()?;
        return Some((major, minor, patch));
    }
    None
}

fn ensure_default_local_skills_in_dir(skills_root: &Path) -> Result<Vec<String>, String> {
    fs::create_dir_all(&skills_root)
        .map_err(|e| format!("创建技能目录失败 {}: {e}", skills_root.display()))?;

    let mut installed = Vec::new();
    for bundled_skill in default_skills() {
        let skill_name = bundled_skill.directory;
        let skill_content = bundled_skill.skill_content;
        let skill_dir = skills_root.join(skill_name);
        let skill_md_path = skill_dir.join("SKILL.md");
        if skill_md_path.exists() {
            // 比较版本号，若内置版本更新则自动升级
            let existing_content = fs::read_to_string(&skill_md_path).unwrap_or_default();
            let existing_version = parse_skill_version(&existing_content);
            let embedded_version = parse_skill_version(skill_content);
            match (existing_version, embedded_version) {
                (Some(ev), Some(bv)) if bv > ev => {
                    // 内置版本更新，覆盖升级
                    fs::write(&skill_md_path, skill_content).map_err(|e| {
                        format!("升级默认技能失败 {}: {e}", skill_md_path.display())
                    })?;
                    sync_bundled_skill_files(&skill_dir, bundled_skill.extra_files)?;
                    installed.push(skill_name.to_string());
                }
                _ => {
                    sync_bundled_skill_files(&skill_dir, bundled_skill.extra_files)?;
                    continue;
                } // 版本相同或无法比较，跳过
            }
            continue;
        }

        fs::create_dir_all(&skill_dir)
            .map_err(|e| format!("创建默认技能目录失败 {}: {e}", skill_dir.display()))?;
        fs::write(&skill_md_path, skill_content)
            .map_err(|e| format!("写入默认技能失败 {}: {e}", skill_md_path.display()))?;
        sync_bundled_skill_files(&skill_dir, bundled_skill.extra_files)?;
        installed.push(skill_name.to_string());
    }
    Ok(installed)
}

fn sync_bundled_skill_files(
    skill_dir: &Path,
    extra_files: &[BundledSkillFile],
) -> Result<(), String> {
    for extra_file in extra_files {
        let target_path = skill_dir.join(extra_file.relative_path);
        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("创建技能资源目录失败 {}: {e}", parent.display()))?;
        }
        fs::write(&target_path, extra_file.content)
            .map_err(|e| format!("写入技能资源失败 {}: {e}", target_path.display()))?;
    }
    Ok(())
}

pub fn ensure_default_local_skills() -> Result<Vec<String>, String> {
    let skills_root = app_paths::resolve_skills_dir()?;
    ensure_default_local_skills_in_dir(&skills_root)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_install_default_skill_when_missing() {
        let temp = tempfile::tempdir().expect("create temp dir");
        let skills_root = skills_root_from_base(temp.path());
        let installed = ensure_default_local_skills_in_dir(&skills_root).expect("install");
        assert!(installed.contains(&CONTENT_POST_WITH_COVER_SKILL_DIRECTORY.to_string()));

        let skill_md_path = skills_root
            .join(CONTENT_POST_WITH_COVER_SKILL_DIRECTORY)
            .join("SKILL.md");
        assert!(skill_md_path.exists());
    }

    #[test]
    fn should_not_overwrite_existing_skill() {
        let temp = tempfile::tempdir().expect("create temp dir");
        let skills_root = skills_root_from_base(temp.path());
        let skill_dir = skills_root.join(CONTENT_POST_WITH_COVER_SKILL_DIRECTORY);
        fs::create_dir_all(&skill_dir).expect("create skill dir");
        let skill_md_path = skill_dir.join("SKILL.md");
        // 无版本号的自定义内容不应被覆盖
        let existing_content = "custom skill content";
        fs::write(&skill_md_path, existing_content).expect("write custom skill");

        let installed = ensure_default_local_skills_in_dir(&skills_root).expect("install");
        assert!(
            !installed.contains(&CONTENT_POST_WITH_COVER_SKILL_DIRECTORY.to_string()),
            "无版本信息的已存在 skill 不应被重新安装"
        );

        let current_content = fs::read_to_string(&skill_md_path).expect("read skill");
        assert_eq!(current_content, existing_content);
    }

    #[test]
    fn should_upgrade_skill_when_newer_version_available() {
        let temp = tempfile::tempdir().expect("create temp dir");
        let skills_root = skills_root_from_base(temp.path());
        let skill_dir = skills_root.join(CONTENT_POST_WITH_COVER_SKILL_DIRECTORY);
        fs::create_dir_all(&skill_dir).expect("create skill dir");
        let skill_md_path = skill_dir.join("SKILL.md");
        // 旧版本内容
        let old_content = "---\nname: content_post_with_cover\nversion: 1.0.0\n---\nold content";
        fs::write(&skill_md_path, old_content).expect("write old skill");

        let installed = ensure_default_local_skills_in_dir(&skills_root).expect("install");
        assert!(
            installed.contains(&CONTENT_POST_WITH_COVER_SKILL_DIRECTORY.to_string()),
            "内置版本更新时应自动升级"
        );

        let current_content = fs::read_to_string(&skill_md_path).expect("read skill");
        assert_ne!(current_content, old_content, "旧版本内容应被替换");
        assert!(
            current_content.contains("lime_workflow_ref"),
            "升级后应包含 workflow 引用字段"
        );
    }

    #[test]
    fn should_parse_skill_version() {
        assert_eq!(
            parse_skill_version("---\nversion: 1.3.0\n---\n"),
            Some((1, 3, 0))
        );
        assert_eq!(
            parse_skill_version("---\nname: test\nversion: 2.10.5\n---\n"),
            Some((2, 10, 5))
        );
        assert_eq!(parse_skill_version("no version here"), None);
    }

    #[test]
    fn should_embed_social_image_tool_contract_in_default_skill() {
        assert!(CONTENT_POST_WITH_COVER_SKILL_CONTENT
            .contains("allowed-tools: social_generate_cover_image, search_query"));
        assert!(CONTENT_POST_WITH_COVER_SKILL_CONTENT.contains("lime_surface: workbench"));
        assert!(CONTENT_POST_WITH_COVER_SKILL_CONTENT.contains("**配图说明**"));
        assert!(CONTENT_POST_WITH_COVER_SKILL_CONTENT.contains("状态：{成功/失败}"));
        assert!(CONTENT_POST_WITH_COVER_SKILL_CONTENT.contains("lime_workflow_ref"));
        assert!(CONTENT_POST_WITH_COVER_WORKFLOW_CONTENT.contains("\"id\": \"research\""));
        assert!(KNOWLEDGE_BUILDER_SKILL_CONTENT.contains("name: knowledge_builder"));
        assert!(KNOWLEDGE_BUILDER_SKILL_CONTENT.contains("license: Apache-2.0"));
        assert!(KNOWLEDGE_BUILDER_SKILL_CONTENT.contains("agentKnowledge: \">=0.6.0\""));
        assert!(
            KNOWLEDGE_BUILDER_SKILL_CONTENT.contains("allowed-tools: list_directory, read_file")
        );
        assert!(KNOWLEDGE_BUILDER_SKILL_CONTENT.contains("lime_version: 1.2.0"));
        assert!(KNOWLEDGE_BUILDER_SKILL_CONTENT.contains("Lime_compat_delegate: \"true\""));
        assert!(KNOWLEDGE_BUILDER_SKILL_CONTENT.contains("不要生成 `compiled/brief.md`"));
        assert!(KNOWLEDGE_BUILDER_SKILL_CONTENT.contains("不要生成 `wiki/`"));
        assert!(KNOWLEDGE_BUILDER_SKILL_CONTENT.contains("personal-ip-knowledge-builder"));
        assert!(
            KNOWLEDGE_BUILDER_SKILL_CONTENT.contains("knowledge_builder 是 deprecated 兼容兜底")
        );
        assert!(!KNOWLEDGE_BUILDER_SKILL_CONTENT.contains("wiki/product.md"));
        assert!(!KNOWLEDGE_BUILDER_SKILL_CONTENT.contains("wiki/workflows.md"));
        assert!(!KNOWLEDGE_BUILDER_SKILL_CONTENT.contains("wiki/experiments.md"));
        assert!(
            !KNOWLEDGE_BUILDER_SKILL_CONTENT.contains("runs/quality-report-{yyyyMMdd-HHmmss}.md")
        );
        assert!(PERSONAL_IP_KNOWLEDGE_BUILDER_SKILL_CONTENT
            .contains("name: personal-ip-knowledge-builder"));
        assert!(PERSONAL_IP_KNOWLEDGE_BUILDER_SKILL_CONTENT
            .contains("Lime_agent_knowledge_runtime_mode: \"persona\""));
        assert!(PERSONAL_IP_KNOWLEDGE_BUILDER_TEMPLATE_CONTENT.contains("# 个人 IP 知识库标准模板"));
        assert!(PERSONAL_IP_KNOWLEDGE_BUILDER_TEMPLATE_CONTENT.contains("平台迁移与新赛道判断"));
        assert!(PERSONAL_IP_KNOWLEDGE_BUILDER_TEMPLATE_CONTENT.contains("技术、AI 与效率判断"));
        assert!(
            PERSONAL_IP_KNOWLEDGE_BUILDER_QUALITY_CHECKLIST_CONTENT.contains("Runtime 安全边界")
        );
        assert!(BRAND_PERSONA_KNOWLEDGE_BUILDER_SKILL_CONTENT
            .contains("name: brand-persona-knowledge-builder"));
        assert!(BRAND_PERSONA_KNOWLEDGE_BUILDER_SKILL_CONTENT
            .contains("Lime_agent_knowledge_runtime_mode: \"persona\""));
        assert!(
            BRAND_PERSONA_KNOWLEDGE_BUILDER_TEMPLATE_CONTENT.contains("# 品牌人设知识库标准模板")
        );
        assert!(CONTENT_OPERATIONS_KNOWLEDGE_BUILDER_SKILL_CONTENT
            .contains("name: content-operations-knowledge-builder"));
        assert!(PRIVATE_DOMAIN_OPERATIONS_KNOWLEDGE_BUILDER_SKILL_CONTENT
            .contains("name: private-domain-operations-knowledge-builder"));
        assert!(LIVE_COMMERCE_OPERATIONS_KNOWLEDGE_BUILDER_SKILL_CONTENT
            .contains("name: live-commerce-operations-knowledge-builder"));
        assert!(CAMPAIGN_OPERATIONS_KNOWLEDGE_BUILDER_SKILL_CONTENT
            .contains("name: campaign-operations-knowledge-builder"));
        assert!(BRAND_PRODUCT_KNOWLEDGE_BUILDER_SKILL_CONTENT
            .contains("name: brand-product-knowledge-builder"));
        assert!(ORGANIZATION_KNOWHOW_KNOWLEDGE_BUILDER_SKILL_CONTENT
            .contains("name: organization-knowhow-knowledge-builder"));
        assert!(GROWTH_STRATEGY_KNOWLEDGE_BUILDER_SKILL_CONTENT
            .contains("name: growth-strategy-knowledge-builder"));
        assert!(CONTENT_OPERATIONS_KNOWLEDGE_BUILDER_TEMPLATE_CONTENT
            .contains("# 内容运营知识库标准模板"));
        assert!(
            BRAND_PRODUCT_KNOWLEDGE_BUILDER_TEMPLATE_CONTENT.contains("# 品牌产品知识库标准模板")
        );
    }

    #[test]
    fn should_embed_core_default_skills() {
        assert!(VIDEO_GENERATE_SKILL_CONTENT.contains("name: video_generate"));
        assert!(TRANSCRIPTION_GENERATE_SKILL_CONTENT.contains("name: transcription_generate"));
        assert!(BROADCAST_GENERATE_SKILL_CONTENT.contains("name: broadcast_generate"));
        assert!(COVER_GENERATE_SKILL_CONTENT.contains("name: cover_generate"));
        assert!(COVER_GENERATE_SKILL_CONTENT.contains(
            "allowed-tools: social_generate_cover_image, Bash, lime_create_cover_generation_task"
        ));
        assert!(COVER_GENERATE_SKILL_CONTENT
            .contains("优先调用 `Bash` 执行 `lime task create cover --json` 创建任务"));
        assert!(MODAL_RESOURCE_SEARCH_SKILL_CONTENT.contains("name: modal_resource_search"));
        assert!(IMAGE_GENERATE_SKILL_CONTENT.contains("name: image_generate"));
        assert!(IMAGE_GENERATE_SKILL_CONTENT
            .contains("allowed-tools: lime_create_image_generation_task"));
        assert!(IMAGE_GENERATE_SKILL_CONTENT
            .contains("必须直接调用 `lime_create_image_generation_task` 创建真实图片任务"));
        assert!(IMAGE_GENERATE_SKILL_CONTENT
            .contains("必须直接传扁平任务对象参数；不要包成 `{\"image_task\": ...}`"));
        assert!(IMAGE_GENERATE_SKILL_CONTENT
            .contains("不要通过 `Bash` 拼接 `lime media image generate --json`"));
        assert!(!IMAGE_GENERATE_SKILL_CONTENT
            .contains("allowed-tools: Bash, lime_create_image_generation_task"));
        assert!(!IMAGE_GENERATE_SKILL_CONTENT
            .contains("优先调用 `Bash` 执行 `lime media image generate --json` 提交任务"));
        assert!(LIBRARY_SKILL_CONTENT.contains("name: library"));
        assert!(URL_PARSE_SKILL_CONTENT.contains("name: url_parse"));
        assert!(RESEARCH_SKILL_CONTENT.contains("name: research"));
        assert!(REPORT_GENERATE_SKILL_CONTENT.contains("name: report_generate"));
        assert!(REPORT_GENERATE_SKILL_CONTENT.contains("allowed-tools: search_query"));
        assert!(SITE_SEARCH_SKILL_CONTENT.contains("name: site_search"));
        assert!(PDF_READ_SKILL_CONTENT.contains("name: pdf_read"));
        assert!(PDF_READ_SKILL_CONTENT.contains("allowed-tools: list_directory, read_file"));
        assert!(FORM_GENERATE_SKILL_CONTENT.contains("name: form_generate"));
        assert!(FORM_GENERATE_SKILL_CONTENT.contains("lime_surface: workbench"));
        assert!(FORM_GENERATE_SKILL_CONTENT.contains("```a2ui"));
        assert!(SUMMARY_SKILL_CONTENT.contains("name: summary"));
        assert!(SUMMARY_SKILL_CONTENT.contains("allowed-tools: list_directory, read_file"));
        assert!(SITE_SEARCH_ADAPTER_CATALOG_CONTENT.contains("`github/search`"));
        assert!(SITE_SEARCH_ADAPTER_CATALOG_CONTENT.contains("`zhihu/hot`"));
        assert!(TYPESETTING_SKILL_CONTENT.contains("name: typesetting"));
        assert!(WEBPAGE_GENERATE_SKILL_CONTENT.contains("name: webpage_generate"));
        assert!(KNOWLEDGE_BUILDER_SKILL_CONTENT.contains("name: knowledge_builder"));
        assert!(PERSONAL_IP_KNOWLEDGE_BUILDER_SKILL_CONTENT
            .contains("name: personal-ip-knowledge-builder"));
        assert!(BRAND_PERSONA_KNOWLEDGE_BUILDER_SKILL_CONTENT
            .contains("name: brand-persona-knowledge-builder"));
        assert!(VIDEO_GENERATE_SKILL_CONTENT.contains("lime_surface: workbench"));
        assert!(TRANSCRIPTION_GENERATE_SKILL_CONTENT.contains("lime_surface: workbench"));
        assert!(BROADCAST_GENERATE_SKILL_CONTENT.contains("lime_surface: workbench"));
        assert!(COVER_GENERATE_SKILL_CONTENT.contains("lime_surface: workbench"));
        assert!(MODAL_RESOURCE_SEARCH_SKILL_CONTENT.contains("lime_surface: workbench"));
        assert!(IMAGE_GENERATE_SKILL_CONTENT.contains("lime_surface: workbench"));
        assert!(TYPESETTING_SKILL_CONTENT.contains("lime_surface: workbench"));
        assert!(WEBPAGE_GENERATE_SKILL_CONTENT.contains("lime_surface: workbench"));
        assert!(KNOWLEDGE_BUILDER_SKILL_CONTENT.contains("lime_surface: workbench"));
        assert!(PERSONAL_IP_KNOWLEDGE_BUILDER_SKILL_CONTENT.contains("lime_surface: workbench"));
        assert!(BRAND_PERSONA_KNOWLEDGE_BUILDER_SKILL_CONTENT.contains("lime_surface: workbench"));
        assert!(
            CONTENT_OPERATIONS_KNOWLEDGE_BUILDER_SKILL_CONTENT.contains("lime_surface: workbench")
        );
        assert!(PRIVATE_DOMAIN_OPERATIONS_KNOWLEDGE_BUILDER_SKILL_CONTENT
            .contains("lime_surface: workbench"));
        assert!(LIVE_COMMERCE_OPERATIONS_KNOWLEDGE_BUILDER_SKILL_CONTENT
            .contains("lime_surface: workbench"));
        assert!(
            CAMPAIGN_OPERATIONS_KNOWLEDGE_BUILDER_SKILL_CONTENT.contains("lime_surface: workbench")
        );
        assert!(BRAND_PRODUCT_KNOWLEDGE_BUILDER_SKILL_CONTENT.contains("lime_surface: workbench"));
        assert!(ORGANIZATION_KNOWHOW_KNOWLEDGE_BUILDER_SKILL_CONTENT
            .contains("lime_surface: workbench"));
        assert!(GROWTH_STRATEGY_KNOWLEDGE_BUILDER_SKILL_CONTENT.contains("lime_surface: workbench"));
        assert!(LIBRARY_SKILL_CONTENT.contains("lime_surface: chat"));
        assert!(URL_PARSE_SKILL_CONTENT.contains("lime_surface: chat"));
        assert!(RESEARCH_SKILL_CONTENT.contains("lime_surface: chat"));
        assert!(REPORT_GENERATE_SKILL_CONTENT.contains("lime_surface: chat"));
        assert!(SITE_SEARCH_SKILL_CONTENT.contains("lime_surface: chat"));
        assert!(PDF_READ_SKILL_CONTENT.contains("lime_surface: chat"));
        assert!(SUMMARY_SKILL_CONTENT.contains("lime_surface: chat"));
    }

    #[test]
    fn should_sync_extra_files_for_social_post_skill() {
        let temp = tempfile::tempdir().expect("create temp dir");
        let skills_root = skills_root_from_base(temp.path());
        ensure_default_local_skills_in_dir(&skills_root).expect("install");

        let workflow_path = skills_root
            .join(CONTENT_POST_WITH_COVER_SKILL_DIRECTORY)
            .join("references")
            .join("workflow.json");
        assert!(workflow_path.exists());
        let workflow_content = fs::read_to_string(workflow_path).expect("read workflow");
        assert!(workflow_content.contains("\"cover\""));
    }

    #[test]
    fn should_sync_extra_files_for_site_search_skill() {
        let temp = tempfile::tempdir().expect("create temp dir");
        let skills_root = skills_root_from_base(temp.path());
        ensure_default_local_skills_in_dir(&skills_root).expect("install");

        let catalog_path = skills_root
            .join(SITE_SEARCH_SKILL_DIRECTORY)
            .join("references")
            .join("adapter-catalog.md");
        assert!(catalog_path.exists());
        let catalog_content = fs::read_to_string(catalog_path).expect("read catalog");
        assert!(catalog_content.contains("`github/search`"));
        assert!(catalog_content.contains("`yahoo-finance/quote`"));
    }

    #[test]
    fn should_sync_extra_files_for_personal_ip_knowledge_builder_skill() {
        let temp = tempfile::tempdir().expect("create temp dir");
        let skills_root = skills_root_from_base(temp.path());
        ensure_default_local_skills_in_dir(&skills_root).expect("install");

        let skill_dir = skills_root.join(PERSONAL_IP_KNOWLEDGE_BUILDER_SKILL_DIRECTORY);
        let template_path = skill_dir.join("references").join("personal-ip-template.md");
        let script_path = skill_dir.join("scripts").join("docx_to_markdown.py");
        assert!(template_path.exists());
        assert!(script_path.exists());

        let template_content = fs::read_to_string(template_path).expect("read template");
        assert!(template_content.contains("# 个人 IP 知识库标准模板"));
    }

    #[test]
    fn should_sync_extra_files_for_brand_persona_knowledge_builder_skill() {
        let temp = tempfile::tempdir().expect("create temp dir");
        let skills_root = skills_root_from_base(temp.path());
        ensure_default_local_skills_in_dir(&skills_root).expect("install");

        let skill_dir = skills_root.join(BRAND_PERSONA_KNOWLEDGE_BUILDER_SKILL_DIRECTORY);
        let template_path = skill_dir
            .join("references")
            .join("brand-persona-template.md");
        let interview_path = skill_dir.join("references").join("interview-questions.md");
        let agent_path = skill_dir.join("agents").join("openai.yaml");
        assert!(template_path.exists());
        assert!(interview_path.exists());
        assert!(agent_path.exists());

        let template_content = fs::read_to_string(template_path).expect("read template");
        assert!(template_content.contains("# 品牌人设知识库标准模板"));
    }

    #[test]
    fn should_sync_extra_files_for_data_knowledge_builder_skills() {
        let temp = tempfile::tempdir().expect("create temp dir");
        let skills_root = skills_root_from_base(temp.path());
        ensure_default_local_skills_in_dir(&skills_root).expect("install");

        for (directory, template_name, expected_title) in [
            (
                CONTENT_OPERATIONS_KNOWLEDGE_BUILDER_SKILL_DIRECTORY,
                "content-operations-template.md",
                "# 内容运营知识库标准模板",
            ),
            (
                PRIVATE_DOMAIN_OPERATIONS_KNOWLEDGE_BUILDER_SKILL_DIRECTORY,
                "private-domain-operations-template.md",
                "# 私域 / 社群运营知识库标准模板",
            ),
            (
                LIVE_COMMERCE_OPERATIONS_KNOWLEDGE_BUILDER_SKILL_DIRECTORY,
                "live-commerce-operations-template.md",
                "# 直播运营知识库标准模板",
            ),
            (
                CAMPAIGN_OPERATIONS_KNOWLEDGE_BUILDER_SKILL_DIRECTORY,
                "campaign-operations-template.md",
                "# 活动 / Campaign 运营知识库标准模板",
            ),
            (
                BRAND_PRODUCT_KNOWLEDGE_BUILDER_SKILL_DIRECTORY,
                "brand-product-template.md",
                "# 品牌产品知识库标准模板",
            ),
            (
                ORGANIZATION_KNOWHOW_KNOWLEDGE_BUILDER_SKILL_DIRECTORY,
                "organization-knowhow-template.md",
                "# 组织经验知识库标准模板",
            ),
            (
                GROWTH_STRATEGY_KNOWLEDGE_BUILDER_SKILL_DIRECTORY,
                "growth-strategy-template.md",
                "# 增长策略知识库标准模板",
            ),
        ] {
            let skill_dir = skills_root.join(directory);
            let template_path = skill_dir.join("references").join(template_name);
            let agent_path = skill_dir.join("agents").join("openai.yaml");
            assert!(template_path.exists(), "{template_name} should be synced");
            assert!(
                agent_path.exists(),
                "{directory} openai.yaml should be synced"
            );

            let template_content = fs::read_to_string(template_path).expect("read template");
            assert!(template_content.contains(expected_title));
        }
    }

    #[test]
    fn should_cover_all_bundled_site_adapters_in_site_search_catalog() {
        let bundled_index =
            serde_json::from_str::<serde_json::Value>(BUNDLED_SITE_ADAPTER_INDEX_CONTENT)
                .expect("parse bundled site adapter index");
        let adapters = bundled_index["adapters"]
            .as_array()
            .expect("bundled site adapter index should contain adapters");

        for adapter in adapters {
            let adapter_name = adapter["name"]
                .as_str()
                .expect("bundled site adapter should contain name");
            assert!(
                SITE_SEARCH_ADAPTER_CATALOG_CONTENT.contains(&format!("`{adapter_name}`")),
                "site_search adapter 目录缺少 bundled adapter: {adapter_name}"
            );
        }
    }
}
