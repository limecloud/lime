import type { CloudDesktopResource } from "@limecloud/app-server-client";

export const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

type CloudLifecycleOperation = Record<string, unknown> & {
  action: "start" | "stop";
  operationId: string;
};

export function pendingCloudLifecycleOperation(
  operations: readonly Record<string, unknown>[],
  resource: CloudDesktopResource,
): CloudLifecycleOperation | undefined {
  return operations.find(
    (entry): entry is CloudLifecycleOperation =>
      ["start", "stop"].includes(String(entry.action)) &&
      ["accepted", "unknown"].includes(String(entry.outcome)) &&
      typeof entry.operationId === "string" &&
      entry.operationId !== "" &&
      (["provider", "profile", "regionId", "resourceId"] as const).every(
        (key) => object(entry.resource)[key] === resource[key],
      ),
  );
}
