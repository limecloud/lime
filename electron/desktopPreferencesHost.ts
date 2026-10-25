import type {
  ConfigReadResponse,
  JsonRpcMessage,
} from "@limecloud/app-server-client";
import type { PowerSaveHost } from "./powerSaveHost";
import type { ConfirmBeforeClose } from "../src/lib/desktop-host/windowCloseConfirmation";

type Request = <T>(method: string, params: unknown) => Promise<T>;

/** Apply shared Desktop preferences to platform resources without another store. */
export class DesktopPreferencesHost {
  #revision = 0;
  #pending: Promise<void> | null = null;
  #stopped = false;
  // Until config has loaded, a close request must not bypass a saved Always choice.
  confirmBeforeClose: ConfirmBeforeClose = "always";

  constructor(
    readonly options: {
      platform: string;
      request: Request;
      setMacMenuBarEnabled(enabled: boolean): void;
      powerSaveHost?: PowerSaveHost;
    },
  ) {}

  async refresh(force = false): Promise<void> {
    if (this.#stopped) return;
    if (this.#pending && !force) return this.#pending;
    const revision = ++this.#revision;
    const pending = (async () => {
      const response = await this.options.request<ConfigReadResponse>(
        "config/read",
        {},
      );
      if (revision !== this.#revision) return;
      const config = record(response.config);
      if (!config)
        throw new Error("config/read returned invalid Desktop config");
      const desktop = config.desktop == null ? {} : record(config.desktop);
      if (!desktop) throw new Error("Invalid Desktop preferences");
      const confirmClose = desktop["confirm-before-close"];
      if (
        confirmClose != null &&
        (typeof confirmClose !== "string" ||
          !["never", "keyboardOnly", "always"].includes(confirmClose))
      )
        throw new Error("Invalid window close preference");
      const enabled = desktop["mac-menu-bar-enabled"];
      if (enabled != null && typeof enabled !== "boolean")
        throw new Error("Invalid macOS menu bar preference");
      const preventSleep = desktop.preventSleepWhileRunning;
      if (preventSleep != null && typeof preventSleep !== "boolean")
        throw new Error("Invalid prevent sleep preference");
      this.confirmBeforeClose = (confirmClose ??
        "keyboardOnly") as ConfirmBeforeClose;
      if (this.options.platform === "darwin")
        this.options.setMacMenuBarEnabled(enabled !== false);
      this.options.powerSaveHost?.setPreventSleepWhileRunning(
        preventSleep === true,
      );
    })();
    this.#pending = pending;
    try {
      await pending;
    } finally {
      if (this.#pending === pending) this.#pending = null;
    }
  }

  async observeResult(
    method: string,
    result?: unknown,
    params?: unknown,
  ): Promise<void> {
    this.options.powerSaveHost?.observeResult(method, result, params);
    if (method === "config/batchWrite" || method === "config/value/write")
      await this.refresh(true);
  }

  observeServerMessage(message: JsonRpcMessage): void {
    this.options.powerSaveHost?.observeServerMessage(message);
  }

  connectionLost(): void {
    this.#revision += 1;
    this.#pending = null;
    this.options.powerSaveHost?.connectionLost();
  }

  reset(): void {
    this.#stopped = true;
    this.#revision += 1;
    this.#pending = null;
    this.options.powerSaveHost?.dispose();
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
