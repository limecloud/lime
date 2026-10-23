import {
  browserPermissionForUrl,
  effectiveBrowserSettings,
  type BrowserSettings,
  type BrowserPermissionAction,
  type BrowserPermission,
} from "../src/lib/api/browserSettingsTypes";
import type { BrowserToolCall } from "./browserTabHost";
import { isDeepStrictEqual } from "node:util";

export class BrowserTabPolicy {
  #settings = effectiveBrowserSettings();
  #revision = 0;

  setSettings(settings: BrowserSettings): boolean {
    const next = effectiveBrowserSettings(settings);
    if (isDeepStrictEqual(this.#settings, next)) return false;
    this.#settings = next;
    this.#revision += 1;
    return true;
  }

  get enabled(): boolean {
    return this.#settings.enabled;
  }

  get revision(): number {
    return this.#revision;
  }

  get historyAccess(): BrowserSettings["history_access"] {
    return this.#settings.history_access;
  }

  decision(action: BrowserPermissionAction, url: string): BrowserPermission {
    if (!this.enabled) return "deny";
    if (action === "debug" && !this.#settings.full_cdp_access) return "deny";
    if (action === "site_tools" && !this.#settings.site_tools_enabled)
      return "deny";
    return browserPermissionForUrl(this.#settings, action, url);
  }

  allows(action: BrowserPermissionAction, url: string): boolean {
    return this.decision(action, url) === "allow";
  }

  assertTool(call: BrowserToolCall, url?: string): void {
    if (!this.enabled)
      throw new Error("Browser Agent control is disabled in settings");
    if (!url) return;
    const target =
      call.tool === "goto" || call.tool === "newTab"
        ? String(call.arguments.url ?? "")
        : url;
    if (this.decision("browse", target) === "deny")
      throw new Error("Browser Agent browsing is denied for this site");
    if (
      call.tool === "uploadArtifact" &&
      this.decision("upload", target) === "deny"
    )
      throw new Error("Browser Agent uploads are denied for this site");
  }
}
