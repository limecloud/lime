import { useCallback, useEffect, useRef, useState } from "react";
import type { CloudDesktopResource } from "@limecloud/app-server-client";
import { requestCloudDesktop } from "@/lib/api/cloud";
import { configureCloudDesktopConnection } from "@/lib/api/cloudDesktopConnection";
import { object } from "@/components/settings-v2/integrations/cloud-desktops/cloudDesktopData";

export type CloudSetupComputer = {
  resource: CloudDesktopResource;
  name?: string;
  status?: string;
  starting: boolean;
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
      if (
        provisioned &&
        !resources.some((resource) => sameCloudResource(resource, provisioned))
      )
        resources.push(provisioned);
      const observed = await Promise.all(
        resources.map(async (resource) => {
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
          return {
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
            starting:
              state.status !== "Running" &&
              operations.some(
                (entry) =>
                  entry.action === "start" &&
                  entry.outcome === "accepted" &&
                  Date.now() - Date.parse(String(entry.createdAt)) < 600_000 &&
                  (
                    ["provider", "profile", "regionId", "resourceId"] as const
                  ).every(
                    (key) => object(entry.resource)[key] === resource[key],
                  ),
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
        }),
      );
      if (current === generation.current) setComputers(observed);
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
          computer.starting ||
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
