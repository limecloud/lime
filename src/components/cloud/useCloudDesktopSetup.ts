import { useCallback, useEffect, useRef, useState } from "react";
import type { CloudDesktopResource } from "@limecloud/app-server-client";
import { requestCloudDesktop } from "@/lib/api/cloud";
import { configureCloudDesktopConnection } from "@/lib/api/cloudDesktopConnection";
import {
  object,
  pendingCloudLifecycleOperation,
} from "@/components/settings-v2/integrations/cloud-desktops/cloudDesktopData";

export type CloudSetupComputer = {
  resource: CloudDesktopResource;
  name?: string;
  status?: string;
  lifecycleOperation: ReturnType<typeof pendingCloudLifecycleOperation>;
  connectionSaved: boolean;
  inspectionFailed: boolean;
  releaseAt?: string;
  releasePending: boolean;
};

export function useCloudDesktopSetup(provisioned?: CloudDesktopResource) {
  const [computers, setComputers] = useState<CloudSetupComputer[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setFailed(false);
    try {
      const data = object(
        (await requestCloudDesktop({ action: "listResources" })).data,
      );
      if (current !== generation.current) return;
      if (!Array.isArray(data.resources))
        throw new Error("Invalid resource list");
      const operations = Array.isArray(data.operations)
        ? data.operations.map(object)
        : [];
      const resources = data.resources.map((value): CloudDesktopResource => {
        const entry = object(value);
        if (
          !["ecs", "wuying"].includes(String(entry.provider)) ||
          !["regionId", "resourceId", "profile"].every(
            (key) => typeof entry[key] === "string" && entry[key] !== "",
          )
        )
          throw new Error("Invalid resource");
        return value as CloudDesktopResource;
      });
      // A focused setup must not wait for, or inspect, unrelated computers.
      const targets = provisioned ? [provisioned] : resources;
      const observed = new Map<CloudDesktopResource, CloudSetupComputer>();
      if (targets.length === 0) setComputers([]);
      await Promise.all(
        targets.map(async (resource) => {
          const [inspection, connection] = await Promise.allSettled([
            requestCloudDesktop({ action: "inspect", resource }),
            configureCloudDesktopConnection({
              action:
                resource.provider === "ecs" ? "installationStatus" : "status",
              resource,
            }),
          ]);
          const state =
            inspection.status === "fulfilled"
              ? object(inspection.value.data)
              : {};
          const metadata =
            connection.status === "fulfilled" ? object(connection.value) : {};
          const computer: CloudSetupComputer = {
            resource,
            name: typeof state.name === "string" ? state.name : undefined,
            status: typeof state.status === "string" ? state.status : undefined,
            releaseAt:
              typeof state.autoReleaseTime === "string"
                ? state.autoReleaseTime
                : undefined,
            releasePending:
              typeof state.autoReleaseTime === "string" ||
              operations.some(
                (entry) =>
                  ["scheduleEcsRelease", "cancelEcsRelease"].includes(
                    String(entry.action),
                  ) &&
                  ![
                    "releaseCancelled",
                    "scheduleCancelled",
                    "released",
                  ].includes(String(entry.outcome)) &&
                  (
                    ["provider", "profile", "regionId", "resourceId"] as const
                  ).every(
                    (key) => object(entry.resource)[key] === resource[key],
                  ),
              ),
            lifecycleOperation: pendingCloudLifecycleOperation(
              operations,
              resource,
            ),
            connectionSaved:
              resource.provider === "ecs"
                ? metadata.connectionSaved === true
                : metadata.exists === true,
            inspectionFailed:
              inspection.status === "rejected" ||
              connection.status === "rejected" ||
              typeof state.status !== "string",
          };
          if (current !== generation.current) return;
          observed.set(resource, computer);
          setComputers((previous) => {
            if (current !== generation.current) return previous;
            // Publish independently while retaining existing rows during refresh.
            return targets.flatMap((target) => {
              const value =
                observed.get(target) ??
                previous.find((entry) =>
                  sameCloudResource(entry.resource, target),
                );
              return value ? [value] : [];
            });
          });
        }),
      );
    } catch {
      if (current === generation.current) setFailed(true);
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [provisioned]);
  useEffect(() => {
    const lease = generation;
    void refresh();
    return () => {
      lease.current++;
    };
  }, [refresh]);
  useEffect(() => {
    if (
      loading ||
      !computers.some(
        (computer) =>
          computer.lifecycleOperation ||
          ["Starting", "Pending"].includes(computer.status ?? ""),
      )
    )
      return;
    const timer = window.setTimeout(() => void refresh(), 5000);
    return () => window.clearTimeout(timer);
  }, [computers, loading, refresh]);
  return { computers, loading, failed, refresh };
}

export function sameCloudResource(
  left: CloudDesktopResource,
  right: CloudDesktopResource,
) {
  return (["provider", "profile", "regionId", "resourceId"] as const).every(
    (key) => left[key] === right[key],
  );
}
