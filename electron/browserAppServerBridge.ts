import type {
  ConfigReadResponse,
  ConfigRequirementsReadResponse,
  WorkspaceRightSurfaceRequestResponse,
} from "@limecloud/app-server-client";
import {
  browserSettingsFromConfig,
  type BrowserSettings,
} from "../src/lib/api/browserSettingsTypes";
import type {
  ElectronBrowserTabHost,
  BrowserPopupIdentityRequest,
} from "./browserTabHost";
import { assertBrowserRequirements } from "../src/lib/api/browserUseRequirements";

type Request = <T>(method: string, params?: unknown) => Promise<T>;
const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const string = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

/** Native resources consume canonical config and identities without persisting another authority. */
export class BrowserAppServerBridge {
  #revision = 0;
  #pending: Promise<BrowserSettings> | null = null;
  readonly #sessions = new Map<
    string,
    { runtimeSessionId: string; browserSessionId: string | null }
  >();

  constructor(
    readonly host: ElectronBrowserTabHost,
    readonly request: Request,
  ) {
    host.setSettingsProvider(() => this.refreshSettings());
    host.setPopupIdentityHandler((request) =>
      this.createPopupIdentity(request),
    );
  }

  async refreshSettings(force = false): Promise<BrowserSettings> {
    if (this.#pending && !force) return this.#pending;
    const revision = ++this.#revision;
    const pending = (async () => {
      const [response, policy] = await Promise.all([
        this.request<ConfigReadResponse>("config/read", {}),
        this.request<ConfigRequirementsReadResponse>("configRequirements/read", {}),
      ]);
      assertBrowserRequirements(policy.requirements);
      if (revision !== this.#revision) {
        if (this.#pending) return this.#pending;
        throw new Error(
          "Browser settings owner changed while reading configuration",
        );
      }
      const config = record(response.config);
      if (!config)
        throw new Error("Browser config/read returned no configuration");
      const settings = browserSettingsFromConfig(config, policy.requirements);
      if (typeof config.language === "string")
        this.host.setSettings(settings, config.language);
      else this.host.setSettings(settings);
      return settings;
    })();
    this.#pending = pending;
    try {
      return await pending;
    } finally {
      if (this.#pending === pending) this.#pending = null;
    }
  }

  async observeResult(
    method: string,
    params: unknown,
    result: unknown,
    ownerWebContentsId?: number,
  ): Promise<void> {
    if (
      ownerWebContentsId &&
      (method === "thread/start" ||
        method === "thread/resume" ||
        method === "thread/read")
    ) {
      const thread = record(record(result)?.thread);
      const threadId = string(thread?.id);
      const runtimeSessionId = string(thread?.sessionId);
      if (threadId && runtimeSessionId) {
        const key = `${ownerWebContentsId}\u0000${threadId}`;
        const previous = this.#sessions.get(key);
        if (previous?.runtimeSessionId !== runtimeSessionId)
          this.#sessions.set(key, { runtimeSessionId, browserSessionId: null });
      }
      return;
    }
    if (method === "config/batchWrite" || method === "config/value/write") {
      await this.refreshSettings(true);
      return;
    }
    if (method !== "workspaceRightSurface/request" || !ownerWebContentsId)
      return;
    const input = record(params);
    const metadata = record(record(record(result)?.pending)?.metadata);
    const browser = record(metadata?.browser);
    const runtimeSessionId = string(input?.sessionId);
    const threadId = string(browser?.threadId);
    const browserSessionId = string(browser?.browserSessionId);
    if (
      input?.surfaceKind === "browser" &&
      runtimeSessionId &&
      threadId &&
      browserSessionId
    ) {
      this.#sessions.set(`${ownerWebContentsId}\u0000${threadId}`, {
        runtimeSessionId,
        browserSessionId,
      });
    }
  }

  reset(): void {
    this.#revision += 1;
    this.#pending = null;
    this.#sessions.clear();
  }

  async createPopupIdentity(
    input: BrowserPopupIdentityRequest,
  ): Promise<{ browserSessionId: string; tabId: string }> {
    const owner = this.#sessions.get(
      `${input.ownerWebContentsId}\u0000${input.threadId}`,
    );
    if (
      !owner ||
      (owner.browserSessionId &&
        owner.browserSessionId !== input.browserSessionId)
    ) {
      throw new Error(
        "Browser popup requires the current canonical workspace owner",
      );
    }
    const response = await this.request<WorkspaceRightSurfaceRequestResponse>(
      "workspaceRightSurface/request",
      {
        surfaceKind: "browser",
        origin: "renderer",
        priority: "background",
        reason: "browser_identity_popup",
        sessionId: owner.runtimeSessionId,
        ttlMs: 30_000,
        metadata: {
          browser: {
            action: "createTab",
            browserSessionId: input.browserSessionId,
            threadId: input.threadId,
          },
        },
      },
    );
    try {
      const browser = record(record(response.pending.metadata)?.browser);
      const tabId = string(browser?.tabId);
      if (
        !tabId ||
        browser?.browserSessionId !== input.browserSessionId ||
        browser?.threadId !== input.threadId ||
        this.#sessions.get(
          `${input.ownerWebContentsId}\u0000${input.threadId}`,
        ) !== owner
      ) {
        throw new Error("App Server returned a stale Browser popup identity");
      }
      return { browserSessionId: input.browserSessionId, tabId };
    } finally {
      await this.request("workspaceRightSurface/pending/consume", {
        requestId: response.requestId,
      });
    }
  }
}
