import type {
  CloudDesktopResource,
  EcsDesktopSpec,
  WuyingDesktopSpec,
} from "@limecloud/app-server-client";
import { object } from "./cloudDesktopData";
import type { CloudPurchaseContext } from "./useCloudPurchase";

export function cloudPurchasedResource(
  value: unknown,
  context: CloudPurchaseContext<EcsDesktopSpec | WuyingDesktopSpec>,
): CloudDesktopResource | undefined {
  const receipt = object(value);
  const request = object(receipt.request);
  const observed = object(receipt.observedAfter);
  const spec = object(request.spec);
  const actual = object(observed.spec);
  if (
    !("vSwitchId" in context.spec) ||
    !context.operationId ||
    receipt.operationId !== context.operationId ||
    receipt.outcome !== "provisioned" ||
    receipt.requiresInspection !== false ||
    request.action !== "purchaseEcs" ||
    request.desktopName !== context.desktopName ||
    observed.desktopName !== context.desktopName ||
    observed.operationId !== context.operationId ||
    observed.chargeType !== "PostPaid" ||
    observed.systemDiskEncrypted !== true ||
    typeof observed.systemDiskId !== "string" ||
    !/^d-[A-Za-z0-9_-]+$/.test(observed.systemDiskId) ||
    typeof receipt.instanceId !== "string" ||
    !/^i-[A-Za-z0-9_-]+$/.test(receipt.instanceId) ||
    observed.instanceId !== receipt.instanceId ||
    Object.entries(context.spec).some(
      ([key, expected]) => spec[key] !== expected || actual[key] !== expected,
    )
  )
    return undefined;
  return {
    provider: "ecs",
    profile: context.spec.profile,
    regionId: context.spec.regionId,
    resourceId: receipt.instanceId,
  };
}
