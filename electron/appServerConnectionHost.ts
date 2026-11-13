import {
  ERROR_CODES,
  isJsonRpcRequest,
  METHOD_CONNECTION_AUTHORIZE,
  type AppServerConnection,
  type ConnectionAuthorizeResponse,
  type JsonRpcMessage,
} from "@limecloud/app-server-client";

type Connection = Pick<
  AppServerConnection,
  "respondServerRequest" | "rejectServerRequest"
>;

export async function tryHandleConnectionAuthorize(
  connection: Connection,
  message: JsonRpcMessage,
  open: (url: string) => Promise<void>,
  local: boolean,
): Promise<boolean> {
  if (
    !isJsonRpcRequest(message) ||
    message.method !== METHOD_CONNECTION_AUTHORIZE
  )
    return false;
  if (!local) {
    connection.respondServerRequest<ConnectionAuthorizeResponse>(message.id, {
      action: "unavailable",
    });
    return true;
  }
  const params = message.params as Record<string, unknown> | null;
  const url = approvalUrl(params);
  if (!url) {
    connection.rejectServerRequest(message.id, {
      code: ERROR_CODES.invalidParams,
      message: "invalid connection authorization request",
    });
    return true;
  }
  let action: ConnectionAuthorizeResponse["action"] = "unavailable";
  try {
    await open(url);
    action = "opened";
  } catch {
    // The URL and platform error must not enter logs or the response.
  }
  connection.respondServerRequest<ConnectionAuthorizeResponse>(message.id, {
    action,
  });
  return true;
}

function approvalUrl(params: Record<string, unknown> | null): string | null {
  if (
    !params ||
    typeof params !== "object" ||
    Array.isArray(params) ||
    typeof params.threadId !== "string" ||
    !params.threadId.trim() ||
    typeof params.requestId !== "string" ||
    !/^[A-Za-z0-9_-]{1,40}$/.test(params.requestId) ||
    typeof params.expiresAt !== "string" ||
    !(Date.parse(params.expiresAt) > Date.now()) ||
    !["sandbox", "production"].includes(String(params.environment)) ||
    typeof params.approvalUrl !== "string" ||
    params.approvalUrl.length > 4096
  )
    return null;
  try {
    const url = new URL(params.approvalUrl);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      url.pathname === `/connections/requests/${params.requestId}` &&
      url.search === `?environment=${params.environment}`
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
