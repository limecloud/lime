import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import * as Tabs from "@radix-ui/react-tabs";
import type { CloudDesktopResource } from "@limecloud/app-server-client";
import { requestCloudDesktop } from "@/lib/api/cloud";
import {
  SettingsAction,
  SettingsGroup,
  SettingsPageBody,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
} from "../../SettingsPrimitives";
import { CloudReceipt, Field, inputClass } from "./CloudDesktopPrimitives";
import { object } from "./cloudDesktopData";
import { CloudResourceActions } from "./CloudResourceActions";
import {
  CloudSnapshotRestore,
  CloudRestoreVerification,
} from "./CloudSnapshotRestore";
import { CloudTaskConnection } from "./CloudTaskConnection";
import { CloudRuntimeInstallation } from "./CloudRuntimeInstallation";
import { CloudDesktopTunnel } from "./CloudDesktopTunnel";
import { CloudArchivePanel } from "./CloudArchivePanel";
import { AddCloudDesktop, cloudTabClass } from "./AddCloudDesktop";

function matchesResource(value: unknown, resource: CloudDesktopResource) {
  const target = object(value);
  return (["provider", "regionId", "resourceId", "profile"] as const).every(
    (field) => target[field] === resource[field],
  );
}

export function CloudDesktopsSettings() {
  const { t } = useTranslation("settings");
  const [resources, setResources] = useState<CloudDesktopResource[]>([]);
  const [operations, setOperations] = useState<Record<string, unknown>[]>([]);
  const [states, setStates] = useState<Record<string, Record<string, unknown>>>(
    {},
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [operationId, setOperationId] = useState("");
  const [receipt, setReceipt] = useState<unknown>();
  const [showAllOperations, setShowAllOperations] = useState(false);
  const active = useRef(true);
  const busy = useRef(false);
  const key = (item: CloudDesktopResource) => JSON.stringify(item);
  const latestOperation = (resource: CloudDesktopResource) =>
    operations.find((entry) => matchesResource(entry.resource, resource));
  const isWaitingForState = (resource: CloudDesktopResource) => {
    const entry = latestOperation(resource);
    if (
      !entry ||
      ![
        "accepted",
        ...(entry?.action === "release" ? ["unknown"] : []),
      ].includes(String(entry?.outcome)) ||
      Date.now() - Date.parse(String(entry.createdAt)) > 600000
    )
      return false;
    const expected =
      entry.action === "release"
        ? "Released"
        : entry.action === "start"
          ? "Running"
          : entry.action === "stop"
            ? "Stopped"
            : undefined;
    return Boolean(expected && states[key(resource)]?.status !== expected);
  };
  const waitingForState = resources.some(isWaitingForState);
  const preparing = (resource: CloudDesktopResource) =>
    operations.some(
      (entry) =>
        entry.action === "prepareEcsDesktop" &&
        matchesResource(entry.resource, resource) &&
        !["dependenciesReady", "preparationFailed", "notSubmitted"].includes(
          String(entry.outcome),
        ),
    );
  const waitingForPreparation = operations.some(
    (entry) =>
      entry.action === "prepareEcsDesktop" &&
      ["accepted", "preparing"].includes(String(entry.outcome)) &&
      Date.now() - Date.parse(String(entry.createdAt)) < 1860000,
  );

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      const data = object(
        (await requestCloudDesktop({ action: "listResources" })).data,
      );
      if (!Array.isArray(data.resources))
        throw new Error(t("settings.cloudDesktop.invalidResponse"));
      const list = data.resources.filter(
        (value): value is CloudDesktopResource => {
          const item = object(value);
          return (
            ["ecs", "wuying"].includes(String(item.provider)) &&
            ["regionId", "resourceId", "profile"].every(
              (k) => typeof item[k] === "string",
            )
          );
        },
      );
      if (!active.current) return;
      // Query the original receipt while release is pending; never resend it.
      const operations = await Promise.all(
        (Array.isArray(data.operations) ? data.operations.map(object) : []).map(
          async (entry) => {
            if (
              !["release", "prepareEcsDesktop"].includes(
                String(entry.action),
              ) ||
              !["accepted", "unknown", "preparing"].includes(
                String(entry.outcome),
              )
            )
              return entry;
            try {
              const receipt = object(
                (
                  await requestCloudDesktop({
                    action: "readOperation",
                    operationId: String(entry.operationId),
                  })
                ).data,
              );
              return { ...entry, outcome: receipt.outcome };
            } catch (cause) {
              return { ...entry, verificationError: String(cause) };
            }
          },
        ),
      );
      if (!active.current) return;
      const remaining = list.filter(
        (item) =>
          !operations.some((entry) => {
            return (
              entry.action === "release" &&
              entry.outcome === "released" &&
              matchesResource(entry.resource, item)
            );
          }),
      );
      setResources(remaining);
      setOperations(operations);
      const observed = await Promise.all(
        remaining.map(async (item) => {
          try {
            return [
              key(item),
              object(
                (
                  await requestCloudDesktop({
                    action: "inspect",
                    resource: item,
                  })
                ).data,
              ),
            ] as const;
          } catch (cause) {
            return [key(item), { error: String(cause) }] as const;
          }
        }),
      );
      if (active.current) setStates(Object.fromEntries(observed));
    } catch (cause) {
      if (active.current) setError(String(cause));
    } finally {
      busy.current = false;
      if (active.current) setPending(false);
    }
  }, [t]);
  useEffect(() => {
    active.current = true;
    void refresh();
    return () => {
      active.current = false;
    };
  }, [refresh]);
  useEffect(() => {
    if (
      pending ||
      (!waitingForState &&
        !waitingForPreparation &&
        !Object.values(states).some((state) =>
          ["Starting", "Stopping", "Pending", "Deleting"].includes(
            String(state.status),
          ),
        ))
    )
      return;
    const timer = window.setTimeout(() => void refresh(), 5000);
    return () => window.clearTimeout(timer);
  }, [pending, states, refresh, waitingForState, waitingForPreparation]);

  async function read(id = operationId) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    setReceipt(undefined);
    let refreshNeeded = false;
    try {
      const result = (
        await requestCloudDesktop({
          action: "readOperation",
          operationId: id,
        })
      ).data;
      setReceipt(result);
      refreshNeeded = [
        "released",
        "provisioned",
        "dependenciesReady",
        "preparationFailed",
      ].includes(String(object(result).outcome));
    } catch (cause) {
      setError(String(cause));
    } finally {
      busy.current = false;
      setPending(false);
      if (refreshNeeded) void refresh();
    }
  }
  return (
    <SettingsPageBody>
      <SettingsPageHeader
        title={t("settings.cloudDesktop.title")}
        actions={
          <SettingsAction disabled={pending} onClick={() => void refresh()}>
            {t("settings.cloudDesktop.refresh")}
          </SettingsAction>
        }
      />
      <p className="-mt-6 text-[13px] text-muted-foreground">
        {t("settings.cloudDesktop.description")}
      </p>
      {error && (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      )}
      <Tabs.Root defaultValue="computers">
        <Tabs.List
          className="mb-6 flex gap-1"
          aria-label={t("settings.cloudDesktop.title")}
        >
          <Tabs.Trigger className={cloudTabClass} value="computers">
            {t("settings.cloudDesktop.computers")}
          </Tabs.Trigger>
          <Tabs.Trigger className={cloudTabClass} value="backups">
            {t("settings.cloudDesktop.backups")}
          </Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="computers" className="space-y-8 outline-none">
          <SettingsSection
            title={t("settings.cloudDesktop.resources")}
            actions={<AddCloudDesktop onChanged={() => void refresh()} />}
          >
            {pending && (
              <p role="status">{t("settings.cloudDesktop.loading")}</p>
            )}
            {!pending && !error && resources.length === 0 && (
              <p className="text-muted-foreground">
                {t("settings.cloudDesktop.empty")}
              </p>
            )}
            {resources.length > 0 && (
              <SettingsGroup>
                {resources.map((item) => {
                  const state = states[key(item)] ?? {};
                  const status = String(state.status ?? "unknown");
                  return (
                    <SettingsRow
                      key={key(item)}
                      className="[&_.settings-row-control]:flex-wrap"
                      label={
                        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span>
                            {typeof state.name === "string" && state.name
                              ? state.name
                              : t("settings.cloudDesktop.unnamedDesktop")}
                          </span>
                          <span className="inline-flex items-center gap-1.5 text-[12px] font-normal text-muted-foreground">
                            <span
                              aria-hidden="true"
                              className={`size-1.5 rounded-full ${status === "Running" ? "bg-foreground" : "bg-muted-foreground"}`}
                            />
                            {t(`settings.cloudDesktop.status.${status}`, {
                              defaultValue: status,
                            })}
                          </span>
                        </span>
                      }
                      description={
                        <>
                          {item.provider === "wuying"
                            ? t("settings.cloudDesktop.wuying")
                            : "ECS"}{" "}
                          / {item.regionId}
                          <br />
                          {status === "NotFound"
                            ? t("settings.cloudDesktop.status.NotFound")
                            : state.computeReleased === true
                              ? t("settings.cloudDesktop.computeReleased")
                              : t("settings.cloudDesktop.billingUnknown")}
                          <br />
                          {t(
                            `settings.cloudDesktop.${item.provider === "wuying" ? "desktopConnection" : "ecsConnection"}`,
                          )}
                          {typeof state.error === "string" && (
                            <p role="alert" className="mt-1 text-destructive">
                              {state.error}
                            </p>
                          )}
                          <details className="mt-2">
                            <summary className="w-fit cursor-pointer text-foreground">
                              {t("settings.cloudDesktop.resourceDetails")}
                            </summary>
                            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                              <dt>{t("settings.cloudDesktop.resourceId")}</dt>
                              <dd className="select-text">{item.resourceId}</dd>
                              <dt>{t("settings.cloudDesktop.profile")}</dt>
                              <dd className="select-text">{item.profile}</dd>
                            </dl>
                          </details>
                        </>
                      }
                    >
                      <CloudTaskConnection
                        resource={item}
                        running={status === "Running"}
                      />
                      {item.provider === "ecs" && (
                        <CloudRuntimeInstallation
                          resource={item}
                          running={status === "Running"}
                        />
                      )}
                      {item.provider === "ecs" && (
                        <CloudDesktopTunnel
                          resource={item}
                          running={status === "Running"}
                          request={requestCloudDesktop}
                        />
                      )}
                      <CloudResourceActions
                        resource={item}
                        status={status}
                        disabled={
                          pending || isWaitingForState(item) || preparing(item)
                        }
                        canRelease={state.instanceChargeType === "PostPaid"}
                        request={requestCloudDesktop}
                        onChanged={() => void refresh()}
                      />
                      {["Stopped", "Running"].includes(status) && (
                        <CloudSnapshotRestore
                          resource={item}
                          status={status}
                          disabled={
                            pending ||
                            isWaitingForState(item) ||
                            preparing(item)
                          }
                          request={requestCloudDesktop}
                          onChanged={() => void refresh()}
                        />
                      )}
                    </SettingsRow>
                  );
                })}
              </SettingsGroup>
            )}
          </SettingsSection>
          {operations.length > 0 && (
            <SettingsSection
              title={t("settings.cloudDesktop.recentOperations")}
            >
              <SettingsGroup>
                {(showAllOperations ? operations : operations.slice(0, 5)).map(
                  (entry) => (
                    <SettingsRow
                      key={String(entry.operationId)}
                      label={t(
                        `settings.cloudDesktop.${entry.action === "purchaseWuying" ? "purchase" : entry.action}`,
                        { defaultValue: String(entry.action) },
                      )}
                      description={
                        <>
                          {t(
                            `settings.cloudDesktop.outcomeLabel.${entry.outcome === "notSubmitted" && entry.action === "prepareEcsDesktop" ? "prepareNotSubmitted" : entry.outcome}`,
                            { defaultValue: String(entry.outcome) },
                          )}
                          {typeof entry.createdAt === "string" &&
                            Number.isFinite(Date.parse(entry.createdAt)) && (
                              <time className="ml-3" dateTime={entry.createdAt}>
                                {new Date(entry.createdAt).toLocaleString()}
                              </time>
                            )}
                          {typeof entry.verificationError === "string" && (
                            <p role="alert" className="mt-1 text-destructive">
                              {entry.verificationError}
                            </p>
                          )}
                        </>
                      }
                    >
                      <SettingsAction
                        disabled={pending}
                        onClick={() => {
                          const id = String(entry.operationId);
                          setOperationId(id);
                          void read(id);
                        }}
                      >
                        {t("settings.cloudDesktop.readOperation")}
                      </SettingsAction>
                    </SettingsRow>
                  ),
                )}
              </SettingsGroup>
              {operations.length > 5 && (
                <SettingsAction
                  className="mt-3"
                  onClick={() => setShowAllOperations(!showAllOperations)}
                >
                  {t(
                    `settings.cloudDesktop.${showAllOperations ? "showLess" : "showAll"}`,
                  )}
                </SettingsAction>
              )}
            </SettingsSection>
          )}
          <details className="text-[13px]">
            <summary className="cursor-pointer py-2 text-muted-foreground">
              {t("settings.cloudDesktop.providers")}
            </summary>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-3 py-3">
              <dt>{t("settings.cloudDesktop.alibaba")}</dt>
              <dd>Wuying / ECS</dd>
              {[
                "AWS",
                "Google Cloud",
                "Cloudflare",
                "腾讯云 / Tencent Cloud",
              ].map((name) => (
                <div key={name} className="contents">
                  <dt>{name}</dt>
                  <dd className="text-muted-foreground">
                    {t("settings.cloudDesktop.planned")}
                  </dd>
                </div>
              ))}
            </dl>
          </details>
          <details className="text-[13px]">
            <summary className="cursor-pointer py-2 text-muted-foreground">
              {t("settings.cloudDesktop.readOperation")}
            </summary>
            <div className="mt-3">
              <Field name="operationId">
                <input
                  className={inputClass}
                  value={operationId}
                  onChange={(e) => setOperationId(e.target.value)}
                />
              </Field>
              <SettingsAction
                className="my-3"
                disabled={pending || !operationId}
                onClick={() => void read()}
              >
                {t("settings.cloudDesktop.readOperation")}
              </SettingsAction>
            </div>
          </details>
          {receipt !== undefined && (
            <>
              <CloudReceipt data={receipt} />
              <CloudRestoreVerification
                key={String(object(receipt).operationId)}
                receipt={receipt}
                request={requestCloudDesktop}
                onChanged={() => void refresh()}
                onVerified={setReceipt}
              />
            </>
          )}
        </Tabs.Content>
        <Tabs.Content value="backups" className="outline-none">
          <CloudArchivePanel
            request={requestCloudDesktop}
            computers={resources.flatMap((resource) => {
              const state = states[key(resource)];
              return state?.status === "Running"
                ? [
                    {
                      key: key(resource),
                      resource,
                      name:
                        typeof state.name === "string" && state.name
                          ? state.name
                          : resource.resourceId,
                    },
                  ]
                : [];
            })}
          />
        </Tabs.Content>
      </Tabs.Root>
    </SettingsPageBody>
  );
}
