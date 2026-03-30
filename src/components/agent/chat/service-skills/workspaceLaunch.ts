import type { ContentType, ProjectType } from "@/lib/api/project";
import { getDefaultContentTypeForProject } from "@/lib/api/project";
import type {
  ServiceSkillArtifactKind,
  ServiceSkillItem,
} from "@/lib/api/serviceSkills";
import { isContentCreationTheme } from "@/lib/workspace/workbenchContract";

export interface ServiceSkillWorkspaceSeed {
  title: string;
  contentType: ContentType;
  requestMetadata?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

function resolveServiceSkillArtifactRequestMetadata(
  artifactKind?: ServiceSkillArtifactKind,
): Record<string, unknown> | undefined {
  if (!artifactKind) {
    return undefined;
  }

  return {
    artifact: {
      artifact_mode: "draft",
      artifact_kind: artifactKind,
      workbench_surface: "right_panel",
    },
  };
}

export function buildServiceSkillWorkspaceSeed(
  skill: ServiceSkillItem,
  fallbackTheme?: string | null,
): ServiceSkillWorkspaceSeed | null {
  const targetTheme = skill.themeTarget ?? fallbackTheme ?? null;
  if (!targetTheme || !isContentCreationTheme(targetTheme)) {
    return null;
  }

  return {
    title: skill.title.trim() || "技能工作稿",
    contentType: getDefaultContentTypeForProject(targetTheme as ProjectType),
    requestMetadata: resolveServiceSkillArtifactRequestMetadata(
      skill.defaultArtifactKind,
    ),
    metadata: {
      source: "service_skill",
      serviceSkill: {
        id: skill.id,
        title: skill.title,
        runnerType: skill.runnerType,
        executionLocation: skill.executionLocation,
        themeTarget: targetTheme,
        artifactKind: skill.defaultArtifactKind ?? null,
      },
    },
  };
}
