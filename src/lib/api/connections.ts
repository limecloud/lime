import { requestCloud } from "./cloudClient";

export interface ConnectionGrant {
  id: string;
  connectionId: string;
  connectionRevision: number;
  applicationId: string;
  applicationName?: string;
  actions: ["drive.files.read"];
  fileCount: number;
  status: "active";
  revision: number;
  expiresAt: string;
}

const IDENTIFIER = /^[A-Za-z0-9_-]{1,40}$/;
const MAX_ITEMS = 200;

function isSafeRevision(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= Number.MAX_SAFE_INTEGER
  );
}

const FIELDS = new Set([
  "id",
  "connectionId",
  "connectionRevision",
  "applicationId",
  "applicationName",
  "actions",
  "fileCount",
  "status",
  "revision",
  "expiresAt",
]);

function isConnectionGrant(value: unknown): value is ConnectionGrant {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !FIELDS.has(key))) return false;
  return (
    typeof record.id === "string" &&
    IDENTIFIER.test(record.id) &&
    typeof record.connectionId === "string" &&
    IDENTIFIER.test(record.connectionId) &&
    isSafeRevision(record.connectionRevision) &&
    typeof record.applicationId === "string" &&
    IDENTIFIER.test(record.applicationId) &&
    (record.applicationName === undefined ||
      (typeof record.applicationName === "string" &&
        record.applicationName.trim().length >= 1 &&
        record.applicationName.length <= 64)) &&
    Array.isArray(record.actions) &&
    record.actions.length === 1 &&
    record.actions[0] === "drive.files.read" &&
    typeof record.fileCount === "number" &&
    Number.isInteger(record.fileCount) &&
    record.fileCount >= 1 &&
    record.fileCount <= 20 &&
    record.status === "active" &&
    isSafeRevision(record.revision) &&
    typeof record.expiresAt === "string" &&
    record.expiresAt.length > 0 &&
    !Number.isNaN(Date.parse(record.expiresAt))
  );
}

/** 只读取当前账号连接资源可继续使用的委托安全投影；不触碰凭证或文件正文。 */
export async function listConnectionGrants(): Promise<ConnectionGrant[]> {
  const body = await requestCloud<unknown>({
    path: "/connections",
    method: "GET",
  });
  const items = (body as { items?: unknown } | null)?.items;
  if (
    !Array.isArray(items) ||
    items.length > MAX_ITEMS ||
    !items.every(isConnectionGrant)
  ) {
    throw new Error("connection grants returned an invalid list");
  }
  return items;
}
