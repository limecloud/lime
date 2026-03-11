import { safeInvoke } from "@/lib/dev-bridge";

export type SkillSourceKind = "builtin" | "other";

export interface Skill {
  key: string;
  name: string;
  description: string;
  directory: string;
  readmeUrl?: string;
  installed: boolean;
  sourceKind: SkillSourceKind;
  repoOwner?: string;
  repoName?: string;
  repoBranch?: string;
}

export interface SkillRepo {
  owner: string;
  name: string;
  branch: string;
  enabled: boolean;
}

export type AppType = "claude" | "codex" | "gemini" | "proxycast";

export const skillsApi = {
  async getLocal(app: AppType = "proxycast"): Promise<Skill[]> {
    return safeInvoke("get_local_skills_for_app", { app });
  },

  async getAll(
    app: AppType = "proxycast",
    options?: { refreshRemote?: boolean },
  ): Promise<Skill[]> {
    return safeInvoke("get_skills_for_app", {
      app,
      refresh_remote: options?.refreshRemote ?? false,
    });
  },

  async install(
    directory: string,
    app: AppType = "proxycast",
  ): Promise<boolean> {
    return safeInvoke("install_skill_for_app", { app, directory });
  },

  async uninstall(
    directory: string,
    app: AppType = "proxycast",
  ): Promise<boolean> {
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
   * 获取已安装的 ProxyCast Skills 目录列表
   *
   * 扫描 ~/.proxycast/skills/ 目录,返回包含 SKILL.md 的子目录名列表。
   * 这些 Skills 将被传递给 aster 用于 AI Agent 功能。
   *
   * @returns 已安装的 Skill 目录名列表
   */
  async getInstalledProxyCastSkills(): Promise<string[]> {
    return safeInvoke("get_installed_proxycast_skills");
  },

  /**
   * 获取本地已安装 Skill 的 SKILL.md 内容
   *
   * @param directory Skill 目录名
   * @param app 应用类型
   * @returns SKILL.md 的文本内容
   */
  async getLocalSkillContent(
    directory: string,
    app: AppType = "proxycast",
  ): Promise<string> {
    return safeInvoke("get_local_skill_content", { app, directory });
  },
};
