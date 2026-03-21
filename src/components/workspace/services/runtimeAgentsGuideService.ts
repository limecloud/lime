import { toast } from "sonner";
import {
  ensureWorkspaceLocalAgentsGitignore,
  scaffoldRuntimeAgentsTemplate,
} from "@/lib/api/memoryRuntime";
import type { Project } from "@/lib/api/project";

const RUNTIME_AGENTS_GUIDE_STORAGE_KEY =
  "lime.runtime_agents_workspace_guide_seen.v1";

const runtimeAgentsInitializationRoots = new Set<string>();

type RuntimeAgentsGuideProject = Pick<Project, "id" | "rootPath"> &
  Partial<Pick<Project, "name">>;

interface NotifyRuntimeAgentsGuideOptions {
  successMessage: string;
  showSuccessWhenGuideAlreadySeen?: boolean;
}

function buildGuideStorageKey(project: RuntimeAgentsGuideProject): string {
  const projectId = project.id.trim();
  if (projectId) {
    return projectId;
  }
  return project.rootPath.trim();
}

function loadGuideSeenKeys(): Set<string> {
  if (typeof window === "undefined" || !window.localStorage) {
    return new Set();
  }

  try {
    const raw = window.localStorage.getItem(RUNTIME_AGENTS_GUIDE_STORAGE_KEY);
    if (!raw) {
      return new Set();
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return new Set();
    }

    return new Set(
      parsed
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    );
  } catch {
    return new Set();
  }
}

function saveGuideSeenKeys(keys: Set<string>) {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  window.localStorage.setItem(
    RUNTIME_AGENTS_GUIDE_STORAGE_KEY,
    JSON.stringify(Array.from(keys)),
  );
}

function markGuideAsShown(project: RuntimeAgentsGuideProject): boolean {
  const key = buildGuideStorageKey(project);
  if (!key) {
    return false;
  }

  const keys = loadGuideSeenKeys();
  if (keys.has(key)) {
    return false;
  }

  keys.add(key);
  saveGuideSeenKeys(keys);
  return true;
}

function describeTemplateStatus(label: string, status: string): string {
  if (status === "exists") {
    return `${label}模板已存在`;
  }
  return `${label}模板已生成`;
}

function describeGitignoreStatus(status: string): string {
  if (status === "exists") {
    return ".gitignore 已包含本机模板规则";
  }
  return ".gitignore 已写入本机模板规则";
}

async function initializeRuntimeAgentsGuide(project: RuntimeAgentsGuideProject) {
  const rootPath = project.rootPath.trim();
  if (!rootPath || runtimeAgentsInitializationRoots.has(rootPath)) {
    return;
  }

  runtimeAgentsInitializationRoots.add(rootPath);

  try {
    const workspaceTemplate = await scaffoldRuntimeAgentsTemplate(
      "workspace",
      rootPath,
      false,
    );
    const localTemplate = await scaffoldRuntimeAgentsTemplate(
      "workspace_local",
      rootPath,
      false,
    );
    const gitignoreResult = await ensureWorkspaceLocalAgentsGitignore(rootPath);

    toast.success("已初始化运行时 AGENTS 模板", {
      description: [
        describeTemplateStatus("共享", workspaceTemplate.status),
        describeTemplateStatus("本机", localTemplate.status),
        describeGitignoreStatus(gitignoreResult.status),
      ].join("；"),
    });
  } catch (error) {
    console.error("初始化运行时 AGENTS 模板失败:", error);
    toast.error("初始化运行时 AGENTS 模板失败", {
      description: "可以稍后在 设置 → 记忆 中手动生成或补齐。",
    });
  } finally {
    runtimeAgentsInitializationRoots.delete(rootPath);
  }
}

export function notifyProjectRuntimeAgentsGuide(
  project: RuntimeAgentsGuideProject,
  options: NotifyRuntimeAgentsGuideOptions,
) {
  const {
    successMessage,
    showSuccessWhenGuideAlreadySeen = true,
  } = options;
  const rootPath = project.rootPath.trim();
  if (!rootPath || !markGuideAsShown(project)) {
    if (showSuccessWhenGuideAlreadySeen) {
      toast.success(successMessage);
    }
    return;
  }

  toast.success(successMessage, {
    description:
      "建议初始化共享规则 `.lime/AGENTS.md` 与本机私有规则 `.lime/AGENTS.local.md`，后者会自动加入 `.gitignore`。",
    action: {
      label: "一键初始化",
      onClick: async () => {
        await initializeRuntimeAgentsGuide(project);
      },
    },
  });
}

export function notifyProjectCreatedWithRuntimeAgentsGuide(
  project: RuntimeAgentsGuideProject,
  successMessage: string,
) {
  notifyProjectRuntimeAgentsGuide(project, {
    successMessage,
    showSuccessWhenGuideAlreadySeen: true,
  });
}
