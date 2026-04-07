import type {
  ServiceSkillCatalog,
  ServiceSkillArtifactKind,
  ServiceSkillBundleResourceSummary,
  ServiceSkillBundleStandardCompliance,
  ServiceSkillBundleSummary,
  ServiceSkillExecutionLocation,
  ServiceSkillExecutorBinding,
  ServiceSkillItem,
  ServiceSkillPromptTemplateKey,
  ServiceSkillReadinessRequirements,
  ServiceSkillRunnerType,
  ServiceSkillSceneBinding,
  ServiceSkillSlotDefinition,
  ServiceSkillSlotOption,
  ServiceSkillSlotType,
  ServiceSkillSource,
  ServiceSkillSurfaceScope,
  ServiceSkillType,
} from "@/lib/api/serviceSkills";
import type {
  SkillCatalogExecutionKind,
  SkillCatalogGroup,
} from "@/lib/api/skillCatalog";

export type {
  ServiceSkillCatalog,
  ServiceSkillArtifactKind,
  ServiceSkillBundleResourceSummary,
  ServiceSkillBundleStandardCompliance,
  ServiceSkillBundleSummary,
  ServiceSkillExecutionLocation,
  ServiceSkillExecutorBinding,
  ServiceSkillItem,
  ServiceSkillPromptTemplateKey,
  ServiceSkillReadinessRequirements,
  ServiceSkillRunnerType,
  ServiceSkillSceneBinding,
  ServiceSkillSlotDefinition,
  ServiceSkillSlotOption,
  ServiceSkillSlotType,
  ServiceSkillSource,
  ServiceSkillSurfaceScope,
  ServiceSkillType,
};
export type { SkillCatalogExecutionKind, SkillCatalogGroup };
export type ServiceSkillGroup = SkillCatalogGroup;

export type ServiceSkillTone = "slate" | "sky" | "emerald" | "amber";

export type ServiceSkillSlotValues = Record<string, string>;

export interface ServiceSkillAutomationStatus {
  jobId: string;
  jobName: string;
  statusLabel: string;
  tone: ServiceSkillTone;
  detail: string | null;
}

export interface ServiceSkillAutomationLinkRecord {
  skillId: string;
  jobId: string;
  jobName: string;
  linkedAt: number;
}

export interface ServiceSkillCloudRunStatus {
  runId: string;
  statusLabel: string;
  tone: ServiceSkillTone;
  detail: string | null;
  updatedAt: number;
}

export interface ServiceSkillHomeItem extends ServiceSkillItem {
  groupKey?: string;
  executionKind?: SkillCatalogExecutionKind;
  badge: string;
  recentUsedAt: number | null;
  isRecent: boolean;
  runnerLabel: string;
  runnerTone: ServiceSkillTone;
  runnerDescription: string;
  actionLabel: string;
  automationStatus: ServiceSkillAutomationStatus | null;
  cloudStatus?: ServiceSkillCloudRunStatus | null;
}

export interface ServiceSkillCatalogMeta {
  tenantId: string;
  version: string;
  syncedAt: string;
  itemCount: number;
  groupCount?: number;
  sourceLabel: string;
  isSeeded: boolean;
}

export interface ServiceSkillUsageRecord {
  skillId: string;
  usedAt: number;
  runnerType: ServiceSkillRunnerType;
}

export interface RecordServiceSkillUsageInput {
  skillId: string;
  usedAt?: number;
  runnerType: ServiceSkillRunnerType;
}
