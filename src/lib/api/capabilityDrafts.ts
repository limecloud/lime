import { safeInvoke } from "@/lib/dev-bridge";

export type CapabilityDraftStatus =
  | "unverified"
  | "failed_self_check"
  | "verification_failed"
  | "verified_pending_registration"
  | "registered";

export type CapabilityDraftVerificationRunStatus = "passed" | "failed";

export type CapabilityDraftVerificationCheckStatus = "passed" | "failed";

export type CapabilityDraftSourceKind =
  | "cli"
  | "api"
  | "docs"
  | "website"
  | "mcp"
  | "local_code"
  | "manual";

export interface CapabilityDraftFileInput extends Record<string, unknown> {
  relativePath: string;
  content: string;
}

export interface CapabilityDraftFileSummary {
  relativePath: string;
  byteLength: number;
  sha256: string;
}

export interface CreateCapabilityDraftRequest extends Record<string, unknown> {
  workspaceRoot: string;
  name: string;
  description: string;
  userGoal: string;
  sourceKind?: CapabilityDraftSourceKind | string;
  sourceRefs?: string[];
  permissionSummary?: string[];
  generatedFiles: CapabilityDraftFileInput[];
}

export interface CapabilityDraftLookupRequest extends Record<string, unknown> {
  workspaceRoot: string;
  draftId: string;
}

export interface CapabilityDraftListRequest extends Record<string, unknown> {
  workspaceRoot: string;
}

export interface CapabilityDraftRecord {
  draftId: string;
  name: string;
  description: string;
  userGoal: string;
  sourceKind: string;
  sourceRefs: string[];
  permissionSummary: string[];
  generatedFiles: CapabilityDraftFileSummary[];
  verificationStatus: CapabilityDraftStatus;
  lastVerification?: CapabilityDraftVerificationSummary | null;
  lastRegistration?: CapabilityDraftRegistrationSummary | null;
  createdAt: string;
  updatedAt: string;
  draftRoot: string;
  manifestPath: string;
}

export interface VerifyCapabilityDraftRequest extends Record<string, unknown> {
  workspaceRoot: string;
  draftId: string;
}

export interface CapabilityDraftVerificationCheck {
  id: string;
  label: string;
  status: CapabilityDraftVerificationCheckStatus;
  message: string;
  suggestions: string[];
  canAgentRepair: boolean;
}

export interface CapabilityDraftVerificationSummary {
  reportId: string;
  status: CapabilityDraftVerificationRunStatus;
  summary: string;
  checkedAt: string;
  failedCheckCount: number;
}

export interface CapabilityDraftVerificationReport extends CapabilityDraftVerificationSummary {
  draftId: string;
  checks: CapabilityDraftVerificationCheck[];
}

export interface VerifyCapabilityDraftResult {
  draft: CapabilityDraftRecord;
  report: CapabilityDraftVerificationReport;
}

export interface RegisterCapabilityDraftRequest extends Record<string, unknown> {
  workspaceRoot: string;
  draftId: string;
}

export interface CapabilityDraftRegistrationSummary {
  registrationId: string;
  registeredAt: string;
  skillDirectory: string;
  registeredSkillDirectory: string;
  sourceDraftId: string;
  sourceVerificationReportId?: string | null;
  generatedFileCount: number;
  permissionSummary: string[];
}

export interface RegisterCapabilityDraftResult {
  draft: CapabilityDraftRecord;
  registration: CapabilityDraftRegistrationSummary;
}

export interface ListWorkspaceRegisteredSkillsRequest
  extends Record<string, unknown> {
  workspaceRoot: string;
}

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

export interface WorkspaceRegisteredSkillRecord {
  key: string;
  name: string;
  description: string;
  directory: string;
  registeredSkillDirectory: string;
  registration: CapabilityDraftRegistrationSummary;
  permissionSummary: string[];
  metadata: Record<string, string>;
  allowedTools: string[];
  resourceSummary: SkillResourceSummary;
  standardCompliance: SkillStandardCompliance;
  launchEnabled: boolean;
  runtimeGate: string;
}

type RawCapabilityDraftFileSummary = Partial<CapabilityDraftFileSummary> & {
  relative_path?: string;
  byte_length?: number;
};

type RawCapabilityDraftRecord = Partial<CapabilityDraftRecord> & {
  draft_id?: string;
  user_goal?: string;
  source_kind?: string;
  source_refs?: string[];
  permission_summary?: string[];
  generated_files?: RawCapabilityDraftFileSummary[];
  verification_status?: CapabilityDraftStatus;
  last_verification?: RawCapabilityDraftVerificationSummary | null;
  last_registration?: RawCapabilityDraftRegistrationSummary | null;
  created_at?: string;
  updated_at?: string;
  draft_root?: string;
  manifest_path?: string;
};

type RawCapabilityDraftVerificationSummary =
  Partial<CapabilityDraftVerificationSummary> & {
    report_id?: string;
    checked_at?: string;
    failed_check_count?: number;
  };

type RawCapabilityDraftVerificationCheck =
  Partial<CapabilityDraftVerificationCheck> & {
    can_agent_repair?: boolean;
  };

type RawCapabilityDraftVerificationReport =
  Partial<CapabilityDraftVerificationReport> &
    RawCapabilityDraftVerificationSummary & {
      draft_id?: string;
      checks?: RawCapabilityDraftVerificationCheck[];
    };

type RawVerifyCapabilityDraftResult = {
  draft?: RawCapabilityDraftRecord;
  report?: RawCapabilityDraftVerificationReport;
};

type RawCapabilityDraftRegistrationSummary =
  Partial<CapabilityDraftRegistrationSummary> & {
    registration_id?: string;
    registered_at?: string;
    skill_directory?: string;
    registered_skill_directory?: string;
    source_draft_id?: string;
    source_verification_report_id?: string | null;
    generated_file_count?: number;
    permission_summary?: string[];
  };

type RawRegisterCapabilityDraftResult = {
  draft?: RawCapabilityDraftRecord;
  registration?: RawCapabilityDraftRegistrationSummary;
};

type RawSkillResourceSummary = Partial<SkillResourceSummary> & {
  has_scripts?: boolean;
  has_references?: boolean;
  has_assets?: boolean;
};

type RawSkillStandardCompliance = Partial<SkillStandardCompliance> & {
  is_standard?: boolean;
  validation_errors?: string[];
  deprecated_fields?: string[];
};

type RawWorkspaceRegisteredSkillRecord =
  Partial<WorkspaceRegisteredSkillRecord> & {
    registered_skill_directory?: string;
    permission_summary?: string[];
    allowed_tools?: string[];
    resource_summary?: RawSkillResourceSummary;
    standard_compliance?: RawSkillStandardCompliance;
    launch_enabled?: boolean;
    runtime_gate?: string;
  };

function readString(value: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string") {
      return candidate;
    }
  }
  return "";
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeGeneratedFiles(value: unknown): CapabilityDraftFileSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is RawCapabilityDraftFileSummary =>
      Boolean(item && typeof item === "object"),
    )
    .map((item) => ({
      relativePath: item.relativePath ?? item.relative_path ?? "",
      byteLength:
        typeof item.byteLength === "number"
          ? item.byteLength
          : typeof item.byte_length === "number"
            ? item.byte_length
            : 0,
      sha256: typeof item.sha256 === "string" ? item.sha256 : "",
    }))
    .filter((item) => item.relativePath.length > 0);
}

function normalizeStatus(value: unknown): CapabilityDraftStatus {
  if (
    value === "failed_self_check" ||
    value === "verification_failed" ||
    value === "verified_pending_registration" ||
    value === "registered"
  ) {
    return value;
  }
  return "unverified";
}

function normalizeVerificationRunStatus(
  value: unknown,
): CapabilityDraftVerificationRunStatus {
  return value === "passed" ? "passed" : "failed";
}

function normalizeVerificationSummary(
  raw: RawCapabilityDraftVerificationSummary | null | undefined,
): CapabilityDraftVerificationSummary | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  return {
    reportId: readString(record, "reportId", "report_id"),
    status: normalizeVerificationRunStatus(raw.status),
    summary: readString(record, "summary"),
    checkedAt: readString(record, "checkedAt", "checked_at"),
    failedCheckCount:
      typeof raw.failedCheckCount === "number"
        ? raw.failedCheckCount
        : typeof raw.failed_check_count === "number"
          ? raw.failed_check_count
          : 0,
  };
}

function normalizeVerificationChecks(
  value: unknown,
): CapabilityDraftVerificationCheck[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is RawCapabilityDraftVerificationCheck =>
      Boolean(item && typeof item === "object"),
    )
    .map((item): CapabilityDraftVerificationCheck => {
      const record = item as Record<string, unknown>;
      return {
        id: readString(record, "id"),
        label: readString(record, "label"),
        status: item.status === "passed" ? "passed" : "failed",
        message: readString(record, "message"),
        suggestions: normalizeStringArray(item.suggestions),
        canAgentRepair:
          typeof item.canAgentRepair === "boolean"
            ? item.canAgentRepair
            : typeof item.can_agent_repair === "boolean"
              ? item.can_agent_repair
              : item.status !== "passed",
      };
    })
    .filter((item) => item.id.length > 0);
}

function normalizeVerificationReport(
  raw: RawCapabilityDraftVerificationReport,
): CapabilityDraftVerificationReport {
  const summary = normalizeVerificationSummary(raw) ?? {
    reportId: "",
    status: "failed" as const,
    summary: "",
    checkedAt: "",
    failedCheckCount: 0,
  };
  const record = raw as Record<string, unknown>;
  return {
    ...summary,
    draftId: readString(record, "draftId", "draft_id"),
    checks: normalizeVerificationChecks(raw.checks),
  };
}

function normalizeRegistrationSummary(
  raw: RawCapabilityDraftRegistrationSummary | null | undefined,
): CapabilityDraftRegistrationSummary | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const rawSourceVerificationReportId =
    raw.sourceVerificationReportId ?? raw.source_verification_report_id;
  return {
    registrationId: readString(record, "registrationId", "registration_id"),
    registeredAt: readString(record, "registeredAt", "registered_at"),
    skillDirectory: readString(record, "skillDirectory", "skill_directory"),
    registeredSkillDirectory: readString(
      record,
      "registeredSkillDirectory",
      "registered_skill_directory",
    ),
    sourceDraftId: readString(record, "sourceDraftId", "source_draft_id"),
    sourceVerificationReportId:
      typeof rawSourceVerificationReportId === "string"
        ? rawSourceVerificationReportId
        : null,
    generatedFileCount:
      typeof raw.generatedFileCount === "number"
        ? raw.generatedFileCount
        : typeof raw.generated_file_count === "number"
          ? raw.generated_file_count
          : 0,
    permissionSummary: normalizeStringArray(
      raw.permissionSummary ?? raw.permission_summary,
    ),
  };
}

function normalizeRecordStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([key, item]) => [key, item.trim()])
      .filter(([, item]) => item.length > 0),
  );
}

function normalizeResourceSummary(value: unknown): SkillResourceSummary {
  const raw =
    value && typeof value === "object"
      ? (value as RawSkillResourceSummary)
      : {};
  return {
    hasScripts: Boolean(raw.hasScripts ?? raw.has_scripts),
    hasReferences: Boolean(raw.hasReferences ?? raw.has_references),
    hasAssets: Boolean(raw.hasAssets ?? raw.has_assets),
  };
}

function normalizeStandardCompliance(value: unknown): SkillStandardCompliance {
  const raw =
    value && typeof value === "object"
      ? (value as RawSkillStandardCompliance)
      : {};
  return {
    isStandard: Boolean(raw.isStandard ?? raw.is_standard),
    validationErrors: normalizeStringArray(
      raw.validationErrors ?? raw.validation_errors,
    ),
    deprecatedFields: normalizeStringArray(
      raw.deprecatedFields ?? raw.deprecated_fields,
    ),
  };
}

function normalizeWorkspaceRegisteredSkill(
  raw: RawWorkspaceRegisteredSkillRecord,
): WorkspaceRegisteredSkillRecord {
  const record = raw as Record<string, unknown>;
  return {
    key: readString(record, "key"),
    name: readString(record, "name"),
    description: readString(record, "description"),
    directory: readString(record, "directory"),
    registeredSkillDirectory: readString(
      record,
      "registeredSkillDirectory",
      "registered_skill_directory",
    ),
    registration: normalizeRegistrationSummary(raw.registration) ?? {
      registrationId: "",
      registeredAt: "",
      skillDirectory: "",
      registeredSkillDirectory: "",
      sourceDraftId: "",
      sourceVerificationReportId: null,
      generatedFileCount: 0,
      permissionSummary: [],
    },
    permissionSummary: normalizeStringArray(
      raw.permissionSummary ?? raw.permission_summary,
    ),
    metadata: normalizeRecordStringMap(raw.metadata),
    allowedTools: normalizeStringArray(raw.allowedTools ?? raw.allowed_tools),
    resourceSummary: normalizeResourceSummary(
      raw.resourceSummary ?? raw.resource_summary,
    ),
    standardCompliance: normalizeStandardCompliance(
      raw.standardCompliance ?? raw.standard_compliance,
    ),
    launchEnabled:
      typeof raw.launchEnabled === "boolean"
        ? raw.launchEnabled
        : typeof raw.launch_enabled === "boolean"
          ? raw.launch_enabled
          : false,
    runtimeGate: readString(record, "runtimeGate", "runtime_gate"),
  };
}

function normalizeDraft(raw: RawCapabilityDraftRecord): CapabilityDraftRecord {
  const record = raw as Record<string, unknown>;
  return {
    draftId: readString(record, "draftId", "draft_id"),
    name: readString(record, "name"),
    description: readString(record, "description"),
    userGoal: readString(record, "userGoal", "user_goal"),
    sourceKind: readString(record, "sourceKind", "source_kind") || "manual",
    sourceRefs: normalizeStringArray(raw.sourceRefs ?? raw.source_refs),
    permissionSummary: normalizeStringArray(
      raw.permissionSummary ?? raw.permission_summary,
    ),
    generatedFiles: normalizeGeneratedFiles(
      raw.generatedFiles ?? raw.generated_files,
    ),
    verificationStatus: normalizeStatus(
      raw.verificationStatus ?? raw.verification_status,
    ),
    lastVerification: normalizeVerificationSummary(
      raw.lastVerification ?? raw.last_verification,
    ),
    lastRegistration: normalizeRegistrationSummary(
      raw.lastRegistration ?? raw.last_registration,
    ),
    createdAt: readString(record, "createdAt", "created_at"),
    updatedAt: readString(record, "updatedAt", "updated_at"),
    draftRoot: readString(record, "draftRoot", "draft_root"),
    manifestPath: readString(record, "manifestPath", "manifest_path"),
  };
}

export const capabilityDraftsApi = {
  async create(
    request: CreateCapabilityDraftRequest,
  ): Promise<CapabilityDraftRecord> {
    const draft = await safeInvoke<RawCapabilityDraftRecord>(
      "capability_draft_create",
      { request },
    );
    return normalizeDraft(draft);
  },

  async list(
    request: CapabilityDraftListRequest,
  ): Promise<CapabilityDraftRecord[]> {
    const drafts = await safeInvoke<RawCapabilityDraftRecord[]>(
      "capability_draft_list",
      { request },
    );
    if (!Array.isArray(drafts)) {
      return [];
    }
    return drafts.map(normalizeDraft);
  },

  async get(
    request: CapabilityDraftLookupRequest,
  ): Promise<CapabilityDraftRecord | null> {
    const draft = await safeInvoke<RawCapabilityDraftRecord | null>(
      "capability_draft_get",
      { request },
    );
    return draft ? normalizeDraft(draft) : null;
  },

  async verify(
    request: VerifyCapabilityDraftRequest,
  ): Promise<VerifyCapabilityDraftResult> {
    const result = await safeInvoke<RawVerifyCapabilityDraftResult>(
      "capability_draft_verify",
      { request },
    );
    return {
      draft: normalizeDraft(result.draft ?? {}),
      report: normalizeVerificationReport(result.report ?? {}),
    };
  },

  async register(
    request: RegisterCapabilityDraftRequest,
  ): Promise<RegisterCapabilityDraftResult> {
    const result = await safeInvoke<RawRegisterCapabilityDraftResult>(
      "capability_draft_register",
      { request },
    );
    return {
      draft: normalizeDraft(result.draft ?? {}),
      registration: normalizeRegistrationSummary(result.registration) ?? {
        registrationId: "",
        registeredAt: "",
        skillDirectory: "",
        registeredSkillDirectory: "",
        sourceDraftId: "",
        sourceVerificationReportId: null,
        generatedFileCount: 0,
        permissionSummary: [],
      },
    };
  },

  async listRegisteredSkills(
    request: ListWorkspaceRegisteredSkillsRequest,
  ): Promise<WorkspaceRegisteredSkillRecord[]> {
    const skills = await safeInvoke<RawWorkspaceRegisteredSkillRecord[]>(
      "capability_draft_list_registered_skills",
      { request },
    );
    if (!Array.isArray(skills)) {
      return [];
    }
    return skills.map(normalizeWorkspaceRegisteredSkill);
  },
};

export const __capabilityDraftsApiTestUtils = {
  normalizeDraft,
  normalizeGeneratedFiles,
  normalizeVerificationReport,
  normalizeRegistrationSummary,
  normalizeWorkspaceRegisteredSkill,
};
