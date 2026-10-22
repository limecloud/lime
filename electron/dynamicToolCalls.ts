import { isDeepStrictEqual } from "node:util";
import type { DynamicToolCallParams } from "@limecloud/app-server-client";

type CallParams = DynamicToolCallParams & {
  arguments: Record<string, unknown>;
};

export interface DynamicToolCallAttempt {
  readonly params: CallParams;
}

type CallState = {
  params: CallParams;
  phase: "inFlight" | "awaitingApproval" | "completed";
  approvalToken: string | null;
  approvals: number;
  attempt: DynamicToolCallAttempt;
};

const STALE_CALL = "item/tool/call phase is stale or already consumed";
const MAX_APPROVALS = 4;

export class DynamicToolCalls {
  readonly #calls = new Map<string, CallState>();
  readonly #closedTurns = new Set<string>();
  readonly #tokens = new Set<string>();

  begin(params: CallParams): DynamicToolCallAttempt {
    const key = callKey(params);
    const current = this.#calls.get(key);
    if (
      this.#closedTurns.has(turnKey(params.threadId, params.turnId)) ||
      (params.phase === "preflight" && current !== undefined) ||
      (params.phase === "approvedExecute" &&
        current?.phase !== "awaitingApproval")
    ) {
      throw new Error(STALE_CALL);
    }
    if (current) {
      if (
        params.namespace !== current.params.namespace ||
        params.tool !== current.params.tool ||
        !isDeepStrictEqual(params.arguments, current.params.arguments)
      ) {
        throw new Error("item/tool/call does not match the frozen call");
      }
      if (params.approvalToken !== current.approvalToken) {
        throw new Error(
          "item/tool/call approvalToken does not match this stage",
        );
      }
    }
    const attempt = { params: structuredClone(params) };
    if (current) {
      current.phase = "inFlight";
      current.approvalToken = null;
      current.attempt = attempt;
    } else {
      this.#calls.set(key, {
        params: structuredClone(params),
        phase: "inFlight",
        approvalToken: null,
        approvals: 0,
        attempt,
      });
    }
    return attempt;
  }

  complete(
    attempt: DynamicToolCallAttempt,
    approval?: { approvalToken: string } | null,
  ): void {
    const current = this.#active(attempt);
    if (!current) {
      throw new Error(
        "item/tool/call result is stale after turn completion or reset",
      );
    }
    current.phase = "completed";
    if (!approval) return;
    const token = approval.approvalToken;
    if (typeof token !== "string" || token.trim().length === 0) {
      throw new Error("Host returned an invalid Browser approval token");
    }
    if (this.#tokens.has(token)) {
      throw new Error("Host returned a repeated Browser approval token");
    }
    if (current.approvals >= MAX_APPROVALS) {
      throw new Error("Browser call exceeded the limit of 4 approvals");
    }
    this.#tokens.add(token);
    current.approvals += 1;
    current.approvalToken = token;
    current.phase = "awaitingApproval";
  }

  fail(attempt: DynamicToolCallAttempt): void {
    const current = this.#active(attempt);
    if (current) current.phase = "completed";
  }

  turnEnded(threadId: string, turnId: string): void {
    this.#closedTurns.add(turnKey(threadId, turnId));
    for (const [key, call] of this.#calls) {
      if (call.params.threadId === threadId && call.params.turnId === turnId) {
        this.#calls.delete(key);
      }
    }
  }

  reset(): void {
    this.#calls.clear();
    this.#closedTurns.clear();
    this.#tokens.clear();
  }

  #active(attempt: DynamicToolCallAttempt): CallState | null {
    const current = this.#calls.get(callKey(attempt.params));
    return current?.attempt === attempt && current.phase === "inFlight"
      ? current
      : null;
  }
}

function callKey(params: CallParams): string {
  return JSON.stringify([params.threadId, params.turnId, params.callId]);
}

function turnKey(threadId: string, turnId: string): string {
  return JSON.stringify([threadId, turnId]);
}
