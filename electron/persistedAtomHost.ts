import { parsePersistedAtomReadRequest } from "../src/lib/api/persistedAtomProtocol";
import type {
  PersistedAtomMetadata,
  PersistedAtomReadResult,
  PersistedAtomUpdateEvent,
  PersistedAtomUpdateResult,
} from "../src/lib/api/persistedAtomTypes";
import {
  LOCAL_ENV_SELECTIONS_ATOM_KEY,
  LOCAL_ENV_RECENT_ACTIONS_ATOM_KEY,
  isPersistedBooleanAtomKey,
} from "../src/lib/api/persistedAtomTypes";
import { COMPOSER_ATOM_KEY, exactRecord } from "./persistedAtomRecords";
import { PersistedAtomStore } from "./persistedAtomStore";

type HostEventEmitter = (event: string, payload?: unknown) => void;

/** Host UI persistence only. It owns no runtime, session or send readiness. */
export class PersistedAtomHost {
  readonly #store: PersistedAtomStore;
  readonly #unsubscribe: () => void;
  readonly #emit: HostEventEmitter;
  readonly ready: Promise<void>;

  constructor(appDataRoot: string, emit: HostEventEmitter = () => undefined) {
    this.#store = new PersistedAtomStore(appDataRoot);
    this.#emit = emit;
    this.ready = this.#store.ready;
    this.#unsubscribe = this.#store.subscribe((metadata) =>
      this.#broadcastPersistedAtomUpdate(metadata),
    );
  }

  sendPersistedAtomState(args: unknown): PersistedAtomReadResult {
    try {
      const request = parsePersistedAtomReadRequest(args);
      if (request.key === LOCAL_ENV_RECENT_ACTIONS_ATOM_KEY)
        return this.#store.sendLocalEnvironmentRecentActions();
      if (request.key === LOCAL_ENV_SELECTIONS_ATOM_KEY)
        return this.#store.sendLocalEnvironmentSelections();
      if (isPersistedBooleanAtomKey(request.key))
        return this.#store.sendBooleanState(request.key);
      return this.#store.sendPersistedAtomState(request.query);
    } catch {
      return {
        ...this.#store.metadata(),
        outcome: "invalid",
        reason: "invalid_request",
        data: null,
      };
    }
  }

  updatePersistedAtomState(args: unknown): PersistedAtomUpdateResult {
    try {
      const request = exactRecord(args, ["key", "mutation"]);
      if (request.key === LOCAL_ENV_RECENT_ACTIONS_ATOM_KEY)
        return this.#store.recordLocalEnvironmentAction(request.mutation);
      if (request.key === LOCAL_ENV_SELECTIONS_ATOM_KEY)
        return this.#store.updateLocalEnvironmentSelection(request.mutation);
      if (isPersistedBooleanAtomKey(request.key))
        return this.#store.updateBooleanState(request.key, request.mutation);
      if (request.key !== COMPOSER_ATOM_KEY)
        throw new Error("invalid atom key");
      return this.#store.updatePersistedAtomState(request.mutation);
    } catch {
      return {
        ...this.#store.metadata(),
        outcome: "invalid",
        reason: "invalid_request",
        changed: false,
        entry: null,
      };
    }
  }

  dispose(): void {
    this.#unsubscribe();
    this.#store.dispose();
  }

  #broadcastPersistedAtomUpdate(metadata: PersistedAtomMetadata): void {
    const event: PersistedAtomUpdateEvent = {
      ...metadata,
      event: "persisted-atom-update",
    };
    this.#emit(event.event, event);
  }
}
