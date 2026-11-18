import { ComposerController } from "@/components/input-kit/ComposerController";
import { clone } from "@/components/input-kit/composerState";
import {
  decodeComposerDraft,
  encodeComposerDraft,
} from "@/components/input-kit/composerDraftCodec";
import {
  listenPersistedAtomUpdates,
  sendPersistedAtomState,
  updatePersistedAtomState,
} from "@/lib/api/persistedAtoms";
import { parsePersistedDraftScope } from "@/lib/api/persistedAtomProtocol";
import {
  isRuntimeSubmissionAccepted,
  normalizeRuntimeSubmissionResult,
} from "@/components/agent/chat/hooks/agentSendResult";
import type {
  DraftIdentity,
  DraftScope,
  JsonObject,
  PersistedAtomMetadata,
  PersistedAtomMutation,
  PersistedAtomPersistence,
  PersistedAtomUpdateResult,
  PersistedDraftEntry,
} from "@/lib/api/persistedAtomTypes";
import type {
  ComposerDocument,
  ComposerSubmitResult,
  ComposerSubmitTarget,
} from "@/components/input-kit/types";

const key = "composer-drafts-v1";
const defaultGateway = {
  read: sendPersistedAtomState,
  update: updatePersistedAtomState,
  listen: listenPersistedAtomUpdates,
};

export interface ComposerDraftBindingToken {
  readonly scope: DraftScope;
  readonly identity: DraftIdentity;
  readonly generation: number;
  readonly payload: JsonObject;
}

export interface ComposerDraftCapture {
  readonly receipt: ComposerSubmitResult;
  readonly binding: ComposerDraftBindingToken | null;
}

export interface ComposerDraftStatus {
  readonly scope: DraftScope | null;
  readonly generation: number;
  readonly ready: boolean;
  readonly identity: DraftIdentity | null;
  readonly remoteIdentity: DraftIdentity | null;
  readonly mutation:
    | "idle"
    | "pending"
    | "applied"
    | "conflict"
    | "invalid"
    | "unavailable";
  readonly storeRevision: number | null;
  readonly persistence: PersistedAtomPersistence | null;
  readonly error: "codec" | "mode_mismatch" | "transport" | null;
}

type DraftLane = {
  draftId: string;
  version: string;
  queuedVersion: string | null;
  queuedSignature: string | null;
  payload: JsonObject;
  signature: string;
  scope: DraftScope;
  retiring: boolean;
};
type Binding = {
  scope: DraftScope;
  generation: number;
  read: number;
  ready: boolean;
  edited: boolean;
  blocked: boolean;
  codecValid: boolean;
  observedSignature: string | null;
  lane: DraftLane | null;
  clearing: DraftLane | null;
  remote: PersistedDraftEntry | null;
};
type TokenContext = { binding: Binding; lane: DraftLane };
type CaptureContext = {
  binding: Binding | null;
  settled: Promise<boolean> | null;
};

function freeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value && typeof value === "object" && !seen.has(value)) {
    seen.add(value);
    for (const nested of Object.values(value)) freeze(nested, seen);
    Object.freeze(value);
  }
  return value;
}
function detached<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
function sameScope(a: DraftScope, b: DraftScope): boolean {
  return a.workspaceId === b.workspaceId && a.kind === b.kind && a.id === b.id;
}
function identity(lane: DraftLane): DraftIdentity {
  return { draftId: lane.draftId, scopeVersion: lane.version };
}
function hasContent(document: ComposerDocument): boolean {
  return (
    document.text !== "" ||
    document.attachments.length > 0 ||
    document.pathReferences.length > 0 ||
    document.inputCapabilityRoute !== undefined ||
    document.editorDocument.content.some((block) => block.type !== "paragraph")
  );
}

/** Controller owns the editable document; this owner only coordinates projections. */
export class ComposerDraftCoordinator {
  readonly #controller: ComposerController;
  readonly #plainTextMode: boolean;
  readonly #gateway: typeof defaultGateway;
  readonly #unsubscribe: () => void;
  readonly #listeners = new Set<() => void>();
  readonly #tokens = new WeakMap<ComposerDraftBindingToken, TokenContext>();
  readonly #captures = new WeakMap<ComposerDraftCapture, CaptureContext>();
  #binding: Binding | null = null;
  #generation = 0;
  #suppressed = 0;
  #attached = true;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #queue: Promise<void> = Promise.resolve();
  #unlisten: (() => void) | null = null;
  #connection: Promise<void> | null = null;
  #status: ComposerDraftStatus = freeze({
    scope: null,
    generation: 0,
    ready: false,
    identity: null,
    remoteIdentity: null,
    mutation: "idle",
    storeRevision: null,
    persistence: null,
    error: null,
  });

  constructor(
    controller: ComposerController,
    options: {
      plainTextMode: boolean;
      gateway?: typeof defaultGateway;
    },
  ) {
    if (typeof options.plainTextMode !== "boolean")
      throw new Error("Composer mode must be explicitly provided");
    this.#controller = controller;
    this.#plainTextMode = options.plainTextMode;
    this.#gateway = options.gateway ?? defaultGateway;
    this.#unsubscribe = controller.subscribe(() => this.#observe());
  }

  getSnapshot = (): ComposerDraftStatus => this.#status;
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  connect(): Promise<void> {
    if (this.#connection) return this.#connection;
    this.#connection = this.#gateway
      .listen((metadata) => {
        if (
          !this.#attached ||
          metadata.key !== "composer-drafts-v1" ||
          metadata.storeRevision < (this.#status.storeRevision ?? 0)
        )
          return;
        // Metadata is only an invalidation signal, never a saved/body receipt.
        void this.refresh();
      })
      .then((unlisten) => {
        if (this.#attached) this.#unlisten = unlisten;
        else unlisten();
      })
      .catch(() =>
        this.#publish({ mutation: "unavailable", error: "transport" }),
      );
    return this.#connection;
  }

  /** Call before navigation; blocked/deferred navigation must not call bindCommitted. */
  prepareNavigation(): void {
    this.#observe();
    this.#flush();
  }

  /** The caller must have committed the actual editing target, not a preview target. */
  bindCommitted(scope: DraftScope): Promise<boolean> {
    if (!this.#attached) return Promise.resolve(false);
    const parsed = freeze(parsePersistedDraftScope(scope));
    if (this.#binding && sameScope(this.#binding.scope, parsed))
      return this.refresh();
    const initialContent =
      !this.#binding && hasContent(this.#controller.captureDraft());
    let signature: string | null = null;
    try {
      signature = JSON.stringify(
        encodeComposerDraft(
          this.#controller.captureDraft(),
          this.#plainTextMode,
        ),
      );
    } catch {
      /* A bad local document cannot be projected as an empty draft. */
    }
    this.prepareNavigation();
    this.#binding = {
      scope: parsed,
      generation: ++this.#generation,
      read: 0,
      ready: false,
      edited: initialContent,
      blocked: false,
      codecValid: signature !== null,
      observedSignature: signature,
      lane: null,
      clearing: null,
      remote: null,
    };
    this.#publish({ mutation: "idle", error: null });
    return this.refresh();
  }

  async refresh(): Promise<boolean> {
    const binding = this.#binding;
    if (!binding || !this.#attached) return false;
    const read = ++binding.read;
    const scope = binding.scope;
    const revision = this.#controller.getSnapshot().revision;
    try {
      const result = await this.#gateway
        .read({ key, query: { kind: "scope", scope } })
        .catch(() => null);
      if (
        this.#binding !== binding ||
        binding.read !== read ||
        !sameScope(binding.scope, scope) ||
        !this.#attached
      )
        return false;
      if (result && result.storeRevision < (this.#status.storeRevision ?? 0))
        return this.refresh();
      if (!result) {
        this.#publish({ mutation: "unavailable", error: "transport" });
        return false;
      }
      this.#metadata(result);
      if (result.outcome !== "ready" || result.data.queryKind !== "scope") {
        this.#publish({
          mutation: result.outcome === "invalid" ? "invalid" : "unavailable",
        });
        return false;
      }
      const entry = result.data.view.entry;
      // A preceding put can notify while its queued discard still owns the scope.
      if (binding.clearing) return false;
      binding.remote = entry;
      const edited =
        binding.edited || revision !== this.#controller.getSnapshot().revision;
      const local = binding.lane;
      if (local) {
        // An in-flight or locally changed version is never rebased from a read.
        if (
          edited ||
          local.version !== local.queuedVersion ||
          entry?.draftId !== local.draftId ||
          entry.scopeVersion !== local.version
        ) {
          if (entry && entry.scopeVersion !== local.queuedVersion)
            this.#publish({ mutation: "conflict" });
          else this.#publish({});
          return false;
        }
        this.#publish({});
        return true;
      }
      if (entry && edited) {
        binding.blocked = true;
        this.#publish({ mutation: "conflict" });
        return false;
      }
      if (entry?.state === "draft") {
        const decoded = decodeComposerDraft(entry.draft);
        if (decoded.plainTextMode !== this.#plainTextMode) {
          this.#publish({ mutation: "invalid", error: "mode_mismatch" });
          return false;
        }
        const payload = encodeComposerDraft(
          decoded.document,
          this.#plainTextMode,
        );
        const signature = JSON.stringify(payload);
        this.#project(() => this.#controller.restoreDraft(decoded.document));
        binding.lane = {
          draftId: entry.draftId,
          version: entry.scopeVersion,
          queuedVersion: entry.scopeVersion,
          queuedSignature: signature,
          payload,
          signature,
          scope: binding.scope,
          retiring: false,
        };
        binding.observedSignature = signature;
        binding.codecValid = true;
      } else if (!edited) {
        this.#project(() => this.#controller.replaceDocument({}));
        binding.observedSignature = JSON.stringify(
          encodeComposerDraft(
            this.#controller.captureDraft(),
            this.#plainTextMode,
          ),
        );
      }
      binding.ready = true;
      binding.edited = false;
      this.#publish({ mutation: "idle", error: null });
      if (edited) {
        binding.observedSignature = null;
        this.#observe();
      }
      return true;
    } catch {
      if (this.#binding === binding && binding.read === read && this.#attached)
        this.#publish({ mutation: "invalid", error: "codec" });
      return false;
    }
  }

  captureBinding(): ComposerDraftBindingToken | null {
    this.#observe();
    this.#flush();
    const binding = this.#binding;
    if (
      !binding?.ready ||
      !binding.codecValid ||
      binding.blocked ||
      !binding.lane
    )
      return null;
    const lane = binding.lane;
    const token = freeze({
      scope: detached(lane.scope),
      identity: identity(lane),
      generation: binding.generation,
      payload: detached(lane.payload),
    });
    this.#tokens.set(token, { binding, lane });
    return token;
  }

  captureSubmission(
    target: ComposerSubmitTarget,
    options: { allowEmpty?: boolean } = {},
  ): ComposerDraftCapture {
    const receipt = this.#controller.submit(target, options);
    const capture = freeze({
      receipt: clone(receipt),
      binding:
        receipt.kind === "accepted" && target !== "interrupt"
          ? this.captureBinding()
          : null,
    });
    this.#captures.set(capture, { binding: this.#binding, settled: null });
    return capture;
  }

  /** Runtime acceptance is already settled; this promise only represents local cleanup. */
  settleSubmission(
    capture: ComposerDraftCapture,
    result: unknown,
    beforeConsume?: Promise<unknown>,
  ): Promise<boolean> {
    const context = this.#captures.get(capture);
    if (!context || capture.receipt.kind !== "accepted")
      return Promise.resolve(false);
    if (context.settled) return context.settled;
    try {
      if (
        !isRuntimeSubmissionAccepted(normalizeRuntimeSubmissionResult(result))
      )
        return Promise.resolve(false);
    } catch {
      return Promise.resolve(false);
    }
    const token = capture.binding;
    const tracked = token && this.#tokens.get(token);
    if (capture.receipt.target === "interrupt") return Promise.resolve(false);
    if (!token || !tracked) {
      if (context.binding && !context.binding.codecValid)
        return Promise.resolve(false);
      let committed = false;
      context.settled = Promise.resolve().then(() => committed);
      committed = Boolean(
        this.#attached &&
        this.#binding === context.binding &&
        this.#project(() =>
          this.#controller.commit(
            capture.receipt as Extract<
              ComposerSubmitResult,
              { kind: "accepted" }
            >,
          ),
        ),
      );
      if (committed && context.binding) {
        this.#retire(context.binding);
        // Without a stored identity there is nothing safe to consume. Preserve
        // the accepted local state when a delayed read returns an older draft.
        context.binding.edited = true;
      }
      return context.settled;
    }
    // Newer edits queued before acceptance keep their exact CAS predecessor.
    this.#observe();
    this.#flush();
    if (tracked.lane.version === token.identity.scopeVersion)
      tracked.lane.retiring = true;
    const persistence = this.#enqueue(
      tracked.lane,
      {
        op: "consume",
        identity: token.identity,
      },
      beforeConsume ? () => beforeConsume.then(() => true) : undefined,
    );
    let committed = false;
    context.settled = persistence.then((response) => {
      if (context.binding?.clearing === tracked.lane) {
        context.binding.clearing = null;
        context.binding.read += 1;
      }
      if (
        this.#attached &&
        this.#binding === context.binding &&
        !context.binding?.lane &&
        response?.outcome !== "applied"
      ) {
        if (context.binding) context.binding.edited = true;
        this.#publish({ mutation: response?.outcome ?? "unavailable" });
      }
      return committed;
    });
    // Runtime acceptance owns the visible draft. Disk/CAS completion must not
    // keep already submitted text in the editor; newer local edits still win.
    committed = Boolean(
      this.#attached &&
      this.#binding === context.binding &&
      context.binding?.lane === tracked.lane &&
      tracked.lane.version === token.identity.scopeVersion &&
      this.#project(() =>
        this.#controller.commit(
          capture.receipt as Extract<
            ComposerSubmitResult,
            { kind: "accepted" }
          >,
        ),
      ),
    );
    if (committed && context.binding) {
      context.binding.clearing = tracked.lane;
      this.#retire(context.binding);
      // commit notifies synchronously. A subscriber may edit the freshly cleared
      // document while projection observation is suppressed; publish that edit
      // as a new logical draft after retiring the accepted identity.
      if (
        this.#controller.getSnapshot().revision !==
        capture.receipt.revision + 1
      ) {
        context.binding.observedSignature = null;
        this.#observe();
      }
    }
    return context.settled;
  }

  /** Promotion preserves the logical draft, Controller revision and pending receipt. */
  promote(
    token: ComposerDraftBindingToken,
    target: DraftScope,
    options: {
      expectedTarget: DraftIdentity | null;
      sessionId?: string;
      threadId?: string;
    },
  ): Promise<boolean> {
    const tracked = this.#tokens.get(token);
    if (!tracked) return Promise.resolve(false);
    const parsed = freeze(parsePersistedDraftScope(target));
    const mutation: PersistedAtomMutation = {
      op: "promote",
      source: token.scope,
      target: parsed,
      identity: token.identity,
      ...options,
    };
    return this.#enqueue(tracked.lane, mutation).then((result) => {
      if (result?.outcome !== "applied") return false;
      return true;
    });
  }

  /** Fresh navigation preserves the document until the committed identity CAS applies. */
  async replaceCommittedDraft(
    scope: DraftScope,
    isCurrent: () => boolean,
  ): Promise<"applied" | "stale" | "conflict" | "unavailable"> {
    const binding = this.#binding;
    if (
      !binding ||
      !binding.ready ||
      binding.blocked ||
      !this.#attached ||
      !sameScope(binding.scope, scope) ||
      !isCurrent()
    )
      return "stale";
    this.#observe();
    this.#flush();
    const lane = binding.lane;
    const revision = this.#controller.getSnapshot().revision;
    const captured = lane && identity(lane);
    const ownsDocument = () =>
      this.#attached &&
      this.#binding === binding &&
      sameScope(binding.scope, scope) &&
      isCurrent();
    const unchanged = () =>
      ownsDocument() &&
      this.#controller.getSnapshot().revision === revision &&
      binding.lane === lane &&
      (!lane || lane.version === captured?.scopeVersion);
    if (lane && captured) {
      let skipped = false;
      const result = await this.#enqueue(
        lane,
        { op: "clear", identity: captured },
        () => {
          if (unchanged()) return true;
          skipped = true;
          return false;
        },
      );
      if (skipped) return "stale";
      if (!result || result.outcome === "unavailable") return "unavailable";
      if (result.outcome !== "applied") return "conflict";
      lane.retiring = true;
      if (!unchanged()) {
        // A late applied clear retires only its old identity; newer edits stay durable.
        if (this.#binding === binding && binding.lane === lane) {
          this.#retire(binding);
          binding.generation = ++this.#generation;
          binding.observedSignature = null;
          this.#observe();
        }
        return "stale";
      }
    }
    if (!unchanged()) return "stale";
    binding.generation = ++this.#generation;
    this.#project(() => this.#controller.clear());
    this.#retire(binding);
    if (this.#controller.getSnapshot().revision > revision + 1) {
      binding.observedSignature = null;
      this.#observe();
    }
    return "applied";
  }

  clear(): Promise<boolean> {
    const binding = this.#binding;
    this.#flush();
    const lane = binding?.lane;
    const captured = lane && identity(lane);
    if (binding && lane) binding.clearing = lane;
    this.#project(() => this.#controller.clear());
    if (binding) {
      binding.read += 1;
      this.#retire(binding);
      if (!binding.ready) {
        binding.edited = true;
        this.#publish({ mutation: "unavailable" });
      }
    }
    if (!lane || !captured) return Promise.resolve(false);
    return this.#enqueue(lane, { op: "clear", identity: captured }).then(
      (result) => {
        if (binding?.clearing === lane) {
          binding.clearing = null;
          binding.read += 1;
        }
        if (this.#binding === binding && !binding?.lane && result)
          this.#publish({ mutation: result.outcome });
        return result?.outcome === "applied";
      },
    );
  }

  /** Awaiting is for evidence/tests; business submission never waits for this queue. */
  async idle(): Promise<void> {
    this.#flush();
    await this.#queue;
  }

  detach(): void {
    this.prepareNavigation();
    this.#attached = false;
    this.#unsubscribe();
    this.#unlisten?.();
    this.#unlisten = null;
    this.#listeners.clear();
  }

  #observe(): void {
    const binding = this.#binding;
    if (this.#suppressed || !binding || !this.#attached) return;
    try {
      const document = this.#controller.captureDraft();
      const payload = encodeComposerDraft(document, this.#plainTextMode);
      const signature = JSON.stringify(payload);
      const wasValid = binding.codecValid;
      binding.codecValid = true;
      if (signature === binding.observedSignature) {
        if (!wasValid) this.#publish({ error: null });
        return;
      }
      binding.observedSignature = signature;
      if (
        this.#controller.getSnapshot().lastIntent === "clear" &&
        document.text === "" &&
        document.attachments.length === 0 &&
        document.pathReferences.length === 0 &&
        document.inputCapabilityRoute === undefined
      ) {
        void this.clear();
        return;
      }
      binding.edited = true;
      if (!binding.ready || binding.blocked) return;
      const lane = binding.lane;
      if (lane && !lane.retiring) {
        lane.version = crypto.randomUUID();
        lane.payload = payload;
        lane.signature = signature;
      } else {
        binding.lane = {
          draftId: crypto.randomUUID(),
          version: crypto.randomUUID(),
          queuedVersion: null,
          queuedSignature: null,
          payload,
          signature,
          scope: binding.scope,
          retiring: false,
        };
      }
      this.#publish({ mutation: "pending", error: null });
      if (this.#timer) clearTimeout(this.#timer);
      this.#timer = setTimeout(() => this.#flush(), 250);
    } catch {
      binding.edited = true;
      binding.codecValid = false;
      this.#publish({ mutation: "invalid", error: "codec" });
    }
  }

  #flush(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    const binding = this.#binding;
    const lane = binding?.lane;
    if (!lane || binding?.blocked || lane.signature === lane.queuedSignature)
      return;
    const mutation: PersistedAtomMutation = {
      op: "put",
      scope: detached(lane.scope),
      draftId: lane.draftId,
      expectedVersion: lane.queuedVersion,
      nextVersion: lane.version,
      draft: detached(lane.payload),
    };
    lane.queuedVersion = lane.version;
    lane.queuedSignature = lane.signature;
    void this.#enqueue(lane, mutation);
  }

  #enqueue(
    lane: DraftLane,
    mutation: PersistedAtomMutation,
    mayApply?: () => boolean | Promise<boolean>,
  ): Promise<PersistedAtomUpdateResult | null> {
    mutation = freeze(detached(mutation));
    const operation = this.#queue.then(async () => {
      if (mayApply && !(await mayApply())) return null;
      try {
        const result = await this.#gateway.update({
          key,
          mutation:
            mutation.op === "put"
              ? { ...mutation, scope: detached(lane.scope) }
              : mutation,
        });
        if (result.outcome === "applied" && mutation.op === "promote") {
          lane.scope = freeze(detached(mutation.target));
          if (
            this.#binding?.lane === lane ||
            this.#binding?.clearing === lane
          ) {
            const local = this.#binding.lane;
            if (local && sameScope(local.scope, mutation.source))
              local.scope = lane.scope;
            this.#binding.scope = lane.scope;
            this.#binding.read += 1;
          }
        }
        this.#metadata(result);
        if (this.#binding?.lane === lane) {
          this.#binding.remote = result.entry;
          const current = identity(lane);
          const matches =
            result.entry?.draftId === current.draftId &&
            result.entry.scopeVersion === current.scopeVersion;
          if (result.outcome === "applied" && matches)
            this.#binding.edited = false;
          this.#publish({
            mutation:
              result.outcome === "applied" && !matches
                ? "pending"
                : result.outcome,
          });
        }
        return result;
      } catch {
        if (this.#binding?.lane === lane)
          this.#publish({ mutation: "unavailable", error: "transport" });
        return null;
      }
    });
    this.#queue = operation.then(() => undefined);
    return operation;
  }

  #retire(binding: Binding): void {
    // A read started before consumption must not recreate the retired draft.
    binding.read += 1;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    binding.lane = null;
    binding.edited = false;
    binding.codecValid = true;
    binding.observedSignature = JSON.stringify(
      encodeComposerDraft(this.#controller.captureDraft(), this.#plainTextMode),
    );
    this.#publish({ mutation: "idle", error: null });
  }

  #project<T>(operation: () => T): T {
    this.#suppressed += 1;
    try {
      return operation();
    } finally {
      this.#suppressed -= 1;
    }
  }

  #metadata(metadata: PersistedAtomMetadata): void {
    if (metadata.storeRevision < (this.#status.storeRevision ?? 0)) return;
    this.#publish({
      storeRevision: metadata.storeRevision,
      persistence: detached(metadata.persistence),
    });
  }

  #publish(update: Partial<ComposerDraftStatus>): void {
    const binding = this.#binding;
    this.#status = freeze({
      ...this.#status,
      ...update,
      scope: binding?.scope ?? null,
      generation: binding?.generation ?? this.#generation,
      ready: binding?.ready ?? false,
      identity: binding?.lane ? identity(binding.lane) : null,
      remoteIdentity:
        binding?.remote?.state === "draft"
          ? {
              draftId: binding.remote.draftId,
              scopeVersion: binding.remote.scopeVersion,
            }
          : null,
    });
    if (!this.#attached) return;
    for (const listener of this.#listeners) {
      try {
        listener();
      } catch {
        /* Subscribers do not own persistence progress. */
      }
    }
  }
}
