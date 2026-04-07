import { safeInvoke } from "@/lib/dev-bridge";

export type SkillSourceKind = "builtin" | "other";
export type SkillCatalogSource = "project" | "user" | "remote";
export type SkillScaffoldTarget = "project" | "user";

export interface SkillResourceSummary {
  hasScripts: boolean;
  hasReferences: boolean;
  hasAssets: boolean;
}

export interface SkillStandardCompliance {
  isStandard: boolean;
  validationErrors: string[];
  deprecatedFields: string[];
}

export interface SkillInspection {
  content: string;
  license?: string;
  metadata: Record<string, string>;
  allowedTools: string[];
  resourceSummary: SkillResourceSummary;
  standardCompliance: SkillStandardCompliance;
}

export type LocalSkillInspection = SkillInspection;

export interface RemoteSkillLocator extends Record<string, unknown> {
  owner: string;
  name: string;
  branch: string;
  directory: string;
}

export interface CreateSkillScaffoldRequest extends Record<string, unknown> {
  target: SkillScaffoldTarget;
  directory: string;
  name: string;
  description: string;
}

export interface Skill {
  key: string;
  name: string;
  description: string;
  directory: string;
  readmeUrl?: string;
  installed: boolean;
  sourceKind: SkillSourceKind;
  catalogSource?: SkillCatalogSource;
  repoOwner?: string;
  repoName?: string;
  repoBranch?: string;
  license?: string;
  metadata?: Record<string, string>;
  allowedTools?: string[];
  resourceSummary?: SkillResourceSummary;
  standardCompliance?: SkillStandardCompliance;
}

export interface SkillRepo {
  owner: string;
  name: string;
  branch: string;
  enabled: boolean;
}

export interface ImportedSkillResult {
  directory: string;
}

export type AppType = "claude" | "codex" | "gemini" | "lime";

function normalizeStandardCompliance(
  compliance?: Partial<SkillStandardCompliance> | null,
): SkillStandardCompliance | undefined {
  if (!compliance) {
    return undefined;
  }

  return {
    isStandard: Boolean(compliance.isStandard),
    validationErrors: Array.isArray(compliance.validationErrors)
      ? compliance.validationErrors
      : [],
    deprecatedFields: Array.isArray(compliance.deprecatedFields)
      ? compliance.deprecatedFields
      : [],
  };
}

function normalizeSkill(skill: Skill): Skill {
  return {
    ...skill,
    standardCompliance: normalizeStandardCompliance(skill.standardCompliance),
  };
}

function normalizeInspection(inspection: SkillInspection): SkillInspection {
  return {
    ...inspection,
    standardCompliance: normalizeStandardCompliance(
      inspection.standardCompliance,
    ) ?? {
      isStandard: false,
      validationErrors: [],
      deprecatedFields: [],
    },
  };
}

export const skillsApi = {
  async getLocal(app: AppType = "lime"): Promise<Skill[]> {
    const skills = await safeInvoke<Skill[]>("get_local_skills_for_app", {
      app,
    });
    return skills.map(normalizeSkill);
  },

  async getAll(
    app: AppType = "lime",
    options?: { refreshRemote?: boolean },
  ): Promise<Skill[]> {
    const skills = await safeInvoke<Skill[]>("get_skills_for_app", {
      app,
      refresh_remote: options?.refreshRemote ?? false,
    });
    return skills.map(normalizeSkill);
  },

  async install(directory: string, app: AppType = "lime"): Promise<boolean> {
    return safeInvoke("install_skill_for_app", { app, directory });
  },

  async uninstall(directory: string, app: AppType = "lime"): Promise<boolean> {
    return safeInvoke("uninstall_skill_for_app", { app, directory });
  },

  async getRepos(): Promise<SkillRepo[]> {
    return safeInvoke("get_skill_repos");
  },

  async addRepo(repo: SkillRepo): Promise<boolean> {
    return safeInvoke("add_skill_repo", { repo });
  },

  async removeRepo(owner: string, name: string): Promise<boolean> {
    return safeInvoke("remove_skill_repo", { owner, name });
  },

  async refreshCache(): Promise<boolean> {
    return safeInvoke("refresh_skill_cache");
  },

  /**
   * 获取已安装的 Lime Skills 目录列表
   *
   * 扫描 Lime 应用 skills 目录，返回包含 SKILL.md 的子目录名列表。
   * 这些 Skills 将被传递给 aster 用于 AI Agent 功能。
   *
   * @returns 已安装的 Skill 目录名列表
   */
  async getInstalledLimeSkills(): Promise<string[]> {
    return safeInvoke("get_installed_lime_skills");
  },

  /**
   * 获取本地已安装 Skill 的标准检查结果
   *
   * @param directory Skill 目录名
   * @param app 应用类型
   * @returns 标准检查结果与原始 SKILL.md 内容
   */
  async inspectLocalSkill(
    directory: string,
    app: AppType = "lime",
  ): Promise<SkillInspection> {
    const inspection = await safeInvoke<SkillInspection>(
      "inspect_local_skill_for_app",
      { app, directory },
    );
    return normalizeInspection(inspection);
  },

  async createSkillScaffold(
    request: CreateSkillScaffoldRequest,
    app: AppType = "lime",
  ): Promise<SkillInspection> {
    const inspection = await safeInvoke<SkillInspection>(
      "create_skill_scaffold_for_app",
      {
        app,
        ...request,
      },
    );
    return normalizeInspection(inspection);
  },

  async importLocalSkill(
    sourcePath: string,
    app: AppType = "lime",
  ): Promise<ImportedSkillResult> {
    return safeInvoke<ImportedSkillResult>("import_local_skill_for_app", {
      app,
      source_path: sourcePath,
    });
  },

  async inspectRemoteSkill(
    locator: RemoteSkillLocator,
  ): Promise<SkillInspection> {
    const inspection = await safeInvoke<SkillInspection>(
      "inspect_remote_skill",
      locator,
    );
    return normalizeInspection(inspection);
  },
};
