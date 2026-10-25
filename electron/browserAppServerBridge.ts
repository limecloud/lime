import type {
  ConfigReadResponse,
  ConfigRequirementsReadResponse,
  WorkspaceRightSurfaceRequestResponse,
} from "@limecloud/app-server-client";
import {
  browserSettingsFromConfig,
  effectiveBrowserSettings,
  type BrowserSettings,
} from "../src/lib/api/browserSettingsTypes";
import type {
  ElectronBrowserTabHost,
  BrowserPopupIdentityRequest,
} from "./browserTabHost";
import { assertBrowserRequirements } from "../src/lib/api/browserUseRequirements";
import { readApplicationNetworkRequirements } from "./applicationNetworkPolicy";
import type {
  BrowserToolWorkspaceInput,
  BrowserToolWorkspaceIdentity,
} from "./browserToolWorkspace";

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
    host.setToolWorkspaceHandler({
      open: (input) => this.openToolWorkspace(input),
      reveal: (input) => this.revealToolWorkspace(input),
    });
  }

  async refreshSettings(force = false): Promise<BrowserSettings> {
    if (this.#pending && !force) return this.#pending;
    const revision = ++this.#revision;
    const pending = (async () => {
      const [response, policy] = await Promise.all([
        this.request<ConfigReadResponse>("config/read", {}),
        this.request<ConfigRequirementsReadResponse>(
          "configRequirements/read",
          {},
        ),
      ]);
      assertBrowserRequirements(policy.requirements);
      readApplicationNetworkRequirements(policy.requirements);
      if (revision !== this.#revision) {
        if (this.#pending) return this.#pending;
        throw new Error(
          "Browser settings owner changed while reading configuration",
        );
      }
      const config = record(response.config);
      if (!config)
        throw new Error("Browser config/read returned no configuration");
      await this.host.setApplicationNetworkRequirements(policy.requirements);
      if (revision !== this.#revision) {
        if (this.#pending) return this.#pending;
        throw new Error(
          "Browser network owner changed while applying configuration",
        );
      }
      const settings = browserSettingsFromConfig(config, policy.requirements);
      if (typeof config.language === "string")
        this.host.setSettings(settings, config.language);
      else this.host.setSettings(settings);
      return settings;
    })().catch(async (error: unknown) => {
      if (revision === this.#revision) {
        this.host.setSettings(effectiveBrowserSettings({ enabled: false }));
        try {
          await this.host.setApplicationNetworkRequirements(undefined);
        } catch (revocation) {
          throw new AggregateError(
            [error, revocation],
            "Browser policy read and network revocation failed",
          );
        }
      }
      throw error;
    });
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
      const key = `${ownerWebContentsId}\u0000${threadId}`;
      const previous = this.#sessions.get(key);
      if (
        previous?.runtimeSessionId === runtimeSessionId &&
        (!previous.browserSessionId ||
          previous.browserSessionId === browserSessionId)
      ) {
        previous.browserSessionId = browserSessionId;
      } else {
        this.#sessions.set(key, { runtimeSessionId, browserSessionId });
      }
    }
  }

  reset(): void {
    this.#revision += 1;
    this.#pending = null;
    this.#sessions.clear();
    void this.host
      .setApplicationNetworkRequirements(undefined)
      .catch((error: unknown) => {
        console.error("Browser network revocation failed", error);
      });
  }

  #toolOwner(input: BrowserToolWorkspaceInput) {
    input.assertCurrent();
    const owner = this.#sessions.get(
      `${input.ownerWebContentsId}\u0000${input.threadId}`,
    );
    if (!owner)
      throw new Error(
        "Browser tool requires the current canonical thread owner",
      );
    return owner;
  }

  async openToolWorkspace(
    input: BrowserToolWorkspaceInput,
  ): Promise<BrowserToolWorkspaceIdentity> {
    const owner = this.#toolOwner(input);
    const response = await this.request<WorkspaceRightSurfaceRequestResponse>(
      "workspaceRightSurface/request",
      {
        surfaceKind: "browser",
        origin: "runtime",
        priority: "background",
        reason: "browser_identity_tool",
        sessionId: owner.runtimeSessionId,
        ttlMs: 30_000,
        metadata: { browser: { action: "open", threadId: input.threadId } },
      },
    );
    try {
      const browser = record(record(response.pending.metadata)?.browser);
      const browserSessionId = string(browser?.browserSessionId);
      const tabId = string(browser?.tabId);
      if (
        this.#toolOwner(input) !== owner ||
        browser?.threadId !== input.threadId ||
        !browserSessionId ||
        !tabId ||
        (owner.browserSessionId && owner.browserSessionId !== browserSessionId)
      )
        throw new Error("App Server returned a stale Browser tool identity");
      owner.browserSessionId = browserSessionId;
      return { browserSessionId, tabId };
    } finally {
      await this.request("workspaceRightSurface/pending/consume", {
        requestId: response.requestId,
      });
    }
  }

  async revealToolWorkspace(
    input: BrowserToolWorkspaceInput & BrowserToolWorkspaceIdentity,
  ): Promise<void> {
    const owner = this.#toolOwner(input);
    if (
      owner.browserSessionId &&
      owner.browserSessionId !== input.browserSessionId
    )
      throw new Error("Browser tool workspace session is stale");
    const response = await this.request<WorkspaceRightSurfaceRequestResponse>(
      "workspaceRightSurface/request",
      {
        surfaceKind: "browser",
        origin: "runtime",
        priority: "foreground",
        reason: "browser_tool",
        sessionId: owner.runtimeSessionId,
        ttlMs: 30_000,
        metadata: {
          browser: {
            threadId: input.threadId,
            browserSessionId: input.browserSessionId,
            tabId: input.tabId,
          },
        },
      },
    );
    try {
      if (this.#toolOwner(input) !== owner)
        throw new Error("Browser tool workspace owner changed");
    } catch (error) {
      await this.request("workspaceRightSurface/pending/consume", {
        requestId: response.requestId,
      });
      throw error;
    }
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
