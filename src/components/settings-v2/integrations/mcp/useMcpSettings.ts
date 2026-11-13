import { useCallback, useEffect, useRef, useState } from "react";
import { isEqual } from "lodash-es";
import {
  mcpServerOauthLoginCompletedServerNotification,
  mcpServerStatusUpdatedServerNotification,
} from "@limecloud/app-server-client";
import {
  listAllMcpServerStatuses,
  mcpApi,
  type McpServer,
} from "@/lib/api/mcp";
import { subscribeAppServerNotifications } from "@/lib/api/appServerEventBus";
import { openExternalUrlWithSystemBrowser } from "@/lib/api/externalUrl";
import { mcpServerEnabled } from "./mcpServerConfig";

export interface McpSettingsSnapshot {
  servers: McpServer[];
  statuses: Awaited<ReturnType<typeof listAllMcpServerStatuses>>;
}
type Mutation =
  | { kind: "save"; server: McpServer; create: boolean; previous?: McpServer }
  | { kind: "enabled"; id: string; enabled: boolean }
  | { kind: "delete"; id: string };
export type McpSettingsError =
  | "load"
  | "save"
  | "refresh"
  | "overridden"
  | "auth";

function confirms(snapshot: McpSettingsSnapshot, mutation: Mutation) {
  const id = mutation.kind === "save" ? mutation.server.id : mutation.id;
  const server = snapshot.servers.find((item) => item.id === id);
  if (mutation.kind === "delete") return !server;
  if (!server) return false;
  if (mutation.kind === "enabled")
    return (
      server.enabled_lime === mutation.enabled &&
      mcpServerEnabled(server) === mutation.enabled
    );
  return (
    server.name === mutation.server.name &&
    isEqual(server.server_config, mutation.server.server_config)
  );
}

async function readSnapshot(): Promise<McpSettingsSnapshot> {
  const [servers, statuses] = await Promise.all([
    mcpApi.getServers(),
    listAllMcpServerStatuses(),
  ]);
  return { servers, statuses };
}

export function useMcpSettings() {
  const [snapshot, setSnapshot] = useState<McpSettingsSnapshot>({
    servers: [],
    statuses: [],
  });
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [confirmationVersion, setConfirmationVersion] = useState(0);
  const [error, setError] = useState<McpSettingsError | null>(null);
  const epoch = useRef(0);
  const busy = useRef(false);
  const refreshQueued = useRef(false);
  const authFailed = useRef(false);
  const unconfirmed = useRef<Mutation | null>(null);
  const invalidate = useCallback(() => {
    ++epoch.current;
    busy.current = false;
    refreshQueued.current = false;
  }, []);
  const accept = useCallback((value: McpSettingsSnapshot) => {
    setSnapshot(value);
    const mutation = unconfirmed.current;
    unconfirmed.current = null;
    const confirmed = !mutation || confirms(value, mutation);
    if (mutation && confirmed) setConfirmationVersion((version) => version + 1);
    setError(confirmed ? (authFailed.current ? "auth" : null) : "overridden");
    return confirmed;
  }, []);
  const reload = useCallback(async (): Promise<boolean> => {
    if (busy.current) return false;
    const request = epoch.current;
    busy.current = true;
    refreshQueued.current = false;
    setLoading(true);
    try {
      const value = await readSnapshot();
      if (request !== epoch.current) return false;
      return accept(value);
    } catch {
      if (request === epoch.current)
        setError(unconfirmed.current ? "refresh" : "load");
      return false;
    } finally {
      if (request === epoch.current) {
        busy.current = false;
        setLoading(false);
        if (refreshQueued.current) void reload();
      }
    }
  }, [accept]);
  useEffect(() => {
    ++epoch.current;
    const subscription = epoch.current;
    busy.current = false;
    void reload();
    const unsubscribe = subscribeAppServerNotifications({
      onNotifications: (messages) => {
        if (subscription !== epoch.current) return;
        for (const message of messages) {
          const auth = mcpServerOauthLoginCompletedServerNotification(message);
          if (auth || mcpServerStatusUpdatedServerNotification(message)) {
            if (auth) authFailed.current = !auth.params.success;
            refreshQueued.current = true;
          }
        }
        if (refreshQueued.current) void reload();
      },
    });
    return () => {
      invalidate();
      unsubscribe();
    };
  }, [reload, invalidate]);

  const mutate = async (mutation: Mutation) => {
    if (busy.current || unconfirmed.current) return false;
    const request = epoch.current;
    busy.current = true;
    setPending(true);
    setError(null);
    let saved = false;
    try {
      if (mutation.kind === "delete") await mcpApi.deleteServer(mutation.id);
      else if (mutation.kind === "enabled") {
        if (mutation.enabled) {
          const latest = await mcpApi.getServers();
          if (request !== epoch.current) return false;
          const existing = latest.find((item) => item.id === mutation.id);
          if (!existing) {
            setError("overridden");
            return false;
          }
          if (existing.server_config.enabled === false)
            await mcpApi.updateServer({
              ...existing,
              enabled_lime: true,
              server_config: { ...existing.server_config, enabled: true },
            });
          else await mcpApi.toggleServer(mutation.id, true);
        } else await mcpApi.toggleServer(mutation.id, false);
      } else {
        const latest = await mcpApi.getServers();
        if (request !== epoch.current) return false;
        const existing = latest.find((item) => item.id === mutation.server.id);
        if (
          latest.some(
            (item) =>
              item.id !== mutation.server.id &&
              item.name === mutation.server.name,
          ) ||
          (!mutation.create &&
            (!existing ||
              !mutation.previous ||
              existing.name !== mutation.previous.name ||
              !isEqual(
                existing.server_config,
                mutation.previous.server_config,
              )))
        ) {
          setError("overridden");
          return false;
        }
        if (mutation.create) await mcpApi.addServer(mutation.server);
        else
          await mcpApi.updateServer({
            ...existing!,
            name: mutation.server.name,
            server_config: mutation.server.server_config,
          });
      }
      saved = true;
      if (request !== epoch.current) return false;
      unconfirmed.current = mutation;
      const latest = await readSnapshot();
      if (request !== epoch.current) return false;
      return accept(latest);
    } catch {
      if (request === epoch.current) setError(saved ? "refresh" : "save");
      return false;
    } finally {
      if (request === epoch.current) {
        busy.current = false;
        setPending(false);
        if (refreshQueued.current) void reload();
      }
    }
  };
  const authenticate = async (name: string) => {
    if (busy.current) return;
    const request = epoch.current;
    busy.current = true;
    setPending(true);
    setError(null);
    authFailed.current = false;
    try {
      const response = await mcpApi.loginOAuthServer(name);
      if (request !== epoch.current) return;
      const url = new URL(response.authorizationUrl);
      if (!["https:", "http:"].includes(url.protocol))
        throw new Error("Invalid authorization URL");
      await openExternalUrlWithSystemBrowser(url.toString());
    } catch {
      if (request === epoch.current) {
        authFailed.current = true;
        setError("auth");
      }
    } finally {
      if (request === epoch.current) {
        busy.current = false;
        setPending(false);
        if (refreshQueued.current) void reload();
      }
    }
  };
  return {
    ...snapshot,
    loading,
    pending,
    confirmationVersion,
    error,
    reload,
    mutate,
    authenticate,
    clearError: () => {
      authFailed.current = false;
      setError(null);
    },
    awaitingConfirmation: unconfirmed.current !== null,
  };
}

export type McpSettingsController = ReturnType<typeof useMcpSettings>;
