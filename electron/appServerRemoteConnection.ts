import {
  connectRemoteAppServer,
  type ConnectedAppServerSidecar,
  type ConnectedRemoteAppServer,
  type InitializeParams,
  type RemoteTransportConfig,
} from "@limecloud/app-server-client";

export type AppServerHostConnection = Pick<
  ConnectedAppServerSidecar,
  "client" | "connection" | "initializeResponse"
> &
  Partial<Pick<ConnectedAppServerSidecar, "sidecar">>;

/** Only fixed local diagnostics may cross the remote connection error boundary. */
export class AppServerConnectionConfigError extends Error {
  constructor(code: "ECS_SECURITY_GROUP_DENIED" | "ECS_TUNNEL_FAILED") {
    super(code);
  }
}

/** A disconnected remote session requires explicit reconnection, never local fallback. */
export class AppServerRemoteConnection {
  #connected: ConnectedRemoteAppServer | null = null;
  #attempted = false;
  #stopped = false;
  #epoch = 0;

  constructor(readonly readConfig: () => Promise<RemoteTransportConfig>) {}

  get connected(): AppServerHostConnection | null {
    return this.#connected && !this.#connected.transport.closed
      ? this.#connected
      : null;
  }

  async connect(params: InitializeParams): Promise<AppServerHostConnection> {
    if (this.#stopped) throw new Error("remote App Server host is stopped");
    if (this.connected) return this.connected;
    if (this.#attempted) {
      throw new Error(
        "remote App Server disconnected; reconnect explicitly before continuing",
      );
    }
    this.#attempted = true;
    const epoch = this.#epoch;
    let connected: ConnectedRemoteAppServer;
    try {
      connected = await connectRemoteAppServer(await this.readConfig(), params);
    } catch (error) {
      if (error instanceof AppServerConnectionConfigError) throw error;
      // Remote close reasons and authentication responses are untrusted and may contain secrets.
      throw new Error(
        "remote App Server connection failed; check endpoint and authentication",
      );
    }
    if (this.#stopped || epoch !== this.#epoch) {
      await connected.transport.close();
      throw new Error("remote App Server connection was closed");
    }
    this.#connected = connected;
    return connected;
  }

  async reset(): Promise<void> {
    this.#epoch += 1;
    const connected = this.#connected;
    this.#connected = null;
    this.#attempted = false;
    await connected?.transport.close();
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    await this.reset();
  }
}
