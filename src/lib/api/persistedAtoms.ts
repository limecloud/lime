import type { UnlistenFn } from "@/lib/desktop-host/event";
import { safeInvoke, safeListen } from "@/lib/dev-bridge";
import {
  parsePersistedAtomReadRequest,
  parsePersistedAtomReadResult,
  parsePersistedAtomUpdateEvent,
  parsePersistedAtomUpdateResult,
} from "@/lib/api/persistedAtomProtocol";
import type {
  PersistedAtomReadRequest,
  PersistedAtomReadResult,
  PersistedAtomUpdateEvent,
  PersistedAtomUpdateRequest,
  PersistedAtomUpdateResult,
} from "@/lib/api/persistedAtomTypes";
import { LOCAL_ENV_SELECTIONS_ATOM_KEY } from "@/lib/api/persistedAtomTypes";
import { parseLocalEnvironmentSelectionMutation } from "@/lib/api/localEnvironmentSelectionProtocol";

export const PERSISTED_ATOM_UPDATE_EVENT = "persisted-atom-update";

export class PersistedAtomBridgeError extends Error {
  constructor(
    readonly code: "unavailable" | "invalid_request" | "invalid_response",
  ) {
    super(
      {
        unavailable: "Desktop persisted atom bridge unavailable",
        invalid_request: "Desktop persisted atom request invalid",
        invalid_response: "Desktop persisted atom response invalid",
      }[code],
    );
    this.name = "PersistedAtomBridgeError";
  }
}

export async function sendPersistedAtomState(
  request: PersistedAtomReadRequest,
): Promise<PersistedAtomReadResult> {
  const parsedRequest = parseResponse(
    () => parsePersistedAtomReadRequest(request),
    "invalid_request",
  );
  const response = await invokePersistedAtom("persisted_atom_read", {
    key: parsedRequest.key,
    query: parsedRequest.query,
  });
  return parseResponse(() =>
    parsePersistedAtomReadResult(response, parsedRequest),
  );
}

export async function updatePersistedAtomState(
  request: PersistedAtomUpdateRequest,
): Promise<PersistedAtomUpdateResult> {
  if (request.key === LOCAL_ENV_SELECTIONS_ATOM_KEY)
    parseResponse(
      () => parseLocalEnvironmentSelectionMutation(request.mutation),
      "invalid_request",
    );
  const response = await invokePersistedAtom("persisted_atom_update", {
    key: request.key,
    mutation: request.mutation,
  });
  return parseResponse(() => parsePersistedAtomUpdateResult(response, request));
}

export async function listenPersistedAtomUpdates(
  handler: (event: PersistedAtomUpdateEvent) => void,
): Promise<UnlistenFn> {
  try {
    return await safeListen<unknown>(
      PERSISTED_ATOM_UPDATE_EVENT,
      ({ payload }) => {
        let event: PersistedAtomUpdateEvent | null;
        try {
          event = parsePersistedAtomUpdateEvent(payload);
        } catch {
          return;
        }
        // Invalid events cannot update a projection or report a saved receipt.
        if (event !== null) handler(event);
      },
    );
  } catch {
    throw new PersistedAtomBridgeError("unavailable");
  }
}

async function invokePersistedAtom(
  command: "persisted_atom_read" | "persisted_atom_update",
  args: Record<string, unknown>,
): Promise<unknown> {
  try {
    return await safeInvoke<unknown>(command, args);
  } catch {
    // Bridge errors may echo arguments. Do not expose their text or cause.
    throw new PersistedAtomBridgeError("unavailable");
  }
}

function parseResponse<T>(
  parse: () => T | null,
  code: "invalid_request" | "invalid_response" = "invalid_response",
): T {
  try {
    const response = parse();
    if (response !== null) return response;
  } catch {
    // The shared protocol owner is the only response validator.
  }
  throw new PersistedAtomBridgeError(code);
}
