import {
  AppServerClient,
  type AppServerStorageState,
  type AppServerStorageReviewParams,
  type AppServerStorageReviewResponse,
  type AppServerStorageDeleteParams,
  type AppServerStorageDeleteResponse,
} from "./appServer";
import { notifyAgentRuntimeSessionsChanged } from "./agentRuntime/sessionClient";

export type StorageState = AppServerStorageState;
export type StorageReview = AppServerStorageReviewResponse;
export type StorageCandidate = StorageReview["candidates"][number];
export type StorageDeleteResult = AppServerStorageDeleteResponse;

const categories = new Set([
  "threads",
  "subagents",
  "archived",
  "unclassified",
  "worktrees",
  "other",
]);
function bytes(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validateState(state: StorageState): StorageState {
  if (
    !state ||
    !["scanning", "ready", "error"].includes(state.status) ||
    !Array.isArray(state.completedCategories) ||
    !state.completedCategories.every((category) => categories.has(category)) ||
    (state.measuredAt !== null &&
      (!bytes(state.measuredAt) || state.measuredAt === 0))
  ) {
    throw new Error("storage returned an invalid measurement state");
  }
  const usage = state.usage;
  if (
    usage !== null &&
    (!usage ||
      typeof usage.dataRoot !== "string" ||
      typeof usage.worktreeRoot !== "string" ||
      !Array.isArray(usage.scannedRoots) ||
      !usage.scannedRoots.every((root) => typeof root === "string") ||
      !bytes(usage.totalBytes) ||
      !Array.isArray(usage.categories) ||
      !usage.categories.every(
        (entry) => categories.has(entry.category) && bytes(entry.bytes),
      ) ||
      !usage.threadBytes ||
      !Object.values(usage.threadBytes).every(bytes))
  ) {
    throw new Error("storage returned invalid capacity data");
  }
  return state;
}

export async function readStorage(refresh = false): Promise<StorageState> {
  const client = new AppServerClient();
  const { result } = await (refresh
    ? client.refreshStorage({})
    : client.readStorage({}));
  return validateState(result);
}

export async function reviewStorage(
  params: AppServerStorageReviewParams,
): Promise<StorageReview> {
  const { result } = await new AppServerClient().reviewStorage(params);
  const snapshot = (value: StorageCandidate["root"]) =>
    value &&
    typeof value.threadId === "string" &&
    value.threadId.length > 0 &&
    bytes(value.updatedAtMs) &&
    typeof value.archived === "boolean";
  if (
    !result ||
    !bytes(result.cutoffMs) ||
    typeof result.archivedOnly !== "boolean" ||
    !Array.isArray(result.candidates) ||
    !result.candidates.every(
      (entry) =>
        snapshot(entry.root) &&
        typeof entry.name === "string" &&
        bytes(entry.bytes) &&
        Array.isArray(entry.descendants) &&
        entry.descendants.every(snapshot),
    )
  ) {
    throw new Error("storage returned an invalid review");
  }
  return result;
}

export async function deleteStorage(
  params: AppServerStorageDeleteParams,
): Promise<StorageDeleteResult> {
  try {
    const { result } = await new AppServerClient().deleteStorage(params);
    if (
      !result ||
      ![result.deleted, result.skipped, result.failed].every(bytes)
    ) {
      throw new Error("storage did not confirm cleanup results");
    }
    return result;
  } finally {
    notifyAgentRuntimeSessionsChanged({ reason: "external" });
  }
}
