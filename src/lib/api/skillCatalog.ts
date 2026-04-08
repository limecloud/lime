import {
  hasOemCloudSession,
  resolveOemCloudRuntimeContext,
} from "./oemCloudRuntime";
import {
  getSeededServiceSkillCatalog,
  parseServiceSkillCatalog,
  type ServiceSkillExecutorBinding,
  type ServiceSkillItem,
  type ServiceSkillSiteCapabilityBinding,
  type ServiceSkillSurfaceScope,
} from "./serviceSkills";

export type SkillCatalogExecutionKind =
  | "native_skill"
  | "agent_turn"
  | "automation_job"
  | "cloud_scene"
  | "site_adapter";

export interface SkillCatalogExecution {
  kind: SkillCatalogExecutionKind;
  siteAdapterBinding?: ServiceSkillSiteCapabilityBinding;
}

export type SkillCatalogEntryKind = "skill" | "command" | "scene";

export type SkillCatalogRenderResultKind =
  | "text"
  | "tool_timeline"
  | "image_gallery"
  | "artifact"
  | "form"
  | "table_report";

export type SkillCatalogRenderDetailKind =
  | "json"
  | "task_detail"
  | "artifact_detail"
  | "media_detail"
  | "scene_detail";

export interface SkillCatalogRenderContract {
  resultKind: SkillCatalogRenderResultKind;
  detailKind: SkillCatalogRenderDetailKind;
  supportsStreaming?: boolean;
  supportsTimeline?: boolean;
}

export type SkillCatalogCommandTriggerMode = "mention" | "slash";

export interface SkillCatalogCommandTrigger {
  mode: SkillCatalogCommandTriggerMode;
  prefix: string;
}

export interface SkillCatalogSkillEntry {
  id: string;
  kind: "skill";
  title: string;
  summary: string;
  skillId: string;
  groupKey: string;
  aliases?: string[];
  surfaceScopes?: ServiceSkillSurfaceScope[];
  execution: SkillCatalogExecution;
  renderContract?: SkillCatalogRenderContract;
}

export interface SkillCatalogCommandEntry {
  id: string;
  kind: "command";
  title: string;
  summary: string;
  commandKey: string;
  aliases?: string[];
  surfaceScopes?: ServiceSkillSurfaceScope[];
  triggers: SkillCatalogCommandTrigger[];
  binding?: {
    skillId?: string;
    executionKind?:
      | SkillCatalogExecutionKind
      | "task_queue"
      | "server_api"
      | "cli";
  };
  renderContract?: SkillCatalogRenderContract;
}

export interface SkillCatalogSceneEntry {
  id: string;
  kind: "scene";
  title: string;
  summary: string;
  sceneKey: string;
  commandPrefix: string;
  aliases?: string[];
  surfaceScopes?: ServiceSkillSurfaceScope[];
  linkedSkillId?: string;
  executionKind?: SkillCatalogExecutionKind | "scene";
  renderContract?: SkillCatalogRenderContract;
}

export type SkillCatalogEntry =
  | SkillCatalogSkillEntry
  | SkillCatalogCommandEntry
  | SkillCatalogSceneEntry;

export interface SkillCatalogGroup {
  key: string;
  title: string;
  summary: string;
  entryHint?: string;
  themeTarget?: string;
  sort: number;
  itemCount: number;
}

export interface SkillCatalogItem extends ServiceSkillItem {
  groupKey: string;
  execution: SkillCatalogExecution;
}

export interface SkillCatalog {
  version: string;
  tenantId: string;
  syncedAt: string;
  groups: SkillCatalogGroup[];
  items: SkillCatalogItem[];
  entries: SkillCatalogEntry[];
}

export type SkillCatalogChangeSource =
  | "seeded_fallback"
  | "bootstrap_sync"
  | "manual_override"
  | "cache_clear";

interface SkillCatalogResponseEnvelope {
  code?: number;
  message?: string;
  data?: unknown;
}

const SKILL_CATALOG_STORAGE_KEY = "lime:skill-catalog:v1";
export const SKILL_CATALOG_CHANGED_EVENT = "lime:skill-catalog-changed";
const SEEDED_SKILL_GROUP_PRESETS = [
  {
    key: "github",
    title: "GitHub",
    summary: "围绕仓库与 Issue 的只读研究技能，直接复用真实登录态抓线索。",
    entryHint:
      "先选一个 GitHub 技能，再补关键词或仓库名，结果会直接回流到当前工作区。",
    themeTarget: "general",
    sort: 10,
  },
  {
    key: "zhihu",
    title: "知乎",
    summary: "围绕热榜与内容检索的只读研究技能，适合快速做选题与观点线索扫描。",
    entryHint: "从热榜或关键词入口开始，先抓一轮线索，再回到 Claw 继续整理。",
    themeTarget: "general",
    sort: 20,
  },
  {
    key: "linux-do",
    title: "Linux.do",
    summary: "围绕社区分类与热门讨论的只读研究技能，适合跟踪开发者社区动态。",
    entryHint: "先确定是看分类还是看热门，再直接在真实社区页面采集结果。",
    themeTarget: "general",
    sort: 30,
  },
  {
    key: "bilibili",
    title: "Bilibili",
    summary:
      "围绕视频检索的只读站点技能，适合快速抓视频线索并回流到当前工作区。",
    entryHint: "先给检索词，再直接复用当前浏览器页面做一轮视频线索采集。",
    themeTarget: "general",
    sort: 40,
  },
  {
    key: "36kr",
    title: "36Kr",
    summary: "围绕快讯和资讯流的只读站点技能，适合快速收集行业动态和新闻线索。",
    entryHint: "先确定主题范围，再直接采集快讯结果回到 Claw 继续整理。",
    themeTarget: "general",
    sort: 50,
  },
  {
    key: "smzdm",
    title: "什么值得买",
    summary:
      "围绕消费和商品检索的只读站点技能，适合快速抓价格、优惠与选品线索。",
    entryHint: "输入商品关键词后直接采集结果，再回到 Claw 做整理和对比。",
    themeTarget: "general",
    sort: 60,
  },
  {
    key: "yahoo-finance",
    title: "Yahoo Finance",
    summary: "围绕股票与行情摘要的只读站点技能，适合快速拉一轮金融研究线索。",
    entryHint: "输入股票代码后直接抓取行情摘要，再在工作区继续分析。",
    themeTarget: "general",
    sort: 70,
  },
  {
    key: "general",
    title: "通用技能",
    summary:
      "保留现有写作、调研、趋势选题与增长跟踪能力，作为站点组之外的创作技能入口。",
    entryHint:
      "如果任务不依赖站点登录态，直接从这里选一个创作技能进入工作模式。",
    themeTarget: "general",
    sort: 90,
  },
] as const;
const SEEDED_SKILL_CATALOG_VERSION =
  "client-seed-skill-catalog-2026-04-08-creation-copy";
const SEEDED_COMMAND_ENTRY_DEFINITIONS = [
  {
    id: "command:image_generate",
    title: "配图",
    summary: "根据文字描述生成新的图片结果。",
    commandKey: "image_generate",
    aliases: ["image", "img", "图片", "生图"],
    triggers: [{ mode: "mention", prefix: "@配图" }],
    binding: {
      skillId: "image_generate",
      executionKind: "task_queue" as const,
    },
    renderContract: {
      resultKind: "image_gallery" as const,
      detailKind: "media_detail" as const,
      supportsStreaming: true,
      supportsTimeline: true,
    },
  },
  {
    id: "command:cover_generate",
    title: "封面",
    summary: "根据主题生成平台封面图任务。",
    commandKey: "cover_generate",
    aliases: ["cover", "fengmian", "封面", "封面图", "头图"],
    triggers: [{ mode: "mention", prefix: "@封面" }],
    binding: {
      skillId: "cover_generate",
      executionKind: "task_queue" as const,
    },
    renderContract: {
      resultKind: "image_gallery" as const,
      detailKind: "media_detail" as const,
      supportsStreaming: true,
      supportsTimeline: true,
    },
  },
  {
    id: "command:poster_generate",
    title: "海报",
    summary: "围绕活动、产品或主题生成可直接使用的海报视觉。",
    commandKey: "poster_generate",
    aliases: ["poster", "haibao", "海报", "活动海报", "宣传海报"],
    triggers: [{ mode: "mention", prefix: "@海报" }],
    binding: {
      skillId: "image_generate",
      executionKind: "task_queue" as const,
    },
    renderContract: {
      resultKind: "image_gallery" as const,
      detailKind: "media_detail" as const,
      supportsStreaming: true,
      supportsTimeline: true,
    },
  },
  {
    id: "command:image_edit",
    title: "修图",
    summary: "编辑已有图片并生成新的结果图。",
    commandKey: "image_edit",
    aliases: ["edit", "xiutu", "修图", "改图", "图片编辑"],
    triggers: [{ mode: "mention", prefix: "@修图" }],
    binding: {
      skillId: "image_generate",
      executionKind: "task_queue" as const,
    },
    renderContract: {
      resultKind: "image_gallery" as const,
      detailKind: "media_detail" as const,
      supportsStreaming: true,
      supportsTimeline: true,
    },
  },
  {
    id: "command:image_variation",
    title: "重绘",
    summary: "基于已有图片或参考图继续重绘新的结果图。",
    commandKey: "image_variation",
    aliases: ["variation", "variant", "zhonghui", "重绘", "图片重绘", "变体"],
    triggers: [{ mode: "mention", prefix: "@重绘" }],
    binding: {
      skillId: "image_generate",
      executionKind: "task_queue" as const,
    },
    renderContract: {
      resultKind: "image_gallery" as const,
      detailKind: "media_detail" as const,
      supportsStreaming: true,
      supportsTimeline: true,
    },
  },
  {
    id: "command:video_generate",
    title: "视频",
    summary: "根据文字描述提交视频生成任务。",
    commandKey: "video_generate",
    aliases: ["video", "shipin", "视频", "短视频", "生成视频"],
    triggers: [{ mode: "mention", prefix: "@视频" }],
    binding: {
      skillId: "video_generate",
      executionKind: "task_queue" as const,
    },
    renderContract: {
      resultKind: "tool_timeline" as const,
      detailKind: "media_detail" as const,
      supportsStreaming: true,
      supportsTimeline: true,
    },
  },
  {
    id: "command:voice_runtime",
    title: "配音",
    summary: "把视频或旁白需求切到云端配音技能主链，优先提交服务型技能运行。",
    commandKey: "voice_runtime",
    aliases: [
      "voice",
      "dubbing",
      "dub",
      "peiyin",
      "配音",
      "旁白",
      "视频配音",
      "语音配音",
    ],
    triggers: [{ mode: "mention", prefix: "@配音" }],
    binding: {
      skillId: "cloud-video-dubbing",
      executionKind: "cloud_scene" as const,
    },
    renderContract: {
      resultKind: "tool_timeline" as const,
      detailKind: "scene_detail" as const,
      supportsStreaming: true,
      supportsTimeline: true,
    },
  },
  {
    id: "command:browser_runtime",
    title: "浏览器",
    summary: "把本次输入显式切到真实浏览器执行主链，而不是退回 WebSearch 或普通聊天。",
    commandKey: "browser_runtime",
    aliases: [
      "browser",
      "browse",
      "liulanqi",
      "浏览器",
      "网页操作",
      "打开网页",
      "网页任务",
    ],
    triggers: [{ mode: "mention", prefix: "@浏览器" }],
    binding: {
      executionKind: "agent_turn" as const,
    },
    renderContract: {
      resultKind: "tool_timeline" as const,
      detailKind: "json" as const,
      supportsStreaming: true,
      supportsTimeline: true,
    },
  },
  {
    id: "command:presentation_generate",
    title: "PPT",
    summary: "根据目标说明生成一份可直接讲述和继续导出的演示稿草稿。",
    commandKey: "presentation_generate",
    aliases: [
      "ppt",
      "presentation",
      "slides",
      "deck",
      "yanjiang",
      "演示",
      "演示稿",
      "路演",
    ],
    triggers: [{ mode: "mention", prefix: "@PPT" }],
    binding: {
      skillId: "presentation_generate",
      executionKind: "agent_turn" as const,
    },
    renderContract: {
      resultKind: "artifact" as const,
      detailKind: "artifact_detail" as const,
      supportsStreaming: true,
      supportsTimeline: true,
    },
  },
  {
    id: "command:form_generate",
    title: "表单",
    summary: "根据目标说明生成可直接在聊天区渲染的 A2UI 表单。",
    commandKey: "form_generate",
    aliases: ["form", "survey", "biaodan", "wenjuan", "表单", "问卷", "报名表"],
    triggers: [{ mode: "mention", prefix: "@表单" }],
    binding: {
      skillId: "form_generate",
      executionKind: "agent_turn" as const,
    },
    renderContract: {
      resultKind: "form" as const,
      detailKind: "json" as const,
      supportsStreaming: true,
      supportsTimeline: true,
    },
  },
  {
    id: "command:webpage_generate",
    title: "网页",
    summary: "根据目标说明生成可直接预览的单文件网页。",
    commandKey: "webpage_generate",
    aliases: [
      "webpage",
      "web",
      "wangye",
      "网页",
      "落地页",
      "landing",
      "官网",
      "活动页",
    ],
    triggers: [{ mode: "mention", prefix: "@网页" }],
    binding: {
      skillId: "webpage_generate",
      executionKind: "agent_turn" as const,
    },
    renderContract: {
      resultKind: "artifact" as const,
      detailKind: "artifact_detail" as const,
      supportsStreaming: true,
      supportsTimeline: true,
    },
  },
  {
    id: "command:code_runtime",
    title: "代码",
    summary: "把本次输入切到代码编排主链，优先调度工具、子代理与代码团队协作。",
    commandKey: "code_runtime",
    aliases: [
      "code",
      "coding",
      "kaifa",
      "daima",
      "代码",
      "开发",
      "代码评审",
      "修复",
      "重构",
    ],
    triggers: [{ mode: "mention", prefix: "@代码" }],
    binding: {
      executionKind: "agent_turn" as const,
    },
    renderContract: {
      resultKind: "tool_timeline" as const,
      detailKind: "json" as const,
      supportsStreaming: true,
      supportsTimeline: true,
    },
  },
  {
    id: "command:channel_preview_runtime",
    title: "渠道预览",
    summary: "把当前内容整理成适合指定平台预览的预览稿与封面建议。",
    commandKey: "channel_preview_runtime",
    aliases: [
      "preview",
      "qudaoyulan",
      "预览",
      "渠道预览",
      "平台预览",
      "首屏预览",
    ],
    triggers: [{ mode: "mention", prefix: "@渠道预览" }],
    binding: {
      skillId: "content_post_with_cover",
      executionKind: "native_skill" as const,
    },
    renderContract: {
      resultKind: "artifact" as const,
      detailKind: "artifact_detail" as const,
      supportsStreaming: true,
      supportsTimeline: true,
    },
  },
  {
    id: "command:upload_runtime",
    title: "上传",
    summary: "把当前内容整理成适合目标平台直接上传的上传稿与素材清单。",
    commandKey: "upload_runtime",
    aliases: [
      "upload",
      "shangchuan",
      "上传",
      "上架",
      "内容上传",
      "平台上传",
    ],
    triggers: [{ mode: "mention", prefix: "@上传" }],
    binding: {
      skillId: "content_post_with_cover",
      executionKind: "native_skill" as const,
    },
    renderContract: {
      resultKind: "artifact" as const,
      detailKind: "artifact_detail" as const,
      supportsStreaming: true,
      supportsTimeline: true,
    },
  },
  {
    id: "command:publish_runtime",
    title: "发布",
    summary: "把当前内容导入发布工作流，继续整理发布稿、发布包与平台检查。",
    commandKey: "publish_runtime",
    aliases: [
      "publish",
      "fabu",
      "fawen",
      "投稿",
      "发文",
      "发布",
      "发布稿",
      "发布前检查",
    ],
    triggers: [{ mode: "mention", prefix: "@发布" }],
    binding: {
      skillId: "content_post_with_cover",
      executionKind: "native_skill" as const,
    },
    renderContract: {
      resultKind: "artifact" as const,
      detailKind: "artifact_detail" as const,
      supportsStreaming: true,
      supportsTimeline: true,
    },
  },
  {
    id: "command:broadcast_generate",
    title: "播报",
    summary: "把现有文稿整理成适合口播或播客转换的文本任务。",
    commandKey: "broadcast_generate",
    aliases: ["broadcast", "bobao", "播报", "播客", "口播", "podcast"],
    triggers: [{ mode: "mention", prefix: "@播报" }],
    binding: {
      skillId: "broadcast_generate",
      executionKind: "cli" as const,
    },
    renderContract: {
      resultKind: "tool_timeline" as const,
      detailKind: "task_detail" as const,
      supportsStreaming: true,
      supportsTimeline: true,
    },
  },
  {
    id: "command:modal_resource_search",
    title: "素材",
    summary: "为当前内容提交图片、BGM、音效等资源检索任务。",
    commandKey: "modal_resource_search",
    aliases: ["resource", "sucai", "素材", "资源", "素材检索", "资源检索"],
    triggers: [{ mode: "mention", prefix: "@素材" }],
    binding: {
      skillId: "modal_resource_search",
      executionKind: "cli" as const,
    },
    renderContract: {
      resultKind: "tool_timeline" as const,
      detailKind: "task_detail" as const,
      supportsStreaming: true,
      supportsTimeline: true,
    },
  },
  {
    id: "command:research",
    title: "搜索",
    summary: "针对当前主题执行联网检索与轻量调研，返回可引用结论与来源。",
    commandKey: "research",
    aliases: [
      "search",
      "research",
      "sousuo",
      "搜索",
      "检索",
      "调研",
      "联网搜索",
      "最新信息",
    ],
    triggers: [{ mode: "mention", prefix: "@搜索" }],
    binding: {
      skillId: "research",
      executionKind: "agent_turn" as const,
    },
    renderContract: {
      resultKind: "tool_timeline" as const,
      detailKind: "json" as const,
      supportsStreaming: true,
      supportsTimeline: true,
    },
  },
  {
    id: "command:deep_search",
    title: "深搜",
    summary: "针对当前主题执行多轮扩搜与深度调研，输出事实、推断与待确认项。",
    commandKey: "deep_search",
    aliases: [
      "deep",
      "deepsearch",
      "shensou",
      "深搜",
      "深度搜索",
      "深入调研",
      "多轮搜索",
    ],
    triggers: [{ mode: "mention", prefix: "@深搜" }],
    binding: {
      skillId: "research",
      executionKind: "agent_turn" as const,
    },
    renderContract: {
      resultKind: "tool_timeline" as const,
      detailKind: "json" as const,
      supportsStreaming: true,
      supportsTimeline: true,
    },
  },
  {
    id: "command:research_report",
    title: "研报",
    summary: "围绕主题执行多轮调研并输出结构化研究报告。",
    commandKey: "research_report",
    aliases: [
      "report",
      "research_report",
      "yanbao",
      "研报",
      "研究报告",
      "行业报告",
      "竞品报告",
    ],
    triggers: [{ mode: "mention", prefix: "@研报" }],
    binding: {
      skillId: "report_generate",
      executionKind: "agent_turn" as const,
    },
    renderContract: {
      resultKind: "tool_timeline" as const,
      detailKind: "artifact_detail" as const,
      supportsStreaming: true,
      supportsTimeline: true,
    },
  },
  {
    id: "command:competitor_research",
    title: "竞品",
    summary: "围绕竞品对象执行多轮调研，并输出结构化竞品分析与对比结论。",
    commandKey: "competitor_research",
    aliases: [
      "competitor",
      "competitive",
      "jingpin",
      "竞品",
      "竞品分析",
      "竞品研究",
      "产品对比",
      "竞对",
    ],
    triggers: [{ mode: "mention", prefix: "@竞品" }],
    binding: {
      skillId: "report_generate",
      executionKind: "agent_turn" as const,
    },
    renderContract: {
      resultKind: "tool_timeline" as const,
      detailKind: "artifact_detail" as const,
      supportsStreaming: true,
      supportsTimeline: true,
    },
  },
  {
    id: "command:site_search",
    title: "站点搜索",
    summary: "在指定站点内检索内容，优先复用 site adapter 与真实浏览器上下文。",
    commandKey: "site_search",
    aliases: [
      "site",
      "site_search",
      "zhandian",
      "站点",
      "站点搜索",
      "GitHub 搜索",
      "知乎搜索",
      "B站搜索",
    ],
    triggers: [{ mode: "mention", prefix: "@站点搜索" }],
    binding: {
      skillId: "site_search",
      executionKind: "agent_turn" as const,
    },
    renderContract: {
      resultKind: "tool_timeline" as const,
      detailKind: "json" as const,
      supportsStreaming: true,
      supportsTimeline: true,
    },
  },
  {
    id: "command:read_pdf",
    title: "读PDF",
    summary:
      "读取本地或工作区 PDF，并通过真实文件读取 timeline 输出结构化解读。",
    commandKey: "read_pdf",
    aliases: [
      "pdf",
      "read_pdf",
      "dupdf",
      "读PDF",
      "PDF 解读",
      "PDF 阅读",
      "PDF 总结",
    ],
    triggers: [{ mode: "mention", prefix: "@读PDF" }],
    binding: {
      skillId: "pdf_read",
      executionKind: "agent_turn" as const,
    },
    renderContract: {
      resultKind: "tool_timeline" as const,
      detailKind: "json" as const,
      supportsStreaming: true,
      supportsTimeline: true,
    },
  },
  {
    id: "command:summary",
    title: "总结",
    summary: "提炼当前文本、对话或上下文中的关键结论与重点。",
    commandKey: "summary",
    aliases: ["summary", "summarize", "zongjie", "总结", "摘要", "提炼重点"],
    triggers: [{ mode: "mention", prefix: "@总结" }],
    binding: {
      skillId: "summary",
      executionKind: "agent_turn" as const,
    },
    renderContract: {
      resultKind: "tool_timeline" as const,
      detailKind: "json" as const,
      supportsStreaming: true,
      supportsTimeline: true,
    },
  },
  {
    id: "command:translation",
    title: "翻译",
    summary: "翻译当前文本、对话或文件内容，保留真实 skill / tool timeline。",
    commandKey: "translation",
    aliases: [
      "translate",
      "translation",
      "fanyi",
      "翻译",
      "中译英",
      "英译中",
      "多语言翻译",
    ],
    triggers: [{ mode: "mention", prefix: "@翻译" }],
    binding: {
      skillId: "translation",
      executionKind: "agent_turn" as const,
    },
    renderContract: {
      resultKind: "tool_timeline" as const,
      detailKind: "json" as const,
      supportsStreaming: true,
      supportsTimeline: true,
    },
  },
  {
    id: "command:analysis",
    title: "分析",
    summary: "分析当前文本、对话或文件内容，输出判断、依据与待确认项。",
    commandKey: "analysis",
    aliases: ["analysis", "analyze", "fenxi", "分析", "拆解", "研判"],
    triggers: [{ mode: "mention", prefix: "@分析" }],
    binding: {
      skillId: "analysis",
      executionKind: "agent_turn" as const,
    },
    renderContract: {
      resultKind: "tool_timeline" as const,
      detailKind: "json" as const,
      supportsStreaming: true,
      supportsTimeline: true,
    },
  },
  {
    id: "command:publish_compliance",
    title: "发布合规",
    summary: "围绕广告法、版权与平台发布风险检查当前内容是否适合发布。",
    commandKey: "publish_compliance",
    aliases: [
      "compliance",
      "hegui",
      "发布合规",
      "内容合规",
      "广告法",
      "版权风险",
    ],
    triggers: [{ mode: "mention", prefix: "@发布合规" }],
    binding: {
      skillId: "analysis",
      executionKind: "agent_turn" as const,
    },
    renderContract: {
      resultKind: "tool_timeline" as const,
      detailKind: "json" as const,
      supportsStreaming: true,
      supportsTimeline: true,
    },
  },
  {
    id: "command:transcription_generate",
    title: "转写",
    summary: "把音频或视频来源提交为转写任务。",
    commandKey: "transcription_generate",
    aliases: ["transcribe", "zhuanxie", "转写", "逐字稿", "字幕", "语音转文字"],
    triggers: [{ mode: "mention", prefix: "@转写" }],
    binding: {
      skillId: "transcription_generate",
      executionKind: "task_queue" as const,
    },
    renderContract: {
      resultKind: "artifact" as const,
      detailKind: "artifact_detail" as const,
      supportsStreaming: true,
      supportsTimeline: true,
    },
  },
  {
    id: "command:web_scrape",
    title: "抓取",
    summary: "抓取网页正文并提交为可追踪的网页内容任务。",
    commandKey: "web_scrape",
    aliases: [
      "scrape",
      "web_scrape",
      "zhuaqu",
      "抓取",
      "网页抓取",
      "网页正文",
      "Web Scrape",
    ],
    triggers: [{ mode: "mention", prefix: "@抓取" }],
    binding: {
      skillId: "url_parse",
      executionKind: "task_queue" as const,
    },
    renderContract: {
      resultKind: "artifact" as const,
      detailKind: "artifact_detail" as const,
      supportsStreaming: true,
      supportsTimeline: true,
    },
  },
  {
    id: "command:webpage_read",
    title: "网页读取",
    summary: "读取页面或链接内容，并提交为可追踪的网页阅读任务。",
    commandKey: "webpage_read",
    aliases: [
      "web_read",
      "page_read",
      "wangyeduqu",
      "网页读取",
      "读取网页",
      "页面读取",
      "网页总结",
    ],
    triggers: [{ mode: "mention", prefix: "@网页读取" }],
    binding: {
      skillId: "url_parse",
      executionKind: "task_queue" as const,
    },
    renderContract: {
      resultKind: "artifact" as const,
      detailKind: "artifact_detail" as const,
      supportsStreaming: true,
      supportsTimeline: true,
    },
  },
  {
    id: "command:url_parse",
    title: "链接解析",
    summary: "解析网页链接并提交为可追踪的文本任务。",
    commandKey: "url_parse",
    aliases: ["url", "url_parse", "链接", "链接解析", "网页解析"],
    triggers: [{ mode: "mention", prefix: "@链接解析" }],
    binding: {
      skillId: "url_parse",
      executionKind: "task_queue" as const,
    },
    renderContract: {
      resultKind: "artifact" as const,
      detailKind: "artifact_detail" as const,
      supportsStreaming: true,
      supportsTimeline: true,
    },
  },
  {
    id: "command:typesetting",
    title: "排版",
    summary: "把现有文稿整理成更适合发布与阅读的排版任务。",
    commandKey: "typesetting",
    aliases: ["typesetting", "paiban", "排版", "排版优化", "整理排版"],
    triggers: [{ mode: "mention", prefix: "@排版" }],
    binding: {
      skillId: "typesetting",
      executionKind: "cli" as const,
    },
    renderContract: {
      resultKind: "tool_timeline" as const,
      detailKind: "task_detail" as const,
      supportsStreaming: true,
      supportsTimeline: true,
    },
  },
] as const;
const SITE_GROUP_TITLE_OVERRIDES: Record<string, string> = {
  github: "GitHub",
  zhihu: "知乎",
  "linux-do": "Linux.do",
  bilibili: "Bilibili",
  "36kr": "36Kr",
  smzdm: "什么值得买",
  "yahoo-finance": "Yahoo Finance",
  general: "通用技能",
};

function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneSkillCatalog(catalog: SkillCatalog): SkillCatalog {
  return {
    ...catalog,
    groups: catalog.groups.map((group) => ({ ...group })),
    items: catalog.items.map((item) => ({
      ...cloneJsonValue(item),
      execution: {
        ...item.execution,
        siteAdapterBinding: item.execution.siteAdapterBinding
          ? cloneJsonValue(item.execution.siteAdapterBinding)
          : undefined,
      },
    })),
    entries: (catalog.entries || []).map((entry) => cloneJsonValue(entry)),
  };
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resolveSkillCatalogExecutionKind(
  binding: ServiceSkillExecutorBinding,
  siteBinding?: ServiceSkillSiteCapabilityBinding,
): SkillCatalogExecutionKind {
  if (siteBinding || binding === "browser_assist") {
    return "site_adapter";
  }
  switch (binding) {
    case "native_skill":
      return "native_skill";
    case "automation_job":
      return "automation_job";
    case "cloud_scene":
      return "cloud_scene";
    default:
      return "agent_turn";
  }
}

function parseCommandBindingExecutionKind(
  value: unknown,
): SkillCatalogExecutionKind | "task_queue" | "server_api" | "cli" | undefined {
  const normalized = normalizeText(value);
  if (
    normalized === "native_skill" ||
    normalized === "agent_turn" ||
    normalized === "automation_job" ||
    normalized === "cloud_scene" ||
    normalized === "site_adapter" ||
    normalized === "task_queue" ||
    normalized === "server_api" ||
    normalized === "cli"
  ) {
    return normalized;
  }
  return undefined;
}

function parseSceneExecutionKind(
  value: unknown,
): SkillCatalogSceneEntry["executionKind"] | undefined {
  const normalized = normalizeText(value);
  if (
    normalized === "native_skill" ||
    normalized === "agent_turn" ||
    normalized === "automation_job" ||
    normalized === "cloud_scene" ||
    normalized === "site_adapter" ||
    normalized === "scene"
  ) {
    return normalized;
  }
  return undefined;
}

function normalizeSearchAliases(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const aliases = value
    .map((item) => normalizeText(item))
    .filter((item): item is string => Boolean(item));

  return aliases.length > 0 ? aliases : undefined;
}

function normalizeSurfaceScopes(
  value: unknown,
): ServiceSkillSurfaceScope[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const scopes = value.filter(
    (item): item is ServiceSkillSurfaceScope =>
      item === "home" || item === "mention" || item === "workspace",
  );

  return scopes.length > 0 ? scopes : undefined;
}

function parseRenderContract(
  value: unknown,
): SkillCatalogRenderContract | undefined {
  if (!isPlainRecord(value)) {
    return undefined;
  }

  const resultKind = normalizeText(value.resultKind);
  const detailKind = normalizeText(value.detailKind);
  if (
    resultKind !== "text" &&
    resultKind !== "tool_timeline" &&
    resultKind !== "image_gallery" &&
    resultKind !== "artifact" &&
    resultKind !== "form" &&
    resultKind !== "table_report"
  ) {
    return undefined;
  }

  if (
    detailKind !== "json" &&
    detailKind !== "task_detail" &&
    detailKind !== "artifact_detail" &&
    detailKind !== "media_detail" &&
    detailKind !== "scene_detail"
  ) {
    return undefined;
  }

  return {
    resultKind,
    detailKind,
    supportsStreaming:
      typeof value.supportsStreaming === "boolean"
        ? value.supportsStreaming
        : undefined,
    supportsTimeline:
      typeof value.supportsTimeline === "boolean"
        ? value.supportsTimeline
        : undefined,
  };
}

function buildSkillEntryFromCatalogItem(
  item: SkillCatalogItem,
): SkillCatalogSkillEntry {
  return {
    id: `skill:${item.id}`,
    kind: "skill",
    title: item.title,
    summary: item.summary,
    skillId: item.id,
    groupKey: item.groupKey,
    aliases: item.aliases,
    surfaceScopes: item.surfaceScopes,
    execution: cloneJsonValue(item.execution),
    renderContract:
      item.defaultArtifactKind === "table_report"
        ? {
            resultKind: "table_report",
            detailKind: "artifact_detail",
            supportsStreaming: true,
          }
        : item.defaultArtifactKind
          ? {
              resultKind: "artifact",
              detailKind: "artifact_detail",
              supportsStreaming: true,
            }
          : {
              resultKind: "text",
              detailKind: "json",
              supportsStreaming: true,
            },
  };
}

function buildSceneEntryFromCatalogItem(
  item: SkillCatalogItem,
): SkillCatalogSceneEntry | null {
  const explicitSceneBinding = item.sceneBinding;
  if (!explicitSceneBinding && item.execution.kind !== "cloud_scene") {
    return null;
  }

  const sceneKey =
    normalizeText(explicitSceneBinding?.sceneKey) ??
    normalizeText(item.skillKey) ??
    normalizeText(item.id);
  if (!sceneKey) {
    return null;
  }

  return {
    id: `scene:${sceneKey}`,
    kind: "scene",
    title: normalizeText(explicitSceneBinding?.title) ?? item.title,
    summary: normalizeText(explicitSceneBinding?.summary) ?? item.summary,
    sceneKey,
    commandPrefix:
      normalizeText(explicitSceneBinding?.commandPrefix) ?? `/${sceneKey}`,
    aliases:
      explicitSceneBinding?.aliases && explicitSceneBinding.aliases.length > 0
        ? explicitSceneBinding.aliases
        : item.aliases,
    surfaceScopes: item.surfaceScopes,
    linkedSkillId: item.id,
    executionKind: item.execution.kind,
    renderContract: {
      resultKind: "tool_timeline",
      detailKind: "scene_detail",
      supportsStreaming: true,
      supportsTimeline: true,
    },
  };
}

function buildSeededCommandEntries(): SkillCatalogCommandEntry[] {
  return SEEDED_COMMAND_ENTRY_DEFINITIONS.map((definition) => ({
    id: definition.id,
    kind: "command",
    title: definition.title,
    summary: definition.summary,
    commandKey: definition.commandKey,
    aliases: [...definition.aliases],
    surfaceScopes: ["mention", "workspace"],
    triggers: definition.triggers.map((trigger) => ({ ...trigger })),
    binding: definition.binding ? { ...definition.binding } : undefined,
    renderContract: definition.renderContract
      ? { ...definition.renderContract }
      : undefined,
  }));
}

function buildSceneEntriesFromCatalogItems(
  items: SkillCatalogItem[],
): SkillCatalogSceneEntry[] {
  return items
    .map((item) => buildSceneEntryFromCatalogItem(item))
    .filter((entry): entry is SkillCatalogSceneEntry => Boolean(entry));
}

function mergeSeededCatalogEntries(
  entries: SkillCatalogEntry[],
  sceneSourceItems: SkillCatalogItem[],
): SkillCatalogEntry[] {
  const merged: SkillCatalogEntry[] = [];
  const seenIds = new Set<string>();

  [
    ...buildSeededCommandEntries(),
    ...buildSceneEntriesFromCatalogItems(sceneSourceItems),
    ...entries,
  ].forEach((entry) => {
    if (seenIds.has(entry.id)) {
      return;
    }
    seenIds.add(entry.id);
    merged.push(entry);
  });

  return merged;
}

function buildLegacyCatalogEntries(
  items: SkillCatalogItem[],
  sceneSourceItems: SkillCatalogItem[] = items,
): SkillCatalogEntry[] {
  const entries: SkillCatalogEntry[] = [];
  const seenIds = new Set<string>();

  buildSeededCommandEntries().forEach((entry) => {
    if (seenIds.has(entry.id)) {
      return;
    }
    seenIds.add(entry.id);
    entries.push(entry);
  });

  items.forEach((item) => {
    const skillEntry = buildSkillEntryFromCatalogItem(item);
    if (!seenIds.has(skillEntry.id)) {
      seenIds.add(skillEntry.id);
      entries.push(skillEntry);
    }
  });

  buildSceneEntriesFromCatalogItems(sceneSourceItems).forEach((entry) => {
    if (seenIds.has(entry.id)) {
      return;
    }
    seenIds.add(entry.id);
    entries.push(entry);
  });

  return entries;
}

function resolveSeededSkillGroupKey(item: ServiceSkillItem): string {
  return resolveAdapterGroupKey(item.siteCapabilityBinding?.adapterName);
}

function buildRawSeededSkillCatalog(): SkillCatalog {
  const seeded = getSeededServiceSkillCatalog();
  const items: SkillCatalogItem[] = seeded.items.map((item) => {
    const clonedItem = cloneJsonValue(item);
    const groupKey = resolveSeededSkillGroupKey(clonedItem);
    const execution: SkillCatalogExecution = {
      kind: resolveSkillCatalogExecutionKind(
        clonedItem.defaultExecutorBinding,
        clonedItem.siteCapabilityBinding,
      ),
      siteAdapterBinding: clonedItem.siteCapabilityBinding
        ? cloneJsonValue(clonedItem.siteCapabilityBinding)
        : undefined,
    };

    return {
      ...clonedItem,
      groupKey,
      execution,
    };
  });

  const itemCountByGroup = items.reduce<Record<string, number>>((acc, item) => {
    acc[item.groupKey] = (acc[item.groupKey] ?? 0) + 1;
    return acc;
  }, {});

  const groups = SEEDED_SKILL_GROUP_PRESETS.filter(
    (preset) => itemCountByGroup[preset.key] > 0,
  ).map((preset) => ({
    ...preset,
    itemCount: itemCountByGroup[preset.key] ?? 0,
  }));

  return {
    version: SEEDED_SKILL_CATALOG_VERSION,
    tenantId: seeded.tenantId,
    syncedAt: seeded.syncedAt,
    groups,
    items,
    entries: buildLegacyCatalogEntries(items),
  };
}

const RAW_SEEDED_SKILL_CATALOG = buildRawSeededSkillCatalog();
const SEEDED_SKILL_CATALOG = normalizeSkillCatalog(RAW_SEEDED_SKILL_CATALOG);

function resolveAdapterGroupKey(adapterName?: string | null): string {
  const normalized = normalizeText(adapterName)?.toLowerCase();
  if (!normalized) {
    return "general";
  }

  const [prefix] = normalized.split("/");
  return prefix || "general";
}

function titleCaseSegment(value: string): string {
  if (!value) {
    return value;
  }
  return value[0]!.toUpperCase() + value.slice(1);
}

function resolveGroupTitle(groupKey: string): string {
  const normalized = groupKey.trim().toLowerCase();
  if (SITE_GROUP_TITLE_OVERRIDES[normalized]) {
    return SITE_GROUP_TITLE_OVERRIDES[normalized]!;
  }
  return normalized.split(/[-_]/).map(titleCaseSegment).join(" ");
}

function resolveKnownGroupPreset(groupKey: string) {
  return SEEDED_SKILL_GROUP_PRESETS.find((preset) => preset.key === groupKey);
}

function buildFallbackGroupPreset(
  groupKey: string,
): Omit<SkillCatalogGroup, "itemCount"> {
  const title = resolveGroupTitle(groupKey);
  return {
    key: groupKey,
    title,
    summary: `围绕 ${title} 的只读站点技能入口，适合直接复用真实页面上下文采集结果。`,
    entryHint: `先进入 ${title} 技能组，再选择具体技能项开始采集。`,
    themeTarget: "general",
    sort: 80,
  };
}

function mergeCatalogGroups(
  currentGroups: SkillCatalogGroup[],
  items: SkillCatalogItem[],
): SkillCatalogGroup[] {
  const itemCountByGroup = items.reduce<Record<string, number>>((acc, item) => {
    acc[item.groupKey] = (acc[item.groupKey] ?? 0) + 1;
    return acc;
  }, {});
  const groupsByKey = new Map<string, SkillCatalogGroup>();

  for (const group of currentGroups) {
    groupsByKey.set(group.key, {
      ...group,
      itemCount: itemCountByGroup[group.key] ?? 0,
    });
  }

  for (const groupKey of Object.keys(itemCountByGroup)) {
    if (groupsByKey.has(groupKey)) {
      continue;
    }

    const preset =
      resolveKnownGroupPreset(groupKey) ?? buildFallbackGroupPreset(groupKey);
    groupsByKey.set(groupKey, {
      ...preset,
      itemCount: itemCountByGroup[groupKey] ?? 0,
    });
  }

  return Array.from(groupsByKey.values())
    .filter((group) => group.itemCount > 0)
    .sort((left, right) => left.sort - right.sort);
}

function shouldExposeSkillCatalogItem(item: SkillCatalogItem): boolean {
  if (item.execution.kind === "site_adapter") {
    return false;
  }

  if (
    item.defaultExecutorBinding === "browser_assist" ||
    item.siteCapabilityBinding
  ) {
    return false;
  }

  return true;
}

function normalizeSkillCatalog(catalog: SkillCatalog): SkillCatalog {
  const filteredItems = catalog.items.filter(shouldExposeSkillCatalogItem);
  const normalizedGroups = mergeCatalogGroups(catalog.groups, filteredItems);
  const normalizedEntries = mergeSeededCatalogEntries(
    catalog.entries.length > 0
      ? catalog.entries.filter((entry) => {
          if (entry.kind === "skill") {
            return filteredItems.some((item) => entry.skillId === item.id);
          }
          if (entry.kind === "scene") {
            const linkedSkillId = entry.linkedSkillId?.trim();
            if (!linkedSkillId) {
              return true;
            }
            if (catalog.items.some((item) => item.id === linkedSkillId)) {
              return true;
            }
            return (
              entry.executionKind === "site_adapter" ||
              entry.executionKind === "scene"
            );
          }
          return true;
        })
      : buildLegacyCatalogEntries(filteredItems, catalog.items),
    catalog.items,
  );

  return cloneSkillCatalog({
    ...catalog,
    groups: normalizedGroups,
    items: filteredItems,
    entries: normalizedEntries,
  });
}

function parseSkillCatalogExecution(
  value: unknown,
): SkillCatalogExecution | null {
  if (!isPlainRecord(value)) {
    return null;
  }

  const kind = normalizeText(value.kind);
  if (
    kind !== "native_skill" &&
    kind !== "agent_turn" &&
    kind !== "automation_job" &&
    kind !== "cloud_scene" &&
    kind !== "site_adapter"
  ) {
    return null;
  }

  const siteAdapterBindingEnvelope =
    value.siteAdapterBinding === undefined
      ? undefined
      : parseServiceSkillCatalog({
          version: "__internal__",
          tenantId: "__internal__",
          syncedAt: "__internal__",
          items: [
            {
              id: "__internal__",
              title: "__internal__",
              summary: "__internal__",
              category: "__internal__",
              outputHint: "__internal__",
              source: "cloud_catalog",
              runnerType: "instant",
              defaultExecutorBinding: "browser_assist",
              executionLocation: "client_default",
              slotSchema: [],
              siteCapabilityBinding: value.siteAdapterBinding,
              version: "__internal__",
            },
          ],
        });

  return {
    kind,
    siteAdapterBinding:
      siteAdapterBindingEnvelope?.items[0]?.siteCapabilityBinding,
  };
}

function parseSkillCatalogItem(value: unknown): SkillCatalogItem | null {
  if (!isPlainRecord(value)) {
    return null;
  }

  const groupKey = normalizeText(value.groupKey);
  if (!groupKey) {
    return null;
  }
  const execution = parseSkillCatalogExecution(value.execution);
  if (!execution) {
    return null;
  }

  const serviceSkillCandidate = {
    ...value,
  };
  delete (serviceSkillCandidate as Record<string, unknown>).groupKey;
  delete (serviceSkillCandidate as Record<string, unknown>).execution;

  const parsed = parseServiceSkillCatalog({
    version: "__internal__",
    tenantId: "__internal__",
    syncedAt: "__internal__",
    items: [serviceSkillCandidate],
  });
  const item = parsed?.items[0];
  if (!item) {
    return null;
  }

  return {
    ...item,
    groupKey,
    execution,
  };
}

function parseSkillCatalogGroup(value: unknown): SkillCatalogGroup | null {
  if (!isPlainRecord(value)) {
    return null;
  }

  const key = normalizeText(value.key);
  const title = normalizeText(value.title);
  const summary = normalizeText(value.summary);
  if (!key || !title || !summary || typeof value.sort !== "number") {
    return null;
  }

  return {
    key,
    title,
    summary,
    entryHint: normalizeText(value.entryHint) ?? undefined,
    themeTarget: normalizeText(value.themeTarget) ?? undefined,
    sort: value.sort,
    itemCount:
      typeof value.itemCount === "number" && Number.isFinite(value.itemCount)
        ? value.itemCount
        : 0,
  };
}

function parseSkillCatalogCommandTrigger(
  value: unknown,
): SkillCatalogCommandTrigger | null {
  if (!isPlainRecord(value)) {
    return null;
  }

  const mode = normalizeText(value.mode);
  const prefix = normalizeText(value.prefix);
  if (!prefix || (mode !== "mention" && mode !== "slash")) {
    return null;
  }

  return {
    mode,
    prefix,
  };
}

function parseSkillCatalogEntry(value: unknown): SkillCatalogEntry | null {
  if (!isPlainRecord(value)) {
    return null;
  }

  const id = normalizeText(value.id);
  const kind = normalizeText(value.kind);
  const title = normalizeText(value.title);
  const summary = normalizeText(value.summary);
  if (!id || !kind || !title || !summary) {
    return null;
  }

  if (kind === "command") {
    const commandKey = normalizeText(value.commandKey);
    const triggers = Array.isArray(value.triggers)
      ? value.triggers
          .map((trigger) => parseSkillCatalogCommandTrigger(trigger))
          .filter((trigger): trigger is SkillCatalogCommandTrigger =>
            Boolean(trigger),
          )
      : [];

    if (!commandKey || triggers.length === 0) {
      return null;
    }

    const binding = isPlainRecord(value.binding)
      ? {
          skillId: normalizeText(value.binding.skillId) ?? undefined,
          executionKind: parseCommandBindingExecutionKind(
            value.binding.executionKind,
          ),
        }
      : undefined;

    return {
      id,
      kind: "command",
      title,
      summary,
      commandKey,
      aliases: normalizeSearchAliases(value.aliases),
      surfaceScopes: normalizeSurfaceScopes(value.surfaceScopes),
      triggers,
      binding,
      renderContract: parseRenderContract(value.renderContract),
    };
  }

  if (kind === "scene") {
    const sceneKey = normalizeText(value.sceneKey);
    const commandPrefix = normalizeText(value.commandPrefix);
    if (!sceneKey || !commandPrefix) {
      return null;
    }

    return {
      id,
      kind: "scene",
      title,
      summary,
      sceneKey,
      commandPrefix,
      aliases: normalizeSearchAliases(value.aliases),
      surfaceScopes: normalizeSurfaceScopes(value.surfaceScopes),
      linkedSkillId: normalizeText(value.linkedSkillId) ?? undefined,
      executionKind: parseSceneExecutionKind(value.executionKind),
      renderContract: parseRenderContract(value.renderContract),
    };
  }

  if (kind === "skill") {
    const skillId = normalizeText(value.skillId);
    const groupKey = normalizeText(value.groupKey);
    const execution = parseSkillCatalogExecution(value.execution);
    if (!skillId || !groupKey || !execution) {
      return null;
    }

    return {
      id,
      kind: "skill",
      title,
      summary,
      skillId,
      groupKey,
      aliases: normalizeSearchAliases(value.aliases),
      surfaceScopes: normalizeSurfaceScopes(value.surfaceScopes),
      execution,
      renderContract: parseRenderContract(value.renderContract),
    };
  }

  return null;
}

function mergeSeededLocalCustomSkillCatalogItems(
  catalog: SkillCatalog,
): SkillCatalog {
  const localCustomItems = RAW_SEEDED_SKILL_CATALOG.items.filter(
    (item) => item.source === "local_custom",
  );
  if (localCustomItems.length === 0) {
    return catalog;
  }

  const localCustomIds = new Set(localCustomItems.map((item) => item.id));
  return {
    ...catalog,
    items: [
      ...catalog.items.filter((item) => !localCustomIds.has(item.id)),
      ...localCustomItems.map((item) => cloneJsonValue(item)),
    ],
  };
}

export function parseSkillCatalog(value: unknown): SkillCatalog | null {
  if (!isPlainRecord(value)) {
    return null;
  }

  const version = normalizeText(value.version);
  const tenantId = normalizeText(value.tenantId);
  const syncedAt = normalizeText(value.syncedAt);
  if (!version || !tenantId || !syncedAt) {
    return null;
  }
  if (!Array.isArray(value.groups) || !Array.isArray(value.items)) {
    return null;
  }

  const groups: SkillCatalogGroup[] = [];
  for (const item of value.groups) {
    const parsed = parseSkillCatalogGroup(item);
    if (!parsed) {
      return null;
    }
    groups.push(parsed);
  }

  const items: SkillCatalogItem[] = [];
  for (const item of value.items) {
    const parsed = parseSkillCatalogItem(item);
    if (!parsed) {
      return null;
    }
    items.push(parsed);
  }

  const entriesSource = Array.isArray(value.entries) ? value.entries : [];
  const entries: SkillCatalogEntry[] = [];
  for (const entry of entriesSource) {
    const parsed = parseSkillCatalogEntry(entry);
    if (!parsed) {
      return null;
    }
    entries.push(parsed);
  }

  return normalizeSkillCatalog(
    mergeSeededLocalCustomSkillCatalogItems({
      version,
      tenantId,
      syncedAt,
      groups,
      items,
      entries,
    }),
  );
}

function persistSkillCatalog(catalog: SkillCatalog): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      SKILL_CATALOG_STORAGE_KEY,
      JSON.stringify(catalog),
    );
  } catch {
    // ignore local cache errors
  }
}

function readCachedSkillCatalog(): SkillCatalog | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(SKILL_CATALOG_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return parseSkillCatalog(JSON.parse(raw));
  } catch {
    return null;
  }
}

function isSameSkillCatalog(left: SkillCatalog, right: SkillCatalog): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function parseCatalogSyncedAt(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function compareCatalogVersion(left: string, right: string): number {
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function isSeededCatalogCompatibleWithActiveTenant(
  catalog: SkillCatalog,
): boolean {
  if (isSeededSkillCatalog(catalog)) {
    return true;
  }

  const runtime = resolveOemCloudRuntimeContext();
  if (!runtime) {
    return true;
  }

  return catalog.tenantId === runtime.tenantId;
}

function shouldRefreshSeededSkillCatalog(
  cached: SkillCatalog,
  seeded: SkillCatalog,
): boolean {
  if (cached.tenantId !== seeded.tenantId) {
    return false;
  }

  for (const seededGroup of seeded.groups) {
    const cachedGroup = cached.groups.find(
      (group) => group.key === seededGroup.key,
    );
    if (
      !cachedGroup ||
      JSON.stringify(cachedGroup) !== JSON.stringify(seededGroup)
    ) {
      return true;
    }
  }

  for (const seededItem of seeded.items) {
    const cachedItem = cached.items.find((item) => item.id === seededItem.id);
    if (
      !cachedItem ||
      JSON.stringify(cachedItem) !== JSON.stringify(seededItem)
    ) {
      return true;
    }
  }

  for (const seededEntry of seeded.entries) {
    const cachedEntry = cached.entries.find(
      (entry) => entry.id === seededEntry.id,
    );
    if (
      !cachedEntry ||
      JSON.stringify(cachedEntry) !== JSON.stringify(seededEntry)
    ) {
      return true;
    }
  }

  return false;
}

function shouldIgnoreServerSyncedCatalog(
  current: SkillCatalog | null,
  incoming: SkillCatalog,
): boolean {
  const runtime = resolveOemCloudRuntimeContext();
  if (runtime && incoming.tenantId !== runtime.tenantId) {
    return true;
  }

  if (!current || current.tenantId !== incoming.tenantId) {
    return false;
  }

  const currentSyncedAt = parseCatalogSyncedAt(current.syncedAt);
  const incomingSyncedAt = parseCatalogSyncedAt(incoming.syncedAt);

  if (currentSyncedAt > 0 && incomingSyncedAt > 0) {
    if (incomingSyncedAt < currentSyncedAt) {
      return true;
    }
    if (incomingSyncedAt > currentSyncedAt) {
      return false;
    }
  }

  return compareCatalogVersion(incoming.version, current.version) < 0;
}

function emitSkillCatalogChanged(source: SkillCatalogChangeSource): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<{ source: SkillCatalogChangeSource; timestamp: number }>(
      SKILL_CATALOG_CHANGED_EVENT,
      {
        detail: {
          source,
          timestamp: Date.now(),
        },
      },
    ),
  );
}

export function getSeededSkillCatalog(): SkillCatalog {
  return cloneSkillCatalog(SEEDED_SKILL_CATALOG);
}

export function listSkillCatalogEntries(
  catalog: SkillCatalog,
): SkillCatalogEntry[] {
  return (catalog.entries || []).map((entry) => cloneJsonValue(entry));
}

export function listSkillCatalogCommandEntries(
  catalog: SkillCatalog,
): SkillCatalogCommandEntry[] {
  return listSkillCatalogEntries(catalog).filter(
    (entry): entry is SkillCatalogCommandEntry => entry.kind === "command",
  );
}

export function listSkillCatalogSceneEntries(
  catalog: SkillCatalog,
): SkillCatalogSceneEntry[] {
  return listSkillCatalogEntries(catalog).filter(
    (entry): entry is SkillCatalogSceneEntry => entry.kind === "scene",
  );
}

export function listSkillCatalogSkillEntries(
  catalog: SkillCatalog,
): SkillCatalogSkillEntry[] {
  return listSkillCatalogEntries(catalog).filter(
    (entry): entry is SkillCatalogSkillEntry => entry.kind === "skill",
  );
}

export function isSeededSkillCatalog(catalog: SkillCatalog): boolean {
  return (
    catalog.tenantId === SEEDED_SKILL_CATALOG.tenantId &&
    catalog.version === SEEDED_SKILL_CATALOG.version
  );
}

export function saveSkillCatalog(
  catalog: SkillCatalog,
  source: Exclude<
    SkillCatalogChangeSource,
    "seeded_fallback" | "cache_clear"
  > = "manual_override",
): SkillCatalog {
  const normalized = parseSkillCatalog(catalog);
  if (!normalized) {
    throw new Error("invalid skill catalog");
  }
  const current = readCachedSkillCatalog();
  if (current && isSameSkillCatalog(current, normalized)) {
    persistSkillCatalog(normalized);
    return normalized;
  }
  persistSkillCatalog(normalized);
  emitSkillCatalogChanged(source);
  return normalized;
}

export function applyServerSyncedSkillCatalog(
  catalog: SkillCatalog,
  source: "bootstrap_sync",
): SkillCatalog {
  const current = readCachedSkillCatalog();
  if (shouldIgnoreServerSyncedCatalog(current, catalog)) {
    return current && isSeededCatalogCompatibleWithActiveTenant(current)
      ? current
      : getSeededSkillCatalog();
  }

  if (current && isSameSkillCatalog(current, catalog)) {
    persistSkillCatalog(catalog);
    return catalog;
  }

  persistSkillCatalog(catalog);
  emitSkillCatalogChanged(source);
  return catalog;
}

export function clearSkillCatalogCache(): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(SKILL_CATALOG_STORAGE_KEY);
    } catch {
      // ignore local cache errors
    }
  }

  emitSkillCatalogChanged("cache_clear");
}

export function subscribeSkillCatalogChanged(
  callback: (source: SkillCatalogChangeSource) => void,
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const customEventHandler = (event: Event) => {
    const customEvent = event as CustomEvent<{
      source?: SkillCatalogChangeSource;
    }>;
    const source = customEvent.detail?.source;
    if (source) {
      callback(source);
    }
  };

  const storageHandler = (event: StorageEvent) => {
    if (event.key !== SKILL_CATALOG_STORAGE_KEY) {
      return;
    }
    callback(event.newValue ? "manual_override" : "cache_clear");
  };

  window.addEventListener(SKILL_CATALOG_CHANGED_EVENT, customEventHandler);
  window.addEventListener("storage", storageHandler);

  return () => {
    window.removeEventListener(SKILL_CATALOG_CHANGED_EVENT, customEventHandler);
    window.removeEventListener("storage", storageHandler);
  };
}

async function requestRemoteSkillCatalog(): Promise<SkillCatalog> {
  const runtime = resolveOemCloudRuntimeContext();
  if (!runtime) {
    throw new Error("缺少 OEM 云端配置，请先注入 base_url 与 tenant_id。");
  }
  if (!hasOemCloudSession(runtime)) {
    throw new Error("缺少 OEM 云端 Session Token，请先完成登录或注入会话。");
  }

  const response = await fetch(
    `${runtime.controlPlaneBaseUrl}/v1/public/tenants/${encodeURIComponent(runtime.tenantId)}/client/skills`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${runtime.sessionToken}`,
      },
    },
  );

  let payload: SkillCatalogResponseEnvelope | null = null;
  try {
    payload = (await response.json()) as SkillCatalogResponseEnvelope;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(
      payload?.message?.trim() || `请求失败 (${response.status})`,
    );
  }

  const catalog = parseSkillCatalog(payload?.data);
  if (!catalog) {
    throw new Error(payload?.message?.trim() || "服务端返回的技能目录格式非法");
  }

  return catalog;
}

export async function getSkillCatalog(): Promise<SkillCatalog> {
  const seeded = getSeededSkillCatalog();
  const cached = readCachedSkillCatalog();
  if (cached) {
    if (!isSeededCatalogCompatibleWithActiveTenant(cached)) {
      return seeded;
    }

    if (shouldRefreshSeededSkillCatalog(cached, seeded)) {
      persistSkillCatalog(seeded);
      return seeded;
    }

    return cached;
  }

  persistSkillCatalog(seeded);
  return seeded;
}

export async function refreshSkillCatalogFromRemote(): Promise<SkillCatalog | null> {
  const runtime = resolveOemCloudRuntimeContext();
  if (!runtime || !hasOemCloudSession(runtime)) {
    return null;
  }

  const catalog = await requestRemoteSkillCatalog();
  return applyServerSyncedSkillCatalog(catalog, "bootstrap_sync");
}
