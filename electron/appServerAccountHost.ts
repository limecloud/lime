import {
  ERROR_CODES,
  isJsonRpcRequest,
  METHOD_ACCOUNT_AUTHORIZE,
  type AccountAuthorizeResponse,
  type AppServerConnection,
  type JsonRpcMessage,
} from "@limecloud/app-server-client";

type AccountConnection = Pick<
  AppServerConnection,
  "respondServerRequest" | "rejectServerRequest"
>;

export async function tryHandleAccountAuthorize(
  connection: AccountConnection,
  message: JsonRpcMessage,
  open: (url: string) => Promise<void>,
  local: boolean,
): Promise<boolean> {
  if (
    !isJsonRpcRequest(message) ||
    message.method !== METHOD_ACCOUNT_AUTHORIZE
  ) {
    return false;
  }
  // A remote callback belongs to the remote machine, not this desktop browser.
  if (!local) {
    connection.respondServerRequest<AccountAuthorizeResponse>(message.id, {
      action: "unavailable",
    });
    return true;
  }
  const params = record(message.params);
  const authorization = record(params?.authorization);
  const url = authorizationUrl(params?.authUrl);
  if (
    typeof params?.threadId !== "string" ||
    !params.threadId.trim() ||
    typeof authorization?.id !== "string" ||
    !authorization.id.trim() ||
    authorization.status !== "pending" ||
    typeof authorization.expiresAt !== "string" ||
    !(Date.parse(authorization.expiresAt) > Date.now()) ||
    !["default", "market", "web", "connections"].includes(
      String(authorization.resource),
    ) ||
    !url ||
    (url.searchParams.get("resource") ?? "default") !== authorization.resource
  ) {
    connection.rejectServerRequest(message.id, {
      code: ERROR_CODES.invalidParams,
      message: "invalid account authorization request",
    });
    return true;
  }
  let action: AccountAuthorizeResponse["action"] = "unavailable";
  try {
    await open(url.toString());
    action = "opened";
  } catch {
    // Browser errors must not expose the authorization URL in logs or responses.
  }
  connection.respondServerRequest<AccountAuthorizeResponse>(message.id, {
    action,
  });
  return true;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function authorizationUrl(value: unknown): URL | null {
  if (typeof value !== "string" || value.length > 16_384) return null;
  try {
    const url = new URL(value);
    const loopback =
      url.hostname === "localhost" ||
      url.hostname === "[::1]" ||
      /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(url.hostname);
    if (
      !(url.protocol === "https:" || (url.protocol === "http:" && loopback)) ||
      url.username ||
      url.password ||
      url.hash ||
      url.pathname !== "/api/v1/client/auth/authorize" ||
      ["state", "nonce", "code_challenge", "redirect_uri"].some(
        (key) =>
          url.searchParams.getAll(key).length !== 1 ||
          !url.searchParams.get(key),
      ) ||
      url.searchParams.getAll("resource").length > 1
    )
      return null;
    return url;
  } catch {
    return null;
  }
}
