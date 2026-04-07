import type { AutoContinueSettings } from "../types";

const STORAGE_KEY_PREFIX = "lime_doc_auto_continue_settings_project_";

export const DEFAULT_AUTO_CONTINUE_SETTINGS: AutoContinueSettings = {
  enabled: true,
  fastModeEnabled: false,
  continuationLength: 0,
  sensitivity: 40,
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const normalizeBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const normalizeNumber = (
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }
  return clamp(Math.round(value), min, max);
};

const normalizeProjectId = (projectId?: string | null): string => {
  const normalized = (projectId || "").trim();
  return normalized || "default";
};

export const getAutoContinueSettingsStorageKey = (
  projectId?: string | null,
): string => `${STORAGE_KEY_PREFIX}${normalizeProjectId(projectId)}`;

export const sanitizeAutoContinueSettings = (
  input: Partial<AutoContinueSettings> | null | undefined,
): AutoContinueSettings => {
  return {
    enabled: normalizeBoolean(
      input?.enabled,
      DEFAULT_AUTO_CONTINUE_SETTINGS.enabled,
    ),
    fastModeEnabled: normalizeBoolean(
      input?.fastModeEnabled,
      DEFAULT_AUTO_CONTINUE_SETTINGS.fastModeEnabled,
    ),
    continuationLength: normalizeNumber(
      input?.continuationLength,
      DEFAULT_AUTO_CONTINUE_SETTINGS.continuationLength,
      0,
      2,
    ),
    sensitivity: normalizeNumber(
      input?.sensitivity,
      DEFAULT_AUTO_CONTINUE_SETTINGS.sensitivity,
      0,
      100,
    ),
  };
};

export const loadAutoContinueSettings = (
  projectId?: string | null,
): AutoContinueSettings => {
  try {
    const stored = localStorage.getItem(
      getAutoContinueSettingsStorageKey(projectId),
    );
    if (!stored) {
      return DEFAULT_AUTO_CONTINUE_SETTINGS;
    }
    const parsed = JSON.parse(stored) as Partial<AutoContinueSettings>;
    return sanitizeAutoContinueSettings(parsed);
  } catch {
    return DEFAULT_AUTO_CONTINUE_SETTINGS;
  }
};

export const saveAutoContinueSettings = (
  projectId: string | null | undefined,
  settings: AutoContinueSettings,
): void => {
  try {
    localStorage.setItem(
      getAutoContinueSettingsStorageKey(projectId),
      JSON.stringify(sanitizeAutoContinueSettings(settings)),
    );
  } catch {
    // ignore persistence errors
  }
};
