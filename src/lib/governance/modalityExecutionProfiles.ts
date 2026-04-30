import profileRegistry from "./modalityExecutionProfiles.json";

interface ModalityExecutionProfileRecord {
  profile_key?: string;
  lifecycle?: string;
  supported_contracts?: unknown;
  model_role_slots?: unknown;
  permission_profile_keys?: unknown;
  executor_adapter_keys?: unknown;
  artifact_policy?: unknown;
  limecore_policy_refs?: unknown;
  user_lock_policy?: string;
  fallback_behavior?: unknown;
  audit_fields?: unknown;
}

interface ModalityExecutorAdapterRecord {
  adapter_key?: string;
  lifecycle?: string;
  executor_kind?: string;
  binding_key?: string;
  supported_contracts?: unknown;
  supports_progress?: unknown;
  supports_cancel?: unknown;
  supports_resume?: unknown;
  supports_artifact?: unknown;
  artifact_output_kinds?: unknown;
  permission_requirements?: unknown;
  credential_requirements?: unknown;
  failure_mapping?: unknown;
}

interface ModalityExecutorBindingRecord {
  executor_kind?: unknown;
  binding_key?: unknown;
}

export interface ModalityArtifactPolicySnapshot {
  write_mode?: string;
  artifact_kinds: string[];
  viewer_surfaces: string[];
}

export interface ModalityExecutionProfileSnapshot {
  profile_key: string;
  supported_contracts: string[];
  model_role_slots: string[];
  permission_profile_keys: string[];
  executor_adapter_keys: string[];
  artifact_policy?: ModalityArtifactPolicySnapshot;
  limecore_policy_refs: string[];
  user_lock_policy?: string;
  fallback_behavior: string[];
  audit_fields: string[];
}

export interface ModalityExecutorAdapterSnapshot {
  adapter_key: string;
  executor_kind: string;
  binding_key: string;
  supported_contracts: string[];
  supports_progress: boolean;
  supports_cancel: boolean;
  supports_resume: boolean;
  supports_artifact: boolean;
  artifact_output_kinds: string[];
  permission_requirements: string[];
  credential_requirements: string[];
  failure_mapping: string[];
}

export interface ModalityExecutionProfileBinding {
  profileKey: string;
  executorAdapterKey: string | null;
  executionProfile: ModalityExecutionProfileSnapshot;
  executorAdapter?: ModalityExecutorAdapterSnapshot;
}

function asRecord<T extends object>(value: unknown): T | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as T)
    : null;
}

function readTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((item) => readTrimmedString(item))
        .filter((item): item is string => Boolean(item))
    : [];
}

function readBoolean(value: unknown): boolean {
  return value === true;
}

function getProfiles(): ModalityExecutionProfileRecord[] {
  return Array.isArray(profileRegistry.profiles)
    ? profileRegistry.profiles
        .map((profile) => asRecord<ModalityExecutionProfileRecord>(profile))
        .filter((profile): profile is ModalityExecutionProfileRecord =>
          Boolean(profile),
        )
    : [];
}

function getAdapters(): ModalityExecutorAdapterRecord[] {
  return Array.isArray(profileRegistry.executor_adapters)
    ? profileRegistry.executor_adapters
        .map((adapter) => asRecord<ModalityExecutorAdapterRecord>(adapter))
        .filter((adapter): adapter is ModalityExecutorAdapterRecord =>
          Boolean(adapter),
        )
    : [];
}

function toArtifactPolicySnapshot(
  value: unknown,
): ModalityArtifactPolicySnapshot | undefined {
  const policy = asRecord<{
    write_mode?: unknown;
    artifact_kinds?: unknown;
    viewer_surfaces?: unknown;
  }>(value);
  if (!policy) {
    return undefined;
  }
  return {
    write_mode: readTrimmedString(policy.write_mode) ?? undefined,
    artifact_kinds: readStringArray(policy.artifact_kinds),
    viewer_surfaces: readStringArray(policy.viewer_surfaces),
  };
}

function toProfileSnapshot(
  profile: ModalityExecutionProfileRecord,
): ModalityExecutionProfileSnapshot | null {
  const profileKey = readTrimmedString(profile.profile_key);
  if (!profileKey) {
    return null;
  }
  return {
    profile_key: profileKey,
    supported_contracts: readStringArray(profile.supported_contracts),
    model_role_slots: readStringArray(profile.model_role_slots),
    permission_profile_keys: readStringArray(profile.permission_profile_keys),
    executor_adapter_keys: readStringArray(profile.executor_adapter_keys),
    artifact_policy: toArtifactPolicySnapshot(profile.artifact_policy),
    limecore_policy_refs: readStringArray(profile.limecore_policy_refs),
    user_lock_policy: readTrimmedString(profile.user_lock_policy) ?? undefined,
    fallback_behavior: readStringArray(profile.fallback_behavior),
    audit_fields: readStringArray(profile.audit_fields),
  };
}

function toAdapterSnapshot(
  adapter: ModalityExecutorAdapterRecord,
): ModalityExecutorAdapterSnapshot | null {
  const adapterKey = readTrimmedString(adapter.adapter_key);
  const executorKind = readTrimmedString(adapter.executor_kind);
  const bindingKey = readTrimmedString(adapter.binding_key);
  if (!adapterKey || !executorKind || !bindingKey) {
    return null;
  }
  return {
    adapter_key: adapterKey,
    executor_kind: executorKind,
    binding_key: bindingKey,
    supported_contracts: readStringArray(adapter.supported_contracts),
    supports_progress: readBoolean(adapter.supports_progress),
    supports_cancel: readBoolean(adapter.supports_cancel),
    supports_resume: readBoolean(adapter.supports_resume),
    supports_artifact: readBoolean(adapter.supports_artifact),
    artifact_output_kinds: readStringArray(adapter.artifact_output_kinds),
    permission_requirements: readStringArray(adapter.permission_requirements),
    credential_requirements: readStringArray(adapter.credential_requirements),
    failure_mapping: readStringArray(adapter.failure_mapping),
  };
}

export function resolveExecutorAdapterKey(
  executorBinding: unknown,
): string | null {
  const executor = asRecord<ModalityExecutorBindingRecord>(executorBinding);
  const executorKind = readTrimmedString(executor?.executor_kind);
  const bindingKey = readTrimmedString(executor?.binding_key);
  return executorKind && bindingKey ? `${executorKind}:${bindingKey}` : null;
}

export function resolveModalityExecutionProfileBinding(params: {
  contractKey: string;
  executorBinding?: unknown;
}): ModalityExecutionProfileBinding | null {
  const contractKey = params.contractKey.trim();
  if (!contractKey) {
    return null;
  }

  const profile = getProfiles().find((candidate) =>
    readStringArray(candidate.supported_contracts).includes(contractKey),
  );
  const executionProfile = profile ? toProfileSnapshot(profile) : null;
  if (!executionProfile) {
    return null;
  }

  const adapterKey =
    resolveExecutorAdapterKey(params.executorBinding) ??
    executionProfile.executor_adapter_keys[0] ??
    null;
  const executorAdapter = adapterKey
    ? getAdapters()
        .map(toAdapterSnapshot)
        .find((adapter) => adapter?.adapter_key === adapterKey)
    : undefined;

  return {
    profileKey: executionProfile.profile_key,
    executorAdapterKey: adapterKey,
    executionProfile,
    executorAdapter: executorAdapter ?? undefined,
  };
}
