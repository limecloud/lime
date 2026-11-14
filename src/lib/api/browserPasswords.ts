import { safeInvoke } from "@/lib/dev-bridge";

export interface BrowserPasswordSummary {
  id: string;
  origin: string;
  username: string;
  updatedAt: number;
}

function isSummary(value: unknown): value is BrowserPasswordSummary {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    record.id.length > 0 &&
    typeof record.origin === "string" &&
    record.origin.length > 0 &&
    typeof record.username === "string" &&
    record.username.length > 0 &&
    typeof record.updatedAt === "number" &&
    Number.isFinite(record.updatedAt)
  );
}

export async function listBrowserPasswords(): Promise<
  BrowserPasswordSummary[]
> {
  const result = await safeInvoke<unknown>("browser_passwords_list");
  if (!Array.isArray(result) || !result.every(isSummary)) {
    throw new Error("browser passwords returned an invalid list");
  }
  return result;
}

export async function saveBrowserPassword(input: {
  origin: string;
  username: string;
  password: string;
}): Promise<BrowserPasswordSummary> {
  const result = await safeInvoke<unknown>("browser_passwords_save", {
    ...input,
  });
  if (!isSummary(result)) {
    throw new Error("browser password save returned an invalid result");
  }
  return result;
}

export async function removeBrowserPassword(id: string): Promise<boolean> {
  const result = await safeInvoke<unknown>("browser_passwords_remove", { id });
  if (typeof result !== "boolean") {
    throw new Error("browser password remove returned an invalid result");
  }
  return result;
}

export async function revealBrowserPassword(
  id: string,
): Promise<string | null> {
  const result = await safeInvoke<unknown>("browser_passwords_reveal", { id });
  if (result !== null && typeof result !== "string") {
    throw new Error("browser password reveal returned an invalid result");
  }
  return result;
}

export async function clearBrowserPasswords(): Promise<boolean> {
  const result = await safeInvoke<unknown>("browser_passwords_clear");
  if (typeof result !== "boolean") {
    throw new Error("browser password clear returned an invalid result");
  }
  return result;
}
