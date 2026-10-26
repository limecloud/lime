import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useTranslation } from "react-i18next";
import type {
  ComputerUseAdapterStatus,
  ComputerUseTargetIdentity,
  ComputerUseGrantScope,
} from "@limecloud/app-server-client";
import type { AllowedComputerApp } from "@/lib/api/computerUseSettings";
import { SettingsAction } from "../../SettingsPrimitives";

const OVERLAY = "fixed inset-0 z-[70] bg-black/30";
const CONTENT =
  "fixed left-1/2 top-1/2 z-[70] w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-popover p-6 text-popover-foreground shadow-lg outline-none";

export function RemoveAllowedApp({
  app,
  disabled,
  onRemove,
}: {
  app: AllowedComputerApp;
  disabled: boolean;
  onRemove: () => Promise<boolean>;
}) {
  const { t } = useTranslation("settings");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const name =
    app.field === "default" ? t("settings.computerUse.allApps") : app.name;
  async function remove() {
    if (pending) return;
    setPending(true);
    setFailed(false);
    if (await onRemove()) setOpen(false);
    else setFailed(true);
    setPending(false);
  }
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!pending) {
          setOpen(value);
          setFailed(false);
        }
      }}
    >
      <Dialog.Trigger asChild>
        <SettingsAction
          disabled={disabled}
          aria-label={t("settings.computerUse.removeApp", { name })}
        >
          {t("settings.computerUse.remove")}
        </SettingsAction>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={OVERLAY} />
        <Dialog.Content
          className={CONTENT}
          role="alertdialog"
          onEscapeKeyDown={(event) => {
            if (pending) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (pending) event.preventDefault();
          }}
        >
          <Dialog.Title className="text-base font-medium">
            {t("settings.computerUse.removeTitle", { name })}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-[13px] text-muted-foreground">
            {t("settings.computerUse.removeDescription", { name })}
          </Dialog.Description>
          {failed && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {t("settings.computerUse.saveError")}
            </p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close asChild>
              <SettingsAction disabled={pending}>
                {t("settings.computerUse.cancel")}
              </SettingsAction>
            </Dialog.Close>
            <SettingsAction
              $tone="danger"
              disabled={pending}
              aria-busy={pending}
              onClick={() => void remove()}
            >
              {t("settings.computerUse.remove")}
            </SettingsAction>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ComputerUseAdapterDialog({
  title,
  description,
  status,
  pending,
  onRefresh,
  onSetup,
  enabled,
  persistentApprovalAllowed,
}: {
  title: string;
  description: string;
  status: ComputerUseAdapterStatus | undefined;
  pending: boolean;
  onRefresh: () => Promise<void>;
  onSetup: (
    target?: ComputerUseTargetIdentity,
    scope?: ComputerUseGrantScope,
  ) => Promise<boolean>;
  enabled: boolean;
  persistentApprovalAllowed: boolean;
}) {
  const { t } = useTranslation("settings");
  const [failed, setFailed] = useState(false);
  const setup = async (
    target?: ComputerUseTargetIdentity,
    scope: ComputerUseGrantScope = "session",
  ) => {
    setFailed(!(await onSetup(target, scope)));
  };
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <SettingsAction
          aria-label={t("settings.computerUse.manageApp", { name: title })}
        >
          {t("settings.computerUse.manage")}
        </SettingsAction>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={OVERLAY} />
        <Dialog.Content className={CONTENT}>
          <Dialog.Title className="text-base font-medium">{title}</Dialog.Title>
          <Dialog.Description className="mt-2 text-[13px] text-muted-foreground">
            {description}
          </Dialog.Description>
          <p role="status" className="mt-4 text-[13px]">
            {t(
              `settings.computerUse.status.${status?.readiness ?? "unavailable"}`,
            )}
          </p>
          {status?.adapter !== "native" && (
            <p className="mt-3 text-[13px] text-muted-foreground">
              {t(
                `settings.computerUse.${status?.adapter === "chrome" ? "chromeInstall" : "officeInstall"}`,
              )}
            </p>
          )}
          {failed && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {t("settings.computerUse.setupError")}
            </p>
          )}
          <div className="mt-3 max-h-60 space-y-2 overflow-y-auto">
            {status?.targets?.map((target) => {
              const label =
                target.type === "chrome"
                  ? target.url || target.origin
                  : target.type === "office"
                    ? target.workbookName || target.workbookId
                    : target.title || target.appId;
              return (
                <div
                  key={JSON.stringify(target)}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-[13px]"
                >
                  <span className="min-w-0 break-all">{label}</span>
                  <div className="flex shrink-0 flex-wrap justify-end gap-2">
                    <SettingsAction
                      disabled={pending || !enabled}
                      onClick={() => void setup(target)}
                    >
                      {t("settings.computerUse.approveTarget")}
                    </SettingsAction>
                    {persistentApprovalAllowed &&
                      (target.type === "native" ||
                        (target.type === "office" &&
                          target.host === "WPS")) && (
                        <SettingsAction
                          disabled={pending || !enabled}
                          onClick={() => void setup(target, "persistent")}
                        >
                          {t("settings.computerUse.approveAlways")}
                        </SettingsAction>
                      )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            {status?.adapter !== "native" && (
              <SettingsAction
                disabled={pending || !enabled}
                onClick={() => void setup()}
              >
                {t(
                  `settings.computerUse.${status?.adapter === "office" ? "openOffice" : "installConnection"}`,
                )}
              </SettingsAction>
            )}
            <SettingsAction disabled={pending} onClick={() => void onRefresh()}>
              {t("settings.computerUse.refresh")}
            </SettingsAction>
            <Dialog.Close asChild>
              <SettingsAction>{t("settings.computerUse.close")}</SettingsAction>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
