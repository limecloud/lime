import { safeInvoke } from "@/lib/dev-bridge";

export interface SshConnection {
  alias: string;
  hostName: string;
  user: string | null;
  port: number | null;
}

function isSshConnection(value: unknown): value is SshConnection {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.alias === "string" &&
    record.alias.length > 0 &&
    typeof record.hostName === "string" &&
    record.hostName.length > 0 &&
    (record.user === null || typeof record.user === "string") &&
    (record.port === null ||
      (typeof record.port === "number" && Number.isInteger(record.port)))
  );
}

export async function listSshConnections(): Promise<SshConnection[]> {
  const result = await safeInvoke<unknown>("ssh_connections_list");
  if (!Array.isArray(result) || !result.every(isSshConnection)) {
    throw new Error("ssh connections returned an invalid list");
  }
  return result;
}

export async function ensureSshConfig(): Promise<string> {
  const result = await safeInvoke<unknown>("ssh_config_ensure");
  if (typeof result !== "string" || !result) {
    throw new Error("ssh config ensure returned an invalid path");
  }
  return result;
}

export interface SshConnectionInput {
  alias: string;
  hostName: string;
  user?: string;
  port?: number;
}

export async function addSshConnection(
  input: SshConnectionInput,
): Promise<SshConnection> {
  const result = await safeInvoke<unknown>("ssh_connection_add", {
    ...input,
  });
  if (!isSshConnection(result)) {
    throw new Error("ssh connection add returned an invalid result");
  }
  return result;
}

export async function removeSshConnection(alias: string): Promise<boolean> {
  const result = await safeInvoke<unknown>("ssh_connection_remove", { alias });
  if (typeof result !== "boolean") {
    throw new Error("ssh connection remove returned an invalid result");
  }
  return result;
}

export interface SshConnectionUpdateInput {
  hostName: string;
  user?: string;
  port?: number;
}

export async function updateSshConnection(
  alias: string,
  input: SshConnectionUpdateInput,
): Promise<boolean> {
  const result = await safeInvoke<unknown>("ssh_connection_update", {
    alias,
    ...input,
  });
  if (typeof result !== "boolean") {
    throw new Error("ssh connection update returned an invalid result");
  }
  return result;
}
