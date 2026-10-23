import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { BrowserPermissionAnchor } from "./browserPermissions";
import type {
  BrowserToolCall,
  BrowserToolResult,
  BrowserTabState,
} from "./browserTabHost";
import {
  browserToolCallKey,
  readPositiveInteger,
  readRequiredString,
  readString,
} from "./browserTabState";

export interface PendingBrowserApproval extends BrowserPermissionAnchor {
  kind: "action";
  actionKind: string;
  approvalToken: string;
  arguments: Record<string, unknown>;
  backendNodeId: number | null;
  callId: string;
  snapshotId: string | null;
  targetDescription: string | null;
  tool: string;
}

/** One-use action receipts; canonical user decisions remain in the runtime. */
export class BrowserActionApprovals {
  readonly #pending = new Map<string, PendingBrowserApproval>();

  has(call: BrowserToolCall): boolean {
    return this.#pending.has(browserToolCallKey(call));
  }

  request(
    call: BrowserToolCall,
    anchor: BrowserPermissionAnchor,
    state: BrowserTabState,
    reason: string,
    riskClass: string,
    targetDescription: string | null = null,
  ): BrowserToolResult {
    const key = browserToolCallKey(call);
    if (this.#pending.has(key))
      throw new Error("Browser action approval is already pending");
    const snapshotId = ["click", "fill", "press"].includes(call.tool)
      ? readRequiredString(call.arguments, "snapshotId")
      : readString(call.arguments, "snapshotId");
    const backendNodeId = ["click", "fill"].includes(call.tool)
      ? readPositiveInteger(call.arguments.backendNodeId)
      : null;
    const pending: PendingBrowserApproval = {
      ...anchor,
      kind: "action",
      actionKind: call.tool,
      approvalToken: randomUUID(),
      arguments: structuredClone(call.arguments),
      callId: call.callId,
      tool: call.tool,
      snapshotId,
      backendNodeId,
      targetDescription,
    };
    this.#pending.set(key, pending);
    return {
      status: "approval_required",
      state,
      approval: {
        actionKind: pending.actionKind,
        approvalToken: pending.approvalToken,
        ...(backendNodeId === null ? {} : { backendNodeId }),
        browserSessionId: anchor.browserSessionId,
        reason,
        riskClass,
        snapshotId: snapshotId ?? "none",
        tabId: anchor.tabId,
        viewId: anchor.viewId,
        webContentsId: anchor.webContentsId,
      },
    };
  }

  consume(call: BrowserToolCall): PendingBrowserApproval {
    const key = browserToolCallKey(call);
    const pending = this.#pending.get(key);
    if (!pending || call.approvalToken !== pending.approvalToken)
      throw new Error("Browser action approval token is stale or invalid");
    this.#pending.delete(key);
    if (
      call.tool !== pending.tool ||
      call.threadId !== pending.threadId ||
      call.turnId !== pending.turnId ||
      call.callId !== pending.callId ||
      call.ownerWebContentsId !== pending.ownerWebContentsId ||
      !isDeepStrictEqual(call.arguments, pending.arguments)
    )
      throw new Error("Browser approved action identity mismatch");
    return pending;
  }

  assertRoute(
    pending: PendingBrowserApproval,
    anchor: BrowserPermissionAnchor,
  ): void {
    for (const key of [
      "browserSessionId",
      "tabId",
      "viewId",
      "windowId",
      "pageRevision",
      "webContentsId",
    ] as const)
      if (pending[key] !== anchor[key])
        throw new Error("Browser approved action native route mismatch");
  }

  list(): PendingBrowserApproval[] {
    return [...this.#pending.values()].map((value) => structuredClone(value));
  }

  clear(predicate: (anchor: BrowserPermissionAnchor) => boolean): void {
    for (const [key, pending] of this.#pending)
      if (predicate(pending)) this.#pending.delete(key);
  }
}
