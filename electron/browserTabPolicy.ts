import {
  browserPermissionForUrl,
  effectiveBrowserSettings,
  validateBrowserSettings,
  type BrowserSettings,
  type BrowserPermissionAction,
  type BrowserPermission,
} from "../src/lib/api/browserSettingsTypes";
import type { BrowserToolCall } from "./browserTabHost";
import { isDeepStrictEqual } from "node:util";
import { managedBrowserAccessApprovalLifetime } from "../src/lib/api/browserUseRequirements";
import { isBrowserCdpTool } from "./browserCdp";

export class BrowserTabPolicy {
  #settings = effectiveBrowserSettings();
  #revision = 0;

  setSettings(settings: BrowserSettings): boolean {
    const next = validateBrowserSettings(settings);
    if (isDeepStrictEqual(this.#settings, next)) return false;
    this.#settings = next;
    this.#revision += 1;
    return true;
  }

  get enabled(): boolean {
    return (
      this.#settings.enabled &&
      this.#settings.requirements?.allowBrowserAndComputerUse !== false
    );
  }

  get revision(): number {
    return this.#revision;
  }

  /** Independent managed authority changes invalidate work using earlier policy. */
  invalidate(): void {
    this.#revision += 1;
  }

  assertCurrent(revision: number): void {
    if (revision !== this.#revision)
      throw new Error("Browser policy changed during tool execution");
  }

  get historyAccess(): BrowserSettings["history_access"] {
    return this.#settings.history_access;
  }

  accessApprovalLifetime(url: string): "turn" | "thread" {
    return managedBrowserAccessApprovalLifetime(
      this.#settings.requirements,
      new URL(url),
    );
  }

  decision(action: BrowserPermissionAction, url: string): BrowserPermission {
    if (!this.enabled) return "deny";
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
      isBrowserCdpTool(call.tool) &&
      this.decision("debug", target) === "deny"
    )
      throw new Error("Browser full CDP access is denied for this page");
    if (
      call.tool === "uploadArtifact" &&
      this.decision("upload", target) === "deny"
    )
      throw new Error("Browser Agent uploads are denied for this site");
  }
}
