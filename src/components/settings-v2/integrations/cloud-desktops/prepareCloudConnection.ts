import type { CloudDesktopResource } from "@limecloud/app-server-client";
import { requestCloudDesktop } from "@/lib/api/cloud";
import { object } from "./cloudDesktopData";

/** Keep one authorized intent; the server reconciles its original durable receipt. */
export async function prepareCloudConnection(
  resource: CloudDesktopResource,
  isCurrent: () => boolean,
): Promise<boolean> {
  if (resource.provider !== "ecs") return true;
  const operationId = crypto.randomUUID();
  const started = Date.now();
  while (isCurrent()) {
    if (Date.now() - started >= 600_000)
      throw new Error("CLOUD_CONNECTION_SETUP_FAILED");
    const data = object(
      (
        await requestCloudDesktop({
          action: "prepareEcsConnection",
          resource,
          operationId,
          confirmation: `prepareEcsConnection:${resource.regionId}:${resource.resourceId}`,
        })
      ).data,
    );
    if (!isCurrent()) return false;
    // Advanced networks retain their existing, user-managed access policy.
    if (data.outcome === "unmanagedNetwork") return true;
    const request = object(data.request);
    const target = object(data.observedResource);
    if (
      typeof data.operationId !== "string" ||
      !data.operationId ||
      request.action !== "prepareEcsConnection" ||
      target.provider !== resource.provider ||
      target.profile !== resource.profile ||
      target.regionId !== resource.regionId ||
      target.resourceId !== resource.resourceId
    )
      throw new Error("CLOUD_CONNECTION_SETUP_FAILED");
    if (
      data.outcome === "connectionReady" &&
      data.phase === "complete" &&
      data.requiresInspection === false
    )
      return true;
    if (
      data.outcome !== "connectionPreparing" ||
      Date.now() - started >= 600_000
    )
      throw new Error("CLOUD_CONNECTION_SETUP_FAILED");
    await new Promise<void>((resolve) => setTimeout(resolve, 3000));
  }
  return false;
}
