export type ConversationProjectionSlice =
  | "session"
  | "stream"
  | "queue"
  | "render"
  | "diagnostics";

export interface ConversationStreamDiagnostic {
  id: number;
  phase: string;
  at: number;
  wallTime: number;
  sessionId?: string | null;
  workspaceId?: string | null;
  source?: string | null;
  requestId?: string | null;
  actualSessionId?: string | null;
  metrics: Record<string, string | number | boolean | null>;
}

export interface ConversationDiagnosticsSlice {
  streamDiagnostics: ConversationStreamDiagnostic[];
  latestStreamDiagnosticBySession: Record<string, ConversationStreamDiagnostic>;
}

export interface ConversationSessionProjectionSlice {
  version: number;
}

export interface ConversationStreamProjectionSlice {
  version: number;
}

export interface ConversationQueueProjectionSlice {
  version: number;
}

export interface ConversationRenderProjectionSlice {
  version: number;
}

export interface ConversationProjectionState {
  session: ConversationSessionProjectionSlice;
  stream: ConversationStreamProjectionSlice;
  queue: ConversationQueueProjectionSlice;
  render: ConversationRenderProjectionSlice;
  diagnostics: ConversationDiagnosticsSlice;
}

export type ConversationProjectionListener = () => void;

export interface ConversationProjectionStore {
  getSnapshot: () => ConversationProjectionState;
  subscribe: (listener: ConversationProjectionListener) => () => void;
  recordStreamDiagnostic: (
    diagnostic: Omit<ConversationStreamDiagnostic, "id">,
  ) => ConversationStreamDiagnostic;
  clearDiagnostics: () => void;
}

const MAX_STREAM_DIAGNOSTICS = 500;

function createInitialState(): ConversationProjectionState {
  return {
    session: { version: 0 },
    stream: { version: 0 },
    queue: { version: 0 },
    render: { version: 0 },
    diagnostics: {
      streamDiagnostics: [],
      latestStreamDiagnosticBySession: {},
    },
  };
}

function normalizeSessionKey(
  diagnostic: Pick<ConversationStreamDiagnostic, "sessionId" | "requestId">,
): string | null {
  return diagnostic.sessionId ?? diagnostic.requestId ?? null;
}

export function createConversationProjectionStore(): ConversationProjectionStore {
  let state = createInitialState();
  let nextDiagnosticId = 1;
  const listeners = new Set<ConversationProjectionListener>();

  function emit(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  return {
    getSnapshot: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    recordStreamDiagnostic(diagnostic) {
      const entry: ConversationStreamDiagnostic = {
        ...diagnostic,
        id: nextDiagnosticId,
      };
      nextDiagnosticId += 1;

      const streamDiagnostics = [...state.diagnostics.streamDiagnostics, entry];
      if (streamDiagnostics.length > MAX_STREAM_DIAGNOSTICS) {
        streamDiagnostics.splice(
          0,
          streamDiagnostics.length - MAX_STREAM_DIAGNOSTICS,
        );
      }

      const latestStreamDiagnosticBySession = {
        ...state.diagnostics.latestStreamDiagnosticBySession,
      };
      const sessionKey = normalizeSessionKey(entry);
      if (sessionKey) {
        latestStreamDiagnosticBySession[sessionKey] = entry;
      }

      state = {
        ...state,
        diagnostics: {
          streamDiagnostics,
          latestStreamDiagnosticBySession,
        },
      };
      emit();
      return entry;
    },

    clearDiagnostics() {
      if (
        state.diagnostics.streamDiagnostics.length === 0 &&
        Object.keys(state.diagnostics.latestStreamDiagnosticBySession)
          .length === 0
      ) {
        return;
      }

      state = {
        ...state,
        diagnostics: {
          streamDiagnostics: [],
          latestStreamDiagnosticBySession: {},
        },
      };
      nextDiagnosticId = 1;
      emit();
    },
  };
}

export const conversationProjectionStore = createConversationProjectionStore();

export function selectConversationStreamDiagnostics(
  state: ConversationProjectionState,
): ConversationStreamDiagnostic[] {
  return state.diagnostics.streamDiagnostics;
}

export function selectLatestConversationStreamDiagnostic(
  state: ConversationProjectionState,
  key: string | null | undefined,
): ConversationStreamDiagnostic | null {
  if (!key) {
    return null;
  }
  return state.diagnostics.latestStreamDiagnosticBySession[key] ?? null;
}

export function recordConversationStreamDiagnostic(
  diagnostic: Omit<ConversationStreamDiagnostic, "id">,
): ConversationStreamDiagnostic {
  return conversationProjectionStore.recordStreamDiagnostic(diagnostic);
}

export function clearConversationProjectionDiagnostics(): void {
  conversationProjectionStore.clearDiagnostics();
}
