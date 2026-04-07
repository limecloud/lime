import {
  closeWebviewPanel,
  createWebviewPanel,
  focusWebviewPanel,
  getWebviewPanels,
  navigateWebviewPanel,
} from "@/lib/webview-api";

const OPENCLAW_DASHBOARD_PANEL_ID = "openclaw-dashboard";
const OPENCLAW_DASHBOARD_TITLE = "OpenClaw Dashboard";
const OPENCLAW_DASHBOARD_WIDTH = 1280;
const OPENCLAW_DASHBOARD_HEIGHT = 860;
const OPENCLAW_DASHBOARD_REFRESH_PARAM = "__lime_openclaw_ui_rev";
const OPENCLAW_DASHBOARD_PROFILE_PREFIX = "openclaw-dashboard-profile";

export interface OpenClawDashboardWindowOpenResult {
  reused: boolean;
}

export interface OpenClawDashboardWindowOptions {
  forceRecreate?: boolean;
  profileVersionKey?: string | null;
}

export async function isOpenClawDashboardWindowOpen(): Promise<boolean> {
  const panels = await getWebviewPanels();
  return panels.some((panel) => panel.id === OPENCLAW_DASHBOARD_PANEL_ID);
}

function sanitizeDashboardProfileKeyPart(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "default"
  );
}

export function resolveOpenClawDashboardProfileKey(
  profileVersionKey?: string | null,
): string {
  const normalized = profileVersionKey?.trim();
  if (!normalized) {
    return OPENCLAW_DASHBOARD_PROFILE_PREFIX;
  }

  return `${OPENCLAW_DASHBOARD_PROFILE_PREFIX}-${sanitizeDashboardProfileKeyPart(normalized)}`;
}

function withDashboardWindowRefreshParam(url: string): string {
  const refreshToken = `${Date.now()}`;

  try {
    const parsed = new URL(url);
    parsed.searchParams.set(OPENCLAW_DASHBOARD_REFRESH_PARAM, refreshToken);
    return parsed.toString();
  } catch {
    const [base, hash = ""] = url.split("#", 2);
    const separator = base.includes("?") ? "&" : "?";
    return `${base}${separator}${OPENCLAW_DASHBOARD_REFRESH_PARAM}=${refreshToken}${hash ? `#${hash}` : ""}`;
  }
}

export async function openOpenClawDashboardWindow(
  url: string,
  options: OpenClawDashboardWindowOptions = {},
): Promise<OpenClawDashboardWindowOpenResult> {
  const profileKey = resolveOpenClawDashboardProfileKey(
    options.profileVersionKey,
  );
  if (options.forceRecreate) {
    await closeWebviewPanel(OPENCLAW_DASHBOARD_PANEL_ID);
  }

  const exists = await isOpenClawDashboardWindowOpen();
  const nextUrl = withDashboardWindowRefreshParam(url);

  if (exists) {
    await navigateWebviewPanel(OPENCLAW_DASHBOARD_PANEL_ID, nextUrl);
    await focusWebviewPanel(OPENCLAW_DASHBOARD_PANEL_ID);
    return { reused: true };
  }

  const result = await createWebviewPanel({
    panel_id: OPENCLAW_DASHBOARD_PANEL_ID,
    url: nextUrl,
    title: OPENCLAW_DASHBOARD_TITLE,
    x: 0,
    y: 0,
    width: OPENCLAW_DASHBOARD_WIDTH,
    height: OPENCLAW_DASHBOARD_HEIGHT,
    profile_key: profileKey,
    persistent_profile: true,
  });

  if (!result.success) {
    throw new Error(result.error ?? "打开 Dashboard 桌面面板失败");
  }

  return { reused: false };
}

export async function focusOpenClawDashboardWindow(): Promise<boolean> {
  return focusWebviewPanel(OPENCLAW_DASHBOARD_PANEL_ID);
}

export async function reloadOpenClawDashboardWindow(
  url: string,
): Promise<boolean> {
  const exists = await isOpenClawDashboardWindowOpen();
  if (!exists) {
    return false;
  }

  return navigateWebviewPanel(
    OPENCLAW_DASHBOARD_PANEL_ID,
    withDashboardWindowRefreshParam(url),
  );
}

export async function closeOpenClawDashboardWindow(): Promise<boolean> {
  return closeWebviewPanel(OPENCLAW_DASHBOARD_PANEL_ID);
}
