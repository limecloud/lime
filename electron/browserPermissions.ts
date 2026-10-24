import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { BrowserToolCall, BrowserToolResult } from "./browserTabHost";
import type { BrowserTabPolicy } from "./browserTabPolicy";
import { browserToolCallKey } from "./browserTabState";

export interface BrowserPermissionScope {
  ownerWebContentsId: number;
  windowId: number;
  threadId: string;
  browserSessionId: string;
  turnId: string;
}

export interface BrowserPermissionAnchor extends BrowserPermissionScope {
  tabId: string;
  viewId: string;
  webContentsId: number;
  pageRevision: number;
}

export interface PendingBrowseApproval extends BrowserPermissionAnchor {
  kind: "browse";
  actionKind: "browse";
  approvalToken: string;
  arguments: Record<string, unknown>;
  callId: string;
  tool: string;
  origin: string;
  snapshotId: string;
  accessApprovalLifetime: "turn" | "thread";
  policyRevision: number;
}

interface BrowseGrant extends BrowserPermissionScope {
  accessApprovalLifetime: "turn" | "thread";
  policyRevision: number;
}

const threadApprovalText = {
  "zh-CN": (origin: string) => `允许 Agent 在此会话中浏览 ${origin}`,
  "zh-TW": (origin: string) => `允許 Agent 在此對話中瀏覽 ${origin}`,
  "en-US": (origin: string) =>
    `Allow Agent browsing of ${origin} for this conversation`,
  "ja-JP": (origin: string) =>
    `この会話で Agent が ${origin} を閲覧することを許可`,
  "ko-KR": (origin: string) => `이 대화에서 Agent의 ${origin} 탐색 허용`,
} as const;

const turnApprovalText = {
  "zh-CN": (origin: string) => `允许 Agent 在此回合中浏览 ${origin}`,
  "zh-TW": (origin: string) => `允許 Agent 在此回合中瀏覽 ${origin}`,
  "en-US": (origin: string) =>
    `Allow Agent browsing of ${origin} for this turn`,
  "ja-JP": (origin: string) =>
    `このターンで Agent が ${origin} を閲覧することを許可`,
  "ko-KR": (origin: string) => `이 턴에서 Agent의 ${origin} 탐색 허용`,
} satisfies Record<keyof typeof threadApprovalText, (origin: string) => string>;

export function browserPermissionOrigin(url: string): string {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new Error("Browser permission requires an HTTP(S) origin");
  }
  if (
    !["http:", "https:"].includes(target.protocol) ||
    target.username ||
    target.password
  )
    throw new Error("Browser permission requires an HTTP(S) origin");
  return target.origin;
}

function scopeKey(
  scope: BrowserPermissionScope,
  origin: string,
  lifetime: "turn" | "thread",
): string {
  return JSON.stringify([
    scope.ownerWebContentsId,
    scope.windowId,
    scope.threadId,
    scope.browserSessionId,
    lifetime === "turn" ? scope.turnId : null,
    origin,
  ]);
}

/** Scoped Agent browsing receipts; Chromium device permissions have a separate owner. */
export class BrowserPermissions {
  readonly #policy: BrowserTabPolicy;
  readonly #grants = new Map<string, BrowseGrant>();
  readonly #pending = new Map<string, PendingBrowseApproval>();
  #locale: keyof typeof threadApprovalText = "en-US";

  constructor(policy: BrowserTabPolicy) {
    this.#policy = policy;
  }

  setLocale(locale: string): void {
    this.#locale = Object.hasOwn(threadApprovalText, locale)
      ? (locale as keyof typeof threadApprovalText)
      : "en-US";
  }

  allows(scope: BrowserPermissionScope, url: string): boolean {
    let origin: string;
    try {
      origin = browserPermissionOrigin(url);
    } catch {
      return false;
    }
    const decision = this.#policy.decision("browse", url);
    const grant = this.#grants.get(
      scopeKey(scope, origin, this.#policy.accessApprovalLifetime(url)),
    );
    return (
      decision === "allow" ||
      (decision === "ask" && grant?.policyRevision === this.#policy.revision)
    );
  }

  require(
    call: BrowserToolCall,
    anchor: BrowserPermissionAnchor,
    url: string,
  ): BrowserToolResult | null {
    const origin = browserPermissionOrigin(url);
    if (this.#policy.decision("browse", url) === "deny")
      throw new Error(`Browser Agent browsing is denied for ${origin}`);
    if (this.allows(anchor, url)) return null;
    const lifetime = this.#policy.accessApprovalLifetime(url);
    const key = browserToolCallKey(call);
    if (this.#pending.has(key))
      throw new Error("Browser browsing approval is already pending");
    const approval: PendingBrowseApproval = {
      ...anchor,
      kind: "browse",
      actionKind: "browse",
      approvalToken: randomUUID(),
      arguments: structuredClone(call.arguments),
      callId: call.callId,
      tool: call.tool,
      origin,
      snapshotId: `page:${anchor.pageRevision}`,
      accessApprovalLifetime: lifetime,
      policyRevision: this.#policy.revision,
    };
    this.#pending.set(key, approval);
    return {
      status: "approval_required",
      approval: {
        actionKind: "browse",
        approvalToken: approval.approvalToken,
        browserSessionId: anchor.browserSessionId,
        reason:
          lifetime === "thread"
            ? threadApprovalText[this.#locale](origin)
            : turnApprovalText[this.#locale](origin),
        riskClass: "browse",
        snapshotId: approval.snapshotId,
        tabId: anchor.tabId,
        viewId: anchor.viewId,
        webContentsId: anchor.webContentsId,
      },
    };
  }

  /** Consumes a browse stage once; action approvals continue through their own owner. */
  consume(call: BrowserToolCall, anchor: BrowserPermissionAnchor): boolean {
    const key = browserToolCallKey(call);
    const pending = this.#pending.get(key);
    if (!pending) return false;
    if (call.approvalToken !== pending.approvalToken)
      throw new Error("Browser browsing approval token is stale or invalid");
    this.#pending.delete(key);
    if (
      pending.policyRevision !== this.#policy.revision ||
      call.tool !== pending.tool ||
      call.callId !== pending.callId ||
      !isDeepStrictEqual(call.arguments, pending.arguments) ||
      !isDeepStrictEqual(anchor, {
        ownerWebContentsId: pending.ownerWebContentsId,
        windowId: pending.windowId,
        threadId: pending.threadId,
        browserSessionId: pending.browserSessionId,
        turnId: pending.turnId,
        tabId: pending.tabId,
        viewId: pending.viewId,
        webContentsId: pending.webContentsId,
        pageRevision: pending.pageRevision,
      })
    )
      throw new Error(
        "Browser approved browsing identity or page revision mismatch",
      );
    if (this.#policy.decision("browse", pending.origin) === "deny")
      throw new Error(`Browser Agent browsing is denied for ${pending.origin}`);
    this.#grants.set(
      scopeKey(anchor, pending.origin, pending.accessApprovalLifetime),
      {
        ownerWebContentsId: anchor.ownerWebContentsId,
        windowId: anchor.windowId,
        threadId: anchor.threadId,
        browserSessionId: anchor.browserSessionId,
        turnId: anchor.turnId,
        accessApprovalLifetime: pending.accessApprovalLifetime,
        policyRevision: this.#policy.revision,
      },
    );
    return true;
  }

  assertAllowed(scope: BrowserPermissionScope, url: string): void {
    if (!this.allows(scope, url))
      throw new Error(
        `Browser browsing grant is unavailable for ${browserPermissionOrigin(url)}; retry the tool to request access`,
      );
  }

  pending(): PendingBrowseApproval[] {
    return [...this.#pending.values()].map((value) => structuredClone(value));
  }
  hasPending(call: BrowserToolCall): boolean {
    return this.#pending.has(browserToolCallKey(call));
  }

  clearPending(predicate: (pending: PendingBrowseApproval) => boolean): void {
    for (const [key, pending] of this.#pending)
      if (predicate(pending)) this.#pending.delete(key);
  }

  turnEnded(threadId: string, turnId: string): void {
    this.revoke(
      (scope) => scope.threadId === threadId && scope.turnId === turnId,
      true,
    );
  }

  revoke(
    predicate: (scope: BrowserPermissionScope) => boolean = () => true,
    preserveThreadGrants = false,
  ): void {
    for (const [key, scope] of this.#grants)
      if (
        predicate(scope) &&
        !(preserveThreadGrants && scope.accessApprovalLifetime === "thread")
      )
        this.#grants.delete(key);
    this.clearPending(predicate);
  }
}
