import type { AutomationJobRequest } from "@/lib/api/automation";
import {
  getOrCreateDefaultProject,
  listProjects,
  type Project,
} from "@/lib/api/project";

function normalizeOptionalText(value?: string | null): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function buildFallbackAutomationWorkspace(projectId: string): Project {
  return {
    id: projectId,
    name: projectId,
    workspaceType: "general",
    rootPath: "",
    isDefault: false,
    createdAt: 0,
    updatedAt: 0,
    isFavorite: false,
    isArchived: false,
    tags: [],
  };
}

function prioritizeAutomationWorkspaces(
  workspaces: Project[],
  projectId?: string | null,
): Project[] {
  const normalizedProjectId = normalizeOptionalText(projectId);
  if (!normalizedProjectId) {
    return workspaces;
  }

  const matched = workspaces.find(
    (workspace) => workspace.id === normalizedProjectId,
  );
  const fallbackWorkspace =
    matched ?? buildFallbackAutomationWorkspace(normalizedProjectId);
  const remaining = workspaces.filter(
    (workspace) => workspace.id !== normalizedProjectId,
  );

  return [fallbackWorkspace, ...remaining];
}

export async function loadSceneAppAutomationWorkspaces(
  projectId?: string | null,
): Promise<Project[]> {
  const workspaces = await listProjects();
  if (workspaces.length > 0) {
    return prioritizeAutomationWorkspaces(workspaces, projectId);
  }

  const defaultProject = await getOrCreateDefaultProject();
  return prioritizeAutomationWorkspaces([defaultProject], projectId);
}

export function mergeSceneAppAutomationJobRequest(
  request: AutomationJobRequest,
  pendingAutomationRequest?: AutomationJobRequest | null,
): AutomationJobRequest {
  if (
    pendingAutomationRequest?.payload.kind !== "agent_turn" ||
    request.payload.kind !== "agent_turn"
  ) {
    return request;
  }

  return {
    ...request,
    payload: {
      ...request.payload,
      request_metadata: {
        ...(request.payload.request_metadata ?? {}),
        ...(pendingAutomationRequest.payload.request_metadata ?? {}),
      },
    },
  };
}
