import type {
  ServiceSkillCatalog,
  ServiceSkillArtifactKind,
  ServiceSkillExecutionLocation,
  ServiceSkillExecutorBinding,
  ServiceSkillItem,
  ServiceSkillReadinessRequirements,
  ServiceSkillRunnerType,
  ServiceSkillSlotDefinition,
  ServiceSkillSlotOption,
  ServiceSkillSlotType,
  ServiceSkillSource,
} from "@/lib/api/serviceSkills";

export type {
  ServiceSkillCatalog,
  ServiceSkillArtifactKind,
  ServiceSkillExecutionLocation,
  ServiceSkillExecutorBinding,
  ServiceSkillItem,
  ServiceSkillReadinessRequirements,
  ServiceSkillRunnerType,
  ServiceSkillSlotDefinition,
  ServiceSkillSlotOption,
  ServiceSkillSlotType,
  ServiceSkillSource,
};

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

export interface ServiceSkillHomeItem extends ServiceSkillItem {
  badge: string;
  recentUsedAt: number | null;
  isRecent: boolean;
  runnerLabel: string;
  runnerTone: ServiceSkillTone;
  runnerDescription: string;
  actionLabel: string;
  automationStatus: ServiceSkillAutomationStatus | null;
}

export interface ServiceSkillCatalogMeta {
  tenantId: string;
  version: string;
  syncedAt: string;
  itemCount: number;
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
