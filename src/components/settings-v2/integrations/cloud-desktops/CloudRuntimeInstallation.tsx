import { useCallback, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useTranslation } from "react-i18next";
import type { CloudDesktopResource } from "@limecloud/app-server-client";
import type {
  CloudGuestInstallationRequest,
  CloudGuestInstallationStatus,
} from "@/lib/desktop-host/cloudDesktopConnection";
import { configureCloudDesktopConnection } from "@/lib/api/cloudDesktopConnection";
import { isElectronHostCommandAvailable } from "@/lib/electron-host";
import { SettingsAction } from "../../SettingsPrimitives";

export function CloudRuntimeInstallation({
  resource,
  running,
}: {
  resource: CloudDesktopResource;
  running: boolean;
}) {
  const { t } = useTranslation("settings");
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<CloudGuestInstallationStatus>();
  const [pending, setPending] = useState(false);
  const [trusted, setTrusted] = useState(false);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const execute = useCallback(
    async (
      action: CloudGuestInstallationRequest["action"],
      operationId?: string,
    ) => {
      if (busy.current) return;
      busy.current = true;
      setPending(true);
      setError("");
      const current = generation.current;
      try {
        const request: CloudGuestInstallationRequest =
          action === "installRuntime"
            ? {
                action,
                resource,
                confirmation: `installRuntime:${resource.regionId}:${resource.resourceId}`,
                trustArtifact: trusted,
                createDesktopUser: consent,
              }
            : action === "resumeInstallation"
              ? { action, resource, operationId: operationId ?? "" }
              : { action, resource };
        const value = await configureCloudDesktopConnection(request);
        if (!("kind" in value) || value.kind !== "installation")
          throw new Error("invalid installation status");
        if (current === generation.current) setStatus(value);
      } catch (cause) {
        if (current === generation.current)
          setError(
            t(
              String(cause).includes("CLOUD_INSTALL_CONNECTION_EXISTS")
                ? "settings.cloudDesktop.installConnectionExists"
                : "settings.cloudDesktop.installRequestFailed",
            ),
          );
      } finally {
        busy.current = false;
        if (current === generation.current) setPending(false);
      }
    },
    [resource, trusted, consent, t],
  );
  useEffect(() => {
    if (!open || !status?.busy) return;
    const timer = setInterval(() => void execute("installationStatus"), 2000);
    return () => clearInterval(timer);
  }, [open, status?.busy, execute]);
  const recoverable =
    status?.exists &&
    status.operationId &&
    !["complete", "failed", "expired"].includes(status.phase ?? "");

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (pending) return;
        generation.current++;
        setOpen(value);
        setError("");
        setTrusted(false);
        setConsent(false);
        if (value) {
          setStatus(undefined);
          void execute("installationStatus");
        }
      }}
    >
      <Dialog.Trigger asChild>
        <SettingsAction
          disabled={!isElectronHostCommandAvailable("cloud_desktop_connection")}
        >
          {t("settings.cloudDesktop.installRuntime")}
        </SettingsAction>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/30" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[70] max-h-[85vh] w-[min(480px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 space-y-4 overflow-y-auto rounded-xl border-[0.5px] border-border bg-popover p-6 text-popover-foreground outline-none"
          onEscapeKeyDown={(event) => {
            if (pending) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (pending) event.preventDefault();
          }}
        >
          <Dialog.Title className="text-[16px] font-medium">
            {t("settings.cloudDesktop.installRuntime")}
          </Dialog.Title>
          <Dialog.Description className="text-[13px] text-muted-foreground">
            {t("settings.cloudDesktop.installDescription")}
          </Dialog.Description>
          <p className="select-text break-all text-[12px] text-muted-foreground">
            {resource.resourceId} / {resource.regionId}
          </p>
          <p className="text-[13px] text-muted-foreground">
            {t("settings.cloudDesktop.installNetworkHelp")}
          </p>
          {status?.available === false && (
            <p role="alert" className="text-[13px] text-destructive">
              {t("settings.cloudDesktop.secureStorageUnavailable")}
            </p>
          )}
          {status?.phase && (
            <p role="status" aria-live="polite" className="text-[13px]">
              {t(`settings.cloudDesktop.installPhase.${status.phase}`)}
            </p>
          )}
          {status?.diagnostic && (
            <p role="alert" className="text-[13px] text-destructive">
              {t(
                status.diagnostic === "CLOUD_INSTALL_DEPENDENCIES_REQUIRED"
                  ? "settings.cloudDesktop.installDependenciesRequired"
                  : status.phase === "failed"
                    ? "settings.cloudDesktop.installFailureHelp"
                    : "settings.cloudDesktop.installRecoveryHelp",
              )}
            </p>
          )}
          {status?.connectionSaved && (
            <p className="text-[13px]">
              {t("settings.cloudDesktop.connectionSaved")}
            </p>
          )}
          {!recoverable && !status?.connectionSaved && (
            <div className="space-y-3 text-[13px]">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={trusted}
                  disabled={pending || status?.busy}
                  onChange={(event) => setTrusted(event.target.checked)}
                />
                <span>{t("settings.cloudDesktop.installTrustArtifact")}</span>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={consent}
                  disabled={pending || status?.busy}
                  onChange={(event) => setConsent(event.target.checked)}
                />
                <span>{t("settings.cloudDesktop.installUserConsent")}</span>
              </label>
            </div>
          )}
          {error && (
            <p role="alert" className="text-[13px] text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Dialog.Close asChild>
              <SettingsAction disabled={pending}>
                {t("settings.cloudDesktop.close")}
              </SettingsAction>
            </Dialog.Close>
            {status?.connectionSaved && (
              <SettingsAction
                disabled={pending}
                onClick={() => void execute("showDesktopPassword")}
              >
                {t("settings.cloudDesktop.showDesktopPassword")}
              </SettingsAction>
            )}
            {status?.connectionSaved && recoverable && (
              <SettingsAction
                disabled={pending || status.busy || !running}
                onClick={() =>
                  void execute("resumeInstallation", status.operationId)
                }
              >
                {t("settings.cloudDesktop.installResume")}
              </SettingsAction>
            )}
            {status?.connectionSaved ? (
              <SettingsAction
                disabled={pending || !running}
                onClick={async () => {
                  if (busy.current) return;
                  busy.current = true;
                  setPending(true);
                  setError("");
                  try {
                    await configureCloudDesktopConnection({
                      action: "open",
                      resource,
                    });
                    setOpen(false);
                  } catch (cause) {
                    setError(
                      t(
                        String(cause).includes("ECS_SECURITY_GROUP_DENIED")
                          ? "settings.cloudDesktop.tunnelSecurityGroupDenied"
                          : "settings.cloudDesktop.taskTunnelFailed",
                      ),
                    );
                  } finally {
                    busy.current = false;
                    setPending(false);
                  }
                }}
              >
                {t("settings.cloudDesktop.openCloudWindow")}
              </SettingsAction>
            ) : recoverable ? (
              <SettingsAction
                disabled={pending || status?.busy || !running}
                onClick={() =>
                  void execute("resumeInstallation", status?.operationId)
                }
              >
                {t("settings.cloudDesktop.installResume")}
              </SettingsAction>
            ) : (
              <SettingsAction
                disabled={
                  pending ||
                  !status?.available ||
                  status?.busy ||
                  !running ||
                  !trusted ||
                  !consent
                }
                onClick={() => void execute("installRuntime")}
              >
                {t("settings.cloudDesktop.installChooseArtifact")}
              </SettingsAction>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
