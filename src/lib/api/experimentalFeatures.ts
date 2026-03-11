import { safeInvoke } from "@/lib/dev-bridge";
import type { ExperimentalFeatures } from "@/hooks/useTauri";

export type { ExperimentalFeatures, SmartInputConfig } from "@/hooks/useTauri";

export async function getExperimentalConfig(): Promise<ExperimentalFeatures> {
  return safeInvoke("get_experimental_config");
}

export async function saveExperimentalConfig(
  config: ExperimentalFeatures,
): Promise<void> {
  return safeInvoke("save_experimental_config", {
    experimentalConfig: config,
  });
}

export async function validateShortcut(shortcut: string): Promise<boolean> {
  return safeInvoke("validate_shortcut", { shortcutStr: shortcut });
}

export async function updateScreenshotShortcut(
  shortcut: string,
): Promise<void> {
  return safeInvoke("update_screenshot_shortcut", { newShortcut: shortcut });
}
