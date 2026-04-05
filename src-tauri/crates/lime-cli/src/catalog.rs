use lime_media_runtime::TaskType;

pub const CLI_ROOT_SKILL_PATH: &str = "tools/lime-cli/SKILL.md";
pub const ROOT_AFTER_HELP: &str = "\
AI Agent 技能:
  lime skill list
  lime skill show broadcast

任务生命周期:
  draft -> pending_submit -> queued -> running -> partial -> succeeded|failed|cancelled

示例:
  lime task create image --prompt \"未来城市插图\" --size \"1024x1024\"
  lime task create transcription --source-path \"/tmp/interview.wav\" --output-format srt
  lime task create broadcast --title \"播客摘要\" --content \"原文内容\"
  lime task list --family image --status running
  lime task status <task-id>
  lime task attempts <task-id>
  lime task list --status failed
  lime task retry <task-id>";

pub const TASK_AFTER_HELP: &str = "\
常用命令:
  lime task create image --prompt \"未来城市插图\"
  lime task create transcription --source-url \"https://example.com/demo.mp4\"
  lime task create url-parse --url \"https://example.com\" --summary \"摘要\"
  lime task list --family image
  lime task list --type broadcast
  lime task status <task-id>
  lime task attempts <task-id>
  lime task retry <task-id>";

pub const SKILL_AFTER_HELP: &str = "\
使用建议:
  先运行 `lime skill list` 查看可用业务域
  再运行 `lime skill show <name>` 获取推荐命令和文档入口";

#[derive(Debug, Clone, Copy)]
pub struct TaskCatalogEntry {
    pub command_name: &'static str,
    pub task_type: TaskType,
    pub description: &'static str,
    pub skill_name: &'static str,
    pub docs_dir: &'static str,
    pub example: &'static str,
}

pub const TASK_ENTRIES: &[TaskCatalogEntry] = &[
    TaskCatalogEntry {
        command_name: "image",
        task_type: TaskType::ImageGenerate,
        description: "根据提示词创建普通配图任务。",
        skill_name: "image_generate",
        docs_dir: "src-tauri/resources/default-skills/image_generate",
        example: "lime task create image --prompt \"未来城市插图\" --size \"1024x1024\"",
    },
    TaskCatalogEntry {
        command_name: "cover",
        task_type: TaskType::CoverGenerate,
        description: "创建平台封面图任务，适合文章和视频封面。",
        skill_name: "cover_generate",
        docs_dir: "src-tauri/resources/default-skills/cover_generate",
        example: "lime task create cover --prompt \"科技播客封面\" --platform xiaohongshu",
    },
    TaskCatalogEntry {
        command_name: "video",
        task_type: TaskType::VideoGenerate,
        description: "创建视频生成任务记录，不伪造已完成结果。",
        skill_name: "video_generate",
        docs_dir: "src-tauri/resources/default-skills/video_generate",
        example: "lime task create video --prompt \"产品发布短视频\" --aspect-ratio 9:16",
    },
    TaskCatalogEntry {
        command_name: "transcription",
        task_type: TaskType::TranscriptionGenerate,
        description: "创建音频或视频转写任务记录，不伪造已完成结果。",
        skill_name: "transcription_generate",
        docs_dir: "src-tauri/resources/default-skills/transcription_generate",
        example:
            "lime task create transcription --source-path \"/tmp/interview.wav\" --output-format srt",
    },
    TaskCatalogEntry {
        command_name: "broadcast",
        task_type: TaskType::BroadcastGenerate,
        description: "把文稿整理成可播报文本材料任务。",
        skill_name: "broadcast_generate",
        docs_dir: "tools/lime-cli/domains/broadcast",
        example: "lime task create broadcast --title \"AI 周报\" --content \"原文内容\"",
    },
    TaskCatalogEntry {
        command_name: "url-parse",
        task_type: TaskType::UrlParse,
        description: "把外部链接解析为可阅读、可引用的文本任务。",
        skill_name: "url_parse",
        docs_dir: "tools/lime-cli/domains/url-parse",
        example: "lime task create url-parse --url \"https://example.com\" --summary \"摘要\"",
    },
    TaskCatalogEntry {
        command_name: "typesetting",
        task_type: TaskType::Typesetting,
        description: "创建文稿排版优化任务。",
        skill_name: "typesetting",
        docs_dir: "tools/lime-cli/domains/typesetting",
        example: "lime task create typesetting --target-platform xiaohongshu --content \"原文\"",
    },
    TaskCatalogEntry {
        command_name: "resource-search",
        task_type: TaskType::ModalResourceSearch,
        description: "创建图片、BGM、音效等素材检索任务。",
        skill_name: "modal_resource_search",
        docs_dir: "tools/lime-cli/domains/resource-search",
        example:
            "lime task create resource-search --resource-type image --query 城市夜景 --usage 封面",
    },
];

pub fn find_task_entry(value: &str) -> Option<&'static TaskCatalogEntry> {
    let normalized = value.trim().to_ascii_lowercase();
    TASK_ENTRIES.iter().find(|entry| {
        entry.command_name == normalized
            || entry.task_type.as_str() == normalized
            || entry.skill_name == normalized
    })
}

#[derive(Debug, Clone, Copy)]
pub struct SkillCatalogEntry {
    pub name: &'static str,
    pub description: &'static str,
    pub recommended_command: &'static str,
    pub skill_path: &'static str,
    pub references: &'static [&'static str],
}

pub const SKILL_ENTRIES: &[SkillCatalogEntry] = &[
    SkillCatalogEntry {
        name: "lime-cli",
        description: "Lime CLI 平台技能，负责统一任务命令、状态、重试与队列语义。",
        recommended_command: "lime --help",
        skill_path: CLI_ROOT_SKILL_PATH,
        references: &[
            "tools/lime-cli/references/overview.md",
            "tools/lime-cli/references/command-model.md",
            "tools/lime-cli/references/task-lifecycle.md",
        ],
    },
    SkillCatalogEntry {
        name: "image_generate",
        description: "普通配图任务技能。",
        recommended_command: "lime task create image --prompt \"...\"",
        skill_path: "src-tauri/resources/default-skills/image_generate/SKILL.md",
        references: &[],
    },
    SkillCatalogEntry {
        name: "cover_generate",
        description: "封面图任务技能。",
        recommended_command: "lime task create cover --prompt \"...\" --platform xiaohongshu",
        skill_path: "src-tauri/resources/default-skills/cover_generate/SKILL.md",
        references: &[],
    },
    SkillCatalogEntry {
        name: "video_generate",
        description: "视频任务编排技能。",
        recommended_command: "lime task create video --prompt \"...\" --aspect-ratio 9:16",
        skill_path: "src-tauri/resources/default-skills/video_generate/SKILL.md",
        references: &[],
    },
    SkillCatalogEntry {
        name: "transcription_generate",
        description: "音频或视频转写任务技能。",
        recommended_command:
            "lime task create transcription --source-path \"/tmp/interview.wav\" --output-format srt",
        skill_path: "src-tauri/resources/default-skills/transcription_generate/SKILL.md",
        references: &[],
    },
    SkillCatalogEntry {
        name: "broadcast_generate",
        description: "播客文本整理任务技能。",
        recommended_command: "lime task create broadcast --title \"...\" --content \"...\"",
        skill_path: "tools/lime-cli/domains/broadcast/SKILL.md",
        references: &["tools/lime-cli/domains/broadcast/references/create.md"],
    },
    SkillCatalogEntry {
        name: "url_parse",
        description: "链接解析任务技能。",
        recommended_command:
            "lime task create url-parse --url \"https://example.com\" --summary \"...\"",
        skill_path: "tools/lime-cli/domains/url-parse/SKILL.md",
        references: &["tools/lime-cli/domains/url-parse/references/create.md"],
    },
    SkillCatalogEntry {
        name: "typesetting",
        description: "排版优化任务技能。",
        recommended_command:
            "lime task create typesetting --target-platform xiaohongshu --content \"...\"",
        skill_path: "tools/lime-cli/domains/typesetting/SKILL.md",
        references: &["tools/lime-cli/domains/typesetting/references/create.md"],
    },
    SkillCatalogEntry {
        name: "modal_resource_search",
        description: "素材检索任务技能。",
        recommended_command:
            "lime task create resource-search --resource-type image --query 城市夜景 --usage 封面",
        skill_path: "tools/lime-cli/domains/resource-search/SKILL.md",
        references: &["tools/lime-cli/domains/resource-search/references/create.md"],
    },
];

pub fn find_skill_entry(value: &str) -> Option<&'static SkillCatalogEntry> {
    let normalized = value.trim().to_ascii_lowercase();
    SKILL_ENTRIES
        .iter()
        .find(|entry| entry.name.eq_ignore_ascii_case(&normalized))
}
