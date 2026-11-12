import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Cloud, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CloudDesktopResource } from "@limecloud/app-server-client";
import { configureCloudDesktopConnection } from "@/lib/api/cloudDesktopConnection";
import { useAppNavigationRequest } from "@/contexts/AppNavigationContext";
import { SettingsTabs } from "@/types/settings";
import { SettingsAction } from "@/components/settings-v2/SettingsPrimitives";
import { AddCloudDesktop } from "@/components/settings-v2/integrations/cloud-desktops/AddCloudDesktop";
import { CloudRuntimeInstallation } from "@/components/settings-v2/integrations/cloud-desktops/CloudRuntimeInstallation";
import { CloudTaskConnection } from "@/components/settings-v2/integrations/cloud-desktops/CloudTaskConnection";
import { CloudResourceActions } from "@/components/settings-v2/integrations/cloud-desktops/CloudResourceActions";
import { requestCloudDesktop } from "@/lib/api/cloud";
import {
  useCloudDesktopSetup,
  sameCloudResource,
  type CloudSetupComputer,
} from "./useCloudDesktopSetup";

export default function CloudDesktopSetupDialog({
  onClose,
  onReturnFocus,
}: {
  onClose: () => void;
  onReturnFocus?: () => void;
}) {
  const { t } = useTranslation("settings");
  const navigate = useAppNavigationRequest();
  const [provisioned, setProvisioned] = useState<CloudDesktopResource>();
  const { computers, loading, failed, refresh } =
    useCloudDesktopSetup(provisioned);
  const visibleComputers = provisioned
    ? computers.filter((computer) =>
        sameCloudResource(computer.resource, provisioned),
      )
    : computers;
  const [opening, setOpening] = useState<string>();
  const [openFailed, setOpenFailed] = useState(false);
  const busy = useRef(false);
  const active = useRef(true);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (provisioned) heading.current?.focus();
  }, [provisioned]);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function connect(computer: CloudSetupComputer) {
    if (busy.current || computer.releasePending) return;
    busy.current = true;
    setOpening(computer.resource.resourceId);
    setOpenFailed(false);
    try {
      await configureCloudDesktopConnection({
        action: "open",
        resource: computer.resource,
      });
      if (active.current) onClose();
    } catch {
      if (active.current) setOpenFailed(true);
    } finally {
      busy.current = false;
      if (active.current) setOpening(undefined);
    }
  }
  function close() {
    if (busy.current) return;
    active.current = false;
    onClose();
  }
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/30" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[70] max-h-[85vh] w-[min(560px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 space-y-5 overflow-y-auto rounded-xl border-[0.5px] border-border bg-popover p-6 text-popover-foreground outline-none"
          data-testid="cloud-desktop-setup"
          onCloseAutoFocus={(event) => {
            if (onReturnFocus) {
              event.preventDefault();
              onReturnFocus();
            }
          }}
          onEscapeKeyDown={(event) => {
            if (opening) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (opening) event.preventDefault();
          }}
        >
          <Dialog.Title className="flex items-center gap-2 text-[16px] font-medium">
            <Cloud aria-hidden className="size-4" />
            {t("settings.cloudDesktop.setupTitle")}
          </Dialog.Title>
          <Dialog.Description className="text-[13px] text-muted-foreground">
            {t("settings.cloudDesktop.setupDescription")}
          </Dialog.Description>
          <div className="space-y-2 text-[13px] text-muted-foreground">
            <p>{t("settings.cloudDesktop.installTimeExpectation")}</p>
            <p>{t("settings.cloudDesktop.setupCost")}</p>
          </div>
          <section
            className="space-y-3"
            aria-label={t("settings.cloudDesktop.computers")}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2
                ref={heading}
                tabIndex={-1}
                className="text-[13px] font-medium outline-none"
              >
                {t(
                  `settings.cloudDesktop.${provisioned ? "setupPurchasedComputer" : "setupChooseComputer"}`,
                )}
              </h2>
              <SettingsAction
                disabled={loading || !!opening}
                onClick={() => void refresh()}
              >
                {t("settings.cloudDesktop.refresh")}
              </SettingsAction>
            </div>
            {provisioned && (
              <p role="status" className="text-[13px] text-muted-foreground">
                {t("settings.cloudDesktop.setupPurchasedHelp")}
              </p>
            )}
            {loading && (
              <p
                role="status"
                className="flex items-center gap-2 text-[13px] text-muted-foreground"
              >
                <Loader2 aria-hidden className="size-3.5 animate-spin" />
                {t("settings.cloudDesktop.loading")}
              </p>
            )}
            {failed && (
              <p role="alert" className="text-[13px] text-destructive">
                {t("settings.cloudDesktop.setupReadFailed")}
              </p>
            )}
            {!loading &&
              !failed &&
              visibleComputers.length === 0 &&
              !provisioned && (
                <p className="text-[13px] text-muted-foreground">
                  {t("settings.cloudDesktop.setupEmpty")}
                </p>
              )}
            <ul className="divide-y divide-border">
              {visibleComputers.map((computer) => (
                <li
                  key={JSON.stringify(computer.resource)}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0 flex-1 space-y-1 text-[13px]">
                    <p className="break-words font-medium">
                      {computer.name ||
                        t("settings.cloudDesktop.unnamedDesktop")}
                    </p>
                    <p className="text-muted-foreground">
                      {computer.resource.regionId} /{" "}
                      {t(
                        `settings.cloudDesktop.status.${computer.status ?? "unknown"}`,
                        {
                          defaultValue: t(
                            "settings.cloudDesktop.status.unknown",
                          ),
                        },
                      )}
                    </p>
                    <p
                      className={`text-[12px] ${computer.inspectionFailed ? "text-destructive" : "text-muted-foreground"}`}
                    >
                      {t(
                        `settings.cloudDesktop.${computer.inspectionFailed ? "setupReadFailed" : computer.releasePending ? "cancelBeforeUse" : computer.starting || ["Starting", "Pending"].includes(computer.status ?? "") ? "setupStarting" : computer.status === "Stopped" ? "setupStopped" : computer.connectionSaved ? "setupConnectionSaved" : computer.resource.provider === "ecs" ? "setupInstallationRequired" : "setupConnectionRequired"}`,
                      )}
                    </p>
                    {computer.releaseAt && (
                      <p className="text-destructive">
                        {t("settings.cloudDesktop.releaseDeadline", {
                          date: new Date(computer.releaseAt).toLocaleString(),
                        })}
                      </p>
                    )}
                  </div>
                  {!computer.inspectionFailed && !computer.releasePending && (
                    <CloudResourceActions
                      resource={computer.resource}
                      status={
                        computer.starting
                          ? "Starting"
                          : (computer.status ?? "unknown")
                      }
                      disabled={!!opening}
                      only="start"
                      request={requestCloudDesktop}
                      onChanged={() => void refresh()}
                    />
                  )}
                  {!computer.inspectionFailed &&
                    !computer.releasePending &&
                    computer.status === "Running" &&
                    (computer.connectionSaved ? (
                      <SettingsAction
                        disabled={!!opening}
                        onClick={() => void connect(computer)}
                      >
                        {t(
                          `settings.cloudDesktop.${opening === computer.resource.resourceId ? "connectingRemote" : "openCloudWindow"}`,
                        )}
                      </SettingsAction>
                    ) : computer.resource.provider === "ecs" ? (
                      <div className="flex flex-wrap justify-end gap-2">
                        <CloudRuntimeInstallation
                          resource={computer.resource}
                          running
                        />
                        <CloudTaskConnection
                          resource={computer.resource}
                          running
                        />
                      </div>
                    ) : (
                      <CloudTaskConnection
                        resource={computer.resource}
                        running
                      />
                    ))}
                </li>
              ))}
            </ul>
            {provisioned ? (
              <SettingsAction
                disabled={!!opening}
                onClick={() => setProvisioned(undefined)}
              >
                {t("settings.cloudDesktop.setupOtherComputer")}
              </SettingsAction>
            ) : (
              <AddCloudDesktop
                defaultTab="purchase"
                disabled={!!opening}
                onChanged={() => void refresh()}
                onProvisioned={(resource) => {
                  if (active.current) setProvisioned(resource);
                }}
              />
            )}
          </section>
          {openFailed && (
            <p role="alert" className="text-[13px] text-destructive">
              {t("settings.cloudDesktop.setupConnectFailed")}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            {navigate && (
              <SettingsAction
                disabled={!!opening}
                onClick={() => {
                  navigate("settings", { tab: SettingsTabs.CloudDesktops });
                  close();
                }}
              >
                {t("settings.cloudDesktop.setupManage")}
              </SettingsAction>
            )}
            <SettingsAction disabled={!!opening} onClick={close}>
              {t("settings.cloudDesktop.setupReturnLocal")}
            </SettingsAction>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
