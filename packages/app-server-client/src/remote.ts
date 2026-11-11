/// <reference path="./ws.d.ts" />

import { isIP } from "node:net";

import WebSocket from "ws";

import * as protocol from "./protocol.js";
import {
  AppServerConnection,
  type AppServerMessageTransport,
} from "./connection.js";
import { AppServerClient } from "./request-client.js";

export const DEFAULT_REMOTE_CONNECT_TIMEOUT_MS = 10_000;
export const DEFAULT_REMOTE_MESSAGE_TIMEOUT_MS = 30_000;
export const MAX_REMOTE_WEBSOCKET_MESSAGE_BYTES = 128 * 1024 * 1024;

export type RemoteTransportConfig = {
  websocketUrl: string;
  authToken?: string;
  tenantId?: string;
  expectedServerName?: string;
  maxMessageBytes?: number;
  connectTimeoutMs?: number;
};

export type ConnectRemoteAppServerOptions = {
  client?: AppServerClient;
  initializeTimeoutMs?: number;
  expectedProtocolVersion?: string;
};

export type ConnectedRemoteAppServer = {
  client: AppServerClient;
  connection: AppServerConnection;
  transport: RemoteTransport;
  initializeResponse: protocol.InitializeResponse;
};

type PendingMessageRead = {
  resolve: (message: protocol.JsonRpcMessage) => void;
  reject: (error: unknown) => void;
  timer?: ReturnType<typeof setTimeout>;
};

/**
 * Authenticated WebSocket transport for the same JSON-RPC session used by
 * local stdio. It deliberately contains no runtime or business routing.
 */
export class RemoteTransport implements AppServerMessageTransport {
  readonly websocketUrl: string;
  readonly maxMessageBytes: number;

  readonly #socket: WebSocket;

  #messages: protocol.JsonRpcMessage[] = [];
  #waiters: PendingMessageRead[] = [];
  #closed = false;
  #closedError: Error | null = null;

  get closed(): boolean {
    return this.#closed;
  }

  private constructor(
    socket: WebSocket,
    websocketUrl: string,
    maxMessageBytes: number,
  ) {
    this.#socket = socket;
    this.websocketUrl = websocketUrl;
    this.maxMessageBytes = maxMessageBytes;

    socket.on("message", (data, isBinary) =>
      this.#receiveMessage(data, isBinary),
    );
    socket.on("error", (error) => this.#markClosed(error));
    socket.on("close", (code, reason) => {
      const detail = reason.toString("utf8");
      this.#markClosed(
        new Error(
          detail.length > 0
            ? `remote App Server WebSocket closed (${code}): ${detail}`
            : `remote App Server WebSocket closed (${code})`,
        ),
      );
    });
  }

  static async connect(
    config: RemoteTransportConfig,
  ): Promise<RemoteTransport> {
    const validated = validateRemoteTransportConfig(config);
    const socket = await openWebSocket(
      validated.url,
      {
        headers: validated.headers,
        maxPayload: validated.maxMessageBytes,
        perMessageDeflate: false,
      },
      validated.connectTimeoutMs,
    );
    return new RemoteTransport(
      socket,
      validated.url.toString(),
      validated.maxMessageBytes,
    );
  }

  send(message: protocol.JsonRpcMessage): void {
    if (this.#closed || this.#socket.readyState !== WebSocket.OPEN) {
      throw (
        this.#closedError ?? new Error("remote App Server WebSocket is closed")
      );
    }

    const encoded = protocol.encodeMessage(message);
    if (byteLength(encoded) > this.maxMessageBytes) {
      throw new Error(
        `remote App Server message exceeds ${this.maxMessageBytes} bytes`,
      );
    }

    try {
      this.#socket.send(encoded, (error) => {
        if (error) {
          this.#markClosed(error);
        }
      });
    } catch (error) {
      this.#markClosed(
        toError(error, "remote App Server WebSocket send failed"),
      );
      throw this.#closedError;
    }
  }

  nextMessage(
    timeoutMs = DEFAULT_REMOTE_MESSAGE_TIMEOUT_MS,
  ): Promise<protocol.JsonRpcMessage> {
    const message = this.#messages.shift();
    if (message) {
      return Promise.resolve(message);
    }
    if (this.#closed) {
      return Promise.reject(
        this.#closedError ?? new Error("remote App Server WebSocket is closed"),
      );
    }
    if (timeoutMs <= 0) {
      return Promise.reject(
        new Error(
          `timed out waiting for app-server message after ${timeoutMs}ms`,
        ),
      );
    }

    return new Promise<protocol.JsonRpcMessage>((resolve, reject) => {
      const pending: PendingMessageRead = { resolve, reject };
      pending.timer = setTimeout(() => {
        this.#waiters = this.#waiters.filter((waiter) => waiter !== pending);
        reject(
          new Error(
            `timed out waiting for app-server message after ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);
      this.#waiters.push(pending);
    });
  }

  async close(timeoutMs = 5_000): Promise<void> {
    if (this.#socket.readyState === WebSocket.CLOSED) {
      this.#markClosed(
        this.#closedError ?? new Error("remote App Server WebSocket is closed"),
      );
      return;
    }

    await new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        if (timer) {
          clearTimeout(timer);
        }
        this.#socket.removeListener("close", finish);
        resolve();
      };
      this.#socket.once("close", finish);
      timer = setTimeout(
        () => {
          this.#socket.terminate();
          finish();
        },
        Math.max(0, timeoutMs),
      );

      if (this.#socket.readyState === WebSocket.CONNECTING) {
        this.#socket.terminate();
      } else {
        this.#socket.close();
      }
    });
  }

  #receiveMessage(
    data: string | ArrayBuffer | Buffer | Buffer[],
    isBinary: boolean,
  ): void {
    if (this.#closed) {
      return;
    }
    if (isBinary) {
      this.#markClosed(
        new Error("remote App Server sent a non-text WebSocket frame"),
      );
      this.#socket.terminate();
      return;
    }

    const text = websocketText(data);
    if (byteLength(text) > this.maxMessageBytes) {
      this.#markClosed(
        new Error(
          `remote App Server message exceeds ${this.maxMessageBytes} bytes`,
        ),
      );
      this.#socket.terminate();
      return;
    }

    let message: protocol.JsonRpcMessage;
    try {
      message = protocol.decodeMessage(text);
    } catch (error) {
      this.#markClosed(
        toError(error, "invalid remote App Server JSON-RPC message"),
      );
      this.#socket.terminate();
      return;
    }

    const waiter = this.#waiters.shift();
    if (waiter) {
      if (waiter.timer) {
        clearTimeout(waiter.timer);
      }
      waiter.resolve(message);
      return;
    }
    this.#messages.push(message);
  }

  #markClosed(error: Error): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.#closedError = error;
    for (const waiter of this.#waiters.splice(0)) {
      if (waiter.timer) {
        clearTimeout(waiter.timer);
      }
      waiter.reject(error);
    }
  }
}

export async function connectRemoteAppServer(
  config: RemoteTransportConfig,
  initializeParams: protocol.InitializeParams,
  options: ConnectRemoteAppServerOptions = {},
): Promise<ConnectedRemoteAppServer> {
  const client = options.client ?? new AppServerClient();
  const transport = await RemoteTransport.connect(config);

  try {
    const initializeRequest = client.initialize(initializeParams);
    transport.send(initializeRequest);
    const initializeMessage = await transport.nextMessage(
      options.initializeTimeoutMs,
    );
    const initializeResponse = expectInitializeResponse(
      initializeMessage,
      initializeRequest.id,
    );
    assertInitializeResponse(
      initializeResponse,
      config.expectedServerName ?? protocol.SERVER_NAME,
      options.expectedProtocolVersion ?? protocol.PROTOCOL_VERSION,
    );
    transport.send(client.initialized());

    return {
      client,
      connection: new AppServerConnection(transport, client),
      transport,
      initializeResponse,
    };
  } catch (error) {
    await transport.close().catch(() => undefined);
    throw error;
  }
}

function validateRemoteTransportConfig(config: RemoteTransportConfig): {
  url: URL;
  headers: Record<string, string>;
  maxMessageBytes: number;
  connectTimeoutMs: number;
} {
  let url: URL;
  try {
    url = new URL(config.websocketUrl);
  } catch (error) {
    throw new Error(
      `invalid remote App Server URL \`${config.websocketUrl}\`: ${toError(error).message}`,
    );
  }

  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error(
      `remote App Server URL must use \`ws://\` or \`wss://\`: ${config.websocketUrl}`,
    );
  }
  if (url.username || url.password || url.hash) {
    throw new Error(
      "remote App Server URL must not contain userinfo or a fragment",
    );
  }
  if (hasSensitiveQuery(url)) {
    throw new Error(
      "remote App Server URL must not contain credential query parameters",
    );
  }

  assertSafeHeaderValue(config.authToken, "auth token");
  const authToken = config.authToken?.trim();
  if (config.authToken !== undefined && !authToken) {
    throw new Error("remote App Server auth token must not be empty");
  }
  if (authToken && url.protocol === "ws:" && !isLoopbackUrl(url)) {
    throw new Error(
      `remote auth tokens require \`wss://\` or loopback \`ws://\` URLs; got \`${config.websocketUrl}\``,
    );
  }

  assertSafeHeaderValue(config.tenantId, "tenant id");
  const tenantId = config.tenantId?.trim();
  if (config.tenantId !== undefined && !tenantId) {
    throw new Error("remote App Server tenant id must not be empty");
  }
  const maxMessageBytes =
    config.maxMessageBytes ?? MAX_REMOTE_WEBSOCKET_MESSAGE_BYTES;
  if (
    !Number.isSafeInteger(maxMessageBytes) ||
    maxMessageBytes <= 0 ||
    maxMessageBytes > MAX_REMOTE_WEBSOCKET_MESSAGE_BYTES
  ) {
    throw new Error(
      `remote App Server message limit must be an integer between 1 and ${MAX_REMOTE_WEBSOCKET_MESSAGE_BYTES} bytes`,
    );
  }

  const connectTimeoutMs =
    config.connectTimeoutMs ?? DEFAULT_REMOTE_CONNECT_TIMEOUT_MS;
  if (!Number.isFinite(connectTimeoutMs) || connectTimeoutMs <= 0) {
    throw new Error(
      "remote App Server connect timeout must be greater than zero",
    );
  }

  const headers: Record<string, string> = {};
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }
  if (tenantId) {
    headers["X-Lime-Tenant-ID"] = tenantId;
  }

  return { url, headers, maxMessageBytes, connectTimeoutMs };
}

async function openWebSocket(
  url: URL,
  options: {
    headers: Record<string, string>;
    maxPayload: number;
    perMessageDeflate: boolean;
  },
  timeoutMs: number,
): Promise<WebSocket> {
  let socket: WebSocket;
  try {
    socket = new WebSocket(url, options);
  } catch (error) {
    throw toError(error, "failed to create remote App Server WebSocket");
  }

  return await new Promise<WebSocket>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      socket.terminate();
      reject(
        new Error(`timed out connecting to remote App Server at \`${url}\``),
      );
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeListener("open", onOpen);
      socket.removeListener("error", onError);
      socket.removeListener("close", onClose);
    };
    const onOpen = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(socket);
    };
    const onError = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      socket.terminate();
      reject(
        new Error(
          `failed to connect to remote App Server at \`${url}\`: ${error.message}`,
        ),
      );
    };
    const onClose = (code: number, reason: Buffer) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      const detail = reason.toString("utf8");
      reject(
        new Error(
          detail.length > 0
            ? `remote App Server closed during connect (${code}): ${detail}`
            : `remote App Server closed during connect (${code})`,
        ),
      );
    };
    socket.once("open", onOpen);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}

function expectInitializeResponse(
  message: protocol.JsonRpcMessage,
  id: protocol.RequestId,
): protocol.InitializeResponse {
  if (protocol.isJsonRpcErrorResponse(message)) {
    throw new Error(`initialize failed: ${message.error.message}`);
  }
  if (!protocol.isJsonRpcResponse(message) || message.id !== id) {
    throw new Error(`expected initialize response for request ${String(id)}`);
  }
  return message.result as protocol.InitializeResponse;
}

function assertInitializeResponse(
  response: protocol.InitializeResponse,
  expectedServerName: string,
  expectedProtocolVersion: string,
): void {
  const serverInfo = response?.serverInfo;
  if (
    !serverInfo ||
    typeof serverInfo.name !== "string" ||
    typeof serverInfo.protocolVersion !== "string"
  ) {
    throw new Error(
      "remote App Server initialize response is missing serverInfo",
    );
  }
  if (serverInfo.name !== expectedServerName) {
    throw new Error(
      `remote App Server identity mismatch: expected \`${expectedServerName}\`, got \`${serverInfo.name}\``,
    );
  }
  if (serverInfo.protocolVersion !== expectedProtocolVersion) {
    throw new Error(
      `unsupported app-server protocol: expected ${expectedProtocolVersion}, got ${serverInfo.protocolVersion}`,
    );
  }
}

function hasSensitiveQuery(url: URL): boolean {
  const sensitiveNames = new Set([
    "access_token",
    "api_key",
    "apikey",
    "auth_token",
    "authorization",
    "bearer",
    "token",
  ]);
  for (const key of url.searchParams.keys()) {
    if (sensitiveNames.has(key.toLowerCase())) {
      return true;
    }
  }
  return false;
}

function isLoopbackUrl(url: URL): boolean {
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (hostname === "localhost" || hostname === "localhost.") {
    return true;
  }
  const addressType = isIP(hostname);
  return addressType === 4
    ? hostname.startsWith("127.")
    : addressType === 6 && hostname === "::1";
}

function assertSafeHeaderValue(value: string | undefined, label: string): void {
  if (value && /[\r\n]/u.test(value)) {
    throw new Error(
      `remote App Server ${label} contains invalid header characters`,
    );
  }
}

function websocketText(data: string | ArrayBuffer | Buffer | Buffer[]): string {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data.map((chunk) => Buffer.from(chunk))).toString(
      "utf8",
    );
  }
  return Buffer.from(data).toString("utf8");
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function toError(
  error: unknown,
  fallback = "remote App Server transport failed",
): Error {
  return error instanceof Error
    ? error
    : new Error(error ? String(error) : fallback);
}
