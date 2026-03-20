export interface TeamPresetOption {
  id: string;
  label: string;
  description: string;
  theme: string;
  profileLabels: string[];
  profileIds: string[];
  roles: Array<{
    id: string;
    label: string;
    summary: string;
    profileId?: string;
    roleKey?: string;
    skillIds?: string[];
  }>;
}

export interface BuiltinTeamSkillOption {
  id: string;
  label: string;
  description: string;
}

export interface BuiltinTeamProfileOption {
  id: string;
  label: string;
  roleKey: string;
  description: string;
  theme: string;
  skillIds: string[];
}

export const BUILTIN_TEAM_SKILL_OPTIONS: BuiltinTeamSkillOption[] = [
  {
    id: "repo-exploration",
    label: "仓库探索",
    description: "聚焦代码阅读、边界识别与事实收敛。",
  },
  {
    id: "bounded-implementation",
    label: "边界实现",
    description: "强调只改授权范围，避免和其他子代理冲突。",
  },
  {
    id: "verification-report",
    label: "验证汇报",
    description: "突出验证步骤、回归结果、风险与缺口。",
  },
  {
    id: "source-grounding",
    label: "事实收敛",
    description: "明确区分事实、推断与待验证项。",
  },
  {
    id: "structured-writing",
    label: "结构写作",
    description: "输出面向开发者、可直接执行的结构化内容。",
  },
];

export const BUILTIN_TEAM_PROFILE_OPTIONS: BuiltinTeamProfileOption[] = [
  {
    id: "code-explorer",
    label: "代码分析员",
    roleKey: "explorer",
    description: "负责阅读代码、收敛问题、定位影响面与事实证据。",
    theme: "engineering",
    skillIds: ["repo-exploration", "source-grounding"],
  },
  {
    id: "code-executor",
    label: "代码执行员",
    roleKey: "executor",
    description: "负责在清晰边界内实现改动，并回报改动与验证结果。",
    theme: "engineering",
    skillIds: ["bounded-implementation", "verification-report"],
  },
  {
    id: "code-verifier",
    label: "代码验证员",
    roleKey: "verifier",
    description: "负责复核结果、补充测试与列出风险。",
    theme: "engineering",
    skillIds: ["verification-report", "source-grounding"],
  },
  {
    id: "research-analyst",
    label: "研究分析员",
    roleKey: "researcher",
    description: "负责多源材料整理、证据归并与结论提炼。",
    theme: "research",
    skillIds: ["source-grounding", "structured-writing"],
  },
  {
    id: "doc-writer",
    label: "文档起草员",
    roleKey: "writer",
    description: "负责把分析结果转成方案、说明、PRD 或团队文档。",
    theme: "documentation",
    skillIds: ["structured-writing"],
  },
  {
    id: "content-ideator",
    label: "内容策划员",
    roleKey: "ideator",
    description: "负责生成创意方向、候选结构与选题角度。",
    theme: "content",
    skillIds: ["structured-writing"],
  },
  {
    id: "content-reviewer",
    label: "内容复核员",
    roleKey: "reviewer",
    description: "负责复核内容一致性、可读性与发布风险。",
    theme: "content",
    skillIds: ["verification-report", "structured-writing"],
  },
];

export const TEAM_PRESET_OPTIONS: TeamPresetOption[] = [
  {
    id: "code-triage-team",
    label: "代码排障团队",
    description: "分析、实现、验证三段式闭环，适合工程问题与多文件改动。",
    theme: "engineering",
    profileLabels: ["分析", "执行", "验证"],
    profileIds: ["code-explorer", "code-executor", "code-verifier"],
    roles: [
      {
        id: "explorer",
        label: "分析",
        summary: "先收敛问题边界、事实证据与影响范围，再给实现建议。",
        profileId: "code-explorer",
        roleKey: "explorer",
        skillIds: ["repo-exploration", "source-grounding"],
      },
      {
        id: "executor",
        label: "执行",
        summary: "在明确边界内落地改动，并说明实现点与验证结果。",
        profileId: "code-executor",
        roleKey: "executor",
        skillIds: ["bounded-implementation", "verification-report"],
      },
      {
        id: "verifier",
        label: "验证",
        summary: "补测试、做回归和风险复核，负责最终收口。",
        profileId: "code-verifier",
        roleKey: "verifier",
        skillIds: ["verification-report", "source-grounding"],
      },
    ],
  },
  {
    id: "research-team",
    label: "研究团队",
    description: "适合多源调研、事实归并、方案沉淀与文档汇总。",
    theme: "research",
    profileLabels: ["调研", "写作", "复核"],
    profileIds: ["research-analyst", "doc-writer", "code-verifier"],
    roles: [
      {
        id: "researcher",
        label: "调研",
        summary: "负责搜集来源、比对差异并抽取可支撑的事实结论。",
        profileId: "research-analyst",
        roleKey: "researcher",
        skillIds: ["source-grounding", "structured-writing"],
      },
      {
        id: "writer",
        label: "写作",
        summary: "把研究结果整理成可评审、可执行的方案或文档。",
        profileId: "doc-writer",
        roleKey: "writer",
        skillIds: ["structured-writing"],
      },
      {
        id: "reviewer",
        label: "复核",
        summary: "检查事实口径、逻辑闭环与待验证项，避免结论失真。",
        profileId: "code-verifier",
        roleKey: "reviewer",
        skillIds: ["verification-report", "source-grounding"],
      },
    ],
  },
  {
    id: "content-creation-team",
    label: "内容创作团队",
    description: "适合创意拆分、内容起草、发布前复核。",
    theme: "content",
    profileLabels: ["创意", "起草", "复核"],
    profileIds: ["content-ideator", "doc-writer", "content-reviewer"],
    roles: [
      {
        id: "ideator",
        label: "创意",
        summary: "产出多个有区分度的创意方向，并说明适用场景。",
        profileId: "content-ideator",
        roleKey: "ideator",
        skillIds: ["structured-writing"],
      },
      {
        id: "writer",
        label: "起草",
        summary: "将创意方向扩成首版内容结构与文稿。",
        profileId: "doc-writer",
        roleKey: "writer",
        skillIds: ["structured-writing"],
      },
      {
        id: "reviewer",
        label: "复核",
        summary: "负责风格一致性、表达质量与发布风险检查。",
        profileId: "content-reviewer",
        roleKey: "reviewer",
        skillIds: ["verification-report", "structured-writing"],
      },
    ],
  },
];

export function getTeamPresetOption(
  presetId?: string | null,
): TeamPresetOption | undefined {
  if (!presetId) {
    return undefined;
  }
  return TEAM_PRESET_OPTIONS.find((option) => option.id === presetId.trim());
}

export function getBuiltinTeamSkillOption(
  skillId?: string | null,
): BuiltinTeamSkillOption | undefined {
  if (!skillId) {
    return undefined;
  }
  return BUILTIN_TEAM_SKILL_OPTIONS.find(
    (option) => option.id === skillId.trim(),
  );
}

export function getBuiltinTeamProfileOption(
  profileId?: string | null,
): BuiltinTeamProfileOption | undefined {
  if (!profileId) {
    return undefined;
  }
  return BUILTIN_TEAM_PROFILE_OPTIONS.find(
    (option) => option.id === profileId.trim(),
  );
}

export function resolveDefaultTeamPresetId(theme?: string | null): string {
  switch (theme?.trim().toLowerCase()) {
    case "knowledge":
    case "planning":
    case "document":
      return "research-team";
    case "social-media":
    case "poster":
    case "music":
    case "video":
    case "novel":
      return "content-creation-team";
    case "general":
    default:
      return "code-triage-team";
  }
}
