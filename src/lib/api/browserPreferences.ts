import { normalizeBrowserSitePattern } from "./browserUseConfig";

export type BrowserApprovalMode = "alwaysAsk" | "neverAsk";
export type BrowserHistoryAccess = BrowserApprovalMode | "disabled";
export interface BrowserPreferences {
  enabled: boolean;
  show_full_url: boolean;
  annotation_screenshot: "always" | "necessary";
  download_directory: string | null;
  ask_download_location: boolean;
  approvalMode: BrowserApprovalMode;
  downloadApprovalMode: BrowserApprovalMode;
  uploadApprovalMode: BrowserApprovalMode;
  iabHistoryApprovalMode: BrowserHistoryAccess;
  fullCdpAccessEnabled: boolean;
  webMcpEnabled: boolean;
  allowedOrigins: string[];
  deniedOrigins: string[];
  allowedDownloadOrigins: string[];
  deniedDownloadOrigins: string[];
  allowedUploadOrigins: string[];
  deniedUploadOrigins: string[];
  allowedFullCdpOrigins: string[];
  deniedFullCdpOrigins: string[];
  allowedWebMcpOrigins: string[];
  deniedWebMcpOrigins: string[];
}

export const BROWSER_ORIGIN_LISTS = [
  "allowedOrigins",
  "deniedOrigins",
  "allowedDownloadOrigins",
  "deniedDownloadOrigins",
  "allowedUploadOrigins",
  "deniedUploadOrigins",
  "allowedFullCdpOrigins",
  "deniedFullCdpOrigins",
  "allowedWebMcpOrigins",
  "deniedWebMcpOrigins",
] as const;

const DEFAULT_PREFERENCES: BrowserPreferences = {
  enabled: true,
  show_full_url: false,
  annotation_screenshot: "always",
  download_directory: null,
  ask_download_location: false,
  approvalMode: "alwaysAsk",
  downloadApprovalMode: "alwaysAsk",
  uploadApprovalMode: "alwaysAsk",
  iabHistoryApprovalMode: "alwaysAsk",
  fullCdpAccessEnabled: false,
  webMcpEnabled: true,
  allowedOrigins: [],
  deniedOrigins: [],
  allowedDownloadOrigins: [],
  deniedDownloadOrigins: [],
  allowedUploadOrigins: [],
  deniedUploadOrigins: [],
  allowedFullCdpOrigins: [],
  deniedFullCdpOrigins: [],
  allowedWebMcpOrigins: [],
  deniedWebMcpOrigins: [],
};

export function effectiveBrowserPreferences(
  value?: Partial<BrowserPreferences>,
): BrowserPreferences {
  if (
    value !== undefined &&
    (!value || typeof value !== "object" || Array.isArray(value))
  )
    throw new Error("Invalid browser preferences");
  if (
    Object.keys(value ?? {}).some(
      (key) => !Object.hasOwn(DEFAULT_PREFERENCES, key),
    )
  )
    throw new Error("Unknown browser preference");
  const next = { ...DEFAULT_PREFERENCES, ...value };
  for (const key of [
    "enabled",
    "show_full_url",
    "ask_download_location",
    "fullCdpAccessEnabled",
    "webMcpEnabled",
  ] as const)
    if (typeof next[key] !== "boolean")
      throw new Error(`Invalid browser preference: ${key}`);
  for (const key of [
    "approvalMode",
    "downloadApprovalMode",
    "uploadApprovalMode",
  ] as const)
    if (!["alwaysAsk", "neverAsk"].includes(next[key]))
      throw new Error(`Invalid browser preference: ${key}`);
  if (
    !["alwaysAsk", "neverAsk", "disabled"].includes(
      next.iabHistoryApprovalMode,
    ) ||
    !["always", "necessary"].includes(next.annotation_screenshot) ||
    (next.download_directory !== null &&
      typeof next.download_directory !== "string")
  )
    throw new Error("Invalid browser preferences");
  for (const key of BROWSER_ORIGIN_LISTS) {
    if (!Array.isArray(next[key])) throw new Error("Invalid browser origins");
    next[key] = [
      ...new Set(
        next[key].map((pattern) => {
          const normalized =
            typeof pattern === "string" && normalizeBrowserSitePattern(pattern);
          if (!normalized) throw new Error("Invalid browser origin");
          return normalized;
        }),
      ),
    ];
  }
  return next;
}

/** Strip UI projections before writing the single canonical preference table. */
export function browserPreferences(
  settings: BrowserPreferences,
): BrowserPreferences {
  const value = Object.fromEntries(
    Object.keys(DEFAULT_PREFERENCES).map((key) => [
      key,
      settings[key as keyof BrowserPreferences],
    ]),
  );
  return effectiveBrowserPreferences(value);
}
