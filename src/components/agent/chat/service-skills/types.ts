import type {
  ServiceSkillCatalog,
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

export interface ServiceSkillHomeItem extends ServiceSkillItem {
  badge: string;
  recentUsedAt: number | null;
  isRecent: boolean;
  runnerLabel: string;
  runnerTone: ServiceSkillTone;
  runnerDescription: string;
  actionLabel: string;
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
