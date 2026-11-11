import { useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useTranslation } from "react-i18next";
import type { CloudDesktopResource } from "@limecloud/app-server-client";
import { SettingsAction } from "../../SettingsPrimitives";
import {
  CloudReceipt,
  CloudSelect,
  Field,
  inputClass,
  type CloudRequest,
} from "./CloudDesktopPrimitives";
import { object } from "./cloudDesktopData";

export function CloudResourceActions({
  resource,
  status,
  disabled,
  canRelease = false,
  request,
  onChanged,
}: {
  resource: CloudDesktopResource;
  status: string;
  disabled: boolean;
  canRelease?: boolean;
  request: CloudRequest;
  onChanged: () => void;
}) {
  const { t } = useTranslation("settings");
  const [action, setAction] = useState<
    "start" | "stop" | "snapshot" | "release" | "prepareEcsDesktop" | null
  >(null);
  const [isOpen, setIsOpen] = useState(false);
  const [confirmed, setConfirmed] = useState("");
  const [saved, setSaved] = useState(false);
  const [discardData, setDiscardData] = useState(false);
  const [diskId, setDiskId] = useState("system");
  const [operationId, setOperationId] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<unknown>();
  const busy = useRef(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const accepted = object(receipt).outcome === "accepted";
  const unresolved =
    submitted &&
    object(receipt).outcome !== "released" &&
    !(
      accepted &&
      ((action === "stop" && status === "Stopped") ||
        (action === "start" && status === "Running"))
    ) &&
    ![
      "snapshotReady",
      "dependenciesReady",
      "preparationFailed",
      "notSubmitted",
    ].includes(String(object(receipt).outcome));

  function open(value: typeof action, button: HTMLButtonElement) {
    trigger.current = button;
    setIsOpen(true);
    if (unresolved) return;
    setAction(value);
    setConfirmed("");
    setSaved(false);
    setDiscardData(false);
    setSubmitted(false);
    setError("");
    setReceipt(undefined);
    setOperationId(crypto.randomUUID());
    setDiskId(resource.provider === "wuying" ? "system" : "");
  }
  async function execute(read = false) {
    if (!action || busy.current || (!read && submitted)) return;
    busy.current = true;
    setPending(true);
    setError("");
    if (!read) setSubmitted(true);
    try {
      const confirmation = `${action}:${resource.regionId}:${resource.resourceId}${action === "snapshot" ? `:${diskId}` : action === "release" ? ":discard-data" : ""}`;
      const params = read
        ? { action: "readOperation" as const, operationId }
        : action === "prepareEcsDesktop"
          ? {
              action,
              resource,
              operationId,
              confirmation,
              installSystemPackages: saved,
            }
          : action === "start"
            ? { action, resource, operationId, confirmation }
            : action === "stop"
              ? {
                  action,
                  resource,
                  operationId,
                  confirmation,
                  workSaved: saved,
                }
              : action === "release"
                ? {
                    action,
                    resource,
                    operationId,
                    confirmation,
                    workSaved: saved,
                    discardData,
                  }
                : {
                    action,
                    resource,
                    operationId,
                    confirmation,
                    diskId,
                    workSaved: saved,
                  };
      const data = (await request(params)).data;
      setReceipt(data);
      if (
        action === "prepareEcsDesktop" &&
        object(data).outcome === "notSubmitted" &&
        object(data).submitted === false
      ) {
        setSubmitted(false);
        setOperationId(crypto.randomUUID());
      }
      onChanged();
    } catch (cause) {
      setError(String(cause));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <>
      {unresolved ? (
        <SettingsAction
          ref={(node) => {
            if (node) trigger.current = node;
          }}
          disabled={disabled}
          onClick={(event) => {
            trigger.current = event.currentTarget;
            setIsOpen(true);
          }}
        >
          {t("settings.cloudDesktop.readOperation")}
        </SettingsAction>
      ) : (
        <>
          {status === "Running" && resource.provider === "ecs" && (
            <SettingsAction
              disabled={disabled}
              onClick={(event) =>
                open("prepareEcsDesktop", event.currentTarget)
              }
            >
              {t("settings.cloudDesktop.prepareEcsDesktop")}
            </SettingsAction>
          )}
          {status === "Stopped" && (
            <SettingsAction
              disabled={disabled || status !== "Stopped"}
              onClick={(event) => open("start", event.currentTarget)}
            >
              {t("settings.cloudDesktop.start")}
            </SettingsAction>
          )}
          {status === "Running" && (
            <SettingsAction
              disabled={disabled || status !== "Running"}
              onClick={(event) => open("stop", event.currentTarget)}
            >
              {t("settings.cloudDesktop.stop")}
            </SettingsAction>
          )}
          {status === "Stopped" && (
            <SettingsAction
              disabled={disabled || status !== "Stopped"}
              onClick={(event) => open("snapshot", event.currentTarget)}
            >
              {t("settings.cloudDesktop.snapshot")}
            </SettingsAction>
          )}
          {status === "Stopped" && canRelease && (
            <SettingsAction
              $tone="danger"
              disabled={disabled}
              onClick={(event) => open("release", event.currentTarget)}
            >
              {t("settings.cloudDesktop.release")}
            </SettingsAction>
          )}
        </>
      )}
      <Dialog.Root
        open={isOpen}
        onOpenChange={(value) => {
          if (!pending) setIsOpen(value);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/30" />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 z-[70] max-h-[85vh] w-[min(480px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 space-y-4 overflow-y-auto rounded-xl border-[0.5px] border-border bg-popover p-6 text-popover-foreground outline-none"
            onEscapeKeyDown={(e) => {
              if (pending) e.preventDefault();
            }}
            onInteractOutside={(e) => {
              if (pending) e.preventDefault();
            }}
            onCloseAutoFocus={(event) => {
              if (trigger.current?.isConnected) {
                event.preventDefault();
                trigger.current.focus();
              }
            }}
          >
            <Dialog.Title className="text-base font-medium">
              {t(`settings.cloudDesktop.${action ?? "start"}`)}
            </Dialog.Title>
            <Dialog.Description className="text-[13px] text-muted-foreground">
              {t("settings.cloudDesktop.changeDescription", { ...resource })}
            </Dialog.Description>
            {action === "prepareEcsDesktop" && (
              <p className="text-[13px] text-muted-foreground">
                {t("settings.cloudDesktop.prepareDescription")}
              </p>
            )}
            {action === "stop" && (
              <p className="text-[13px]">
                {t("settings.cloudDesktop.stopCost")}
              </p>
            )}
            {action === "release" && (
              <p className="text-[13px] text-destructive">
                {t(
                  `settings.cloudDesktop.${resource.provider === "ecs" ? "ecsReleaseWarning" : "releaseWarning"}`,
                )}
              </p>
            )}
            {action === "snapshot" && (
              <>
                <p className="text-[13px]">
                  {t("settings.cloudDesktop.snapshotPrivacy")}
                </p>
                <Field name="diskId">
                  {resource.provider === "wuying" ? (
                    <CloudSelect
                      value={diskId}
                      disabled={submitted}
                      onChange={(e) => setDiskId(e.target.value)}
                    >
                      <option value="system">
                        {t("settings.cloudDesktop.systemDisk")}
                      </option>
                      <option value="data">
                        {t("settings.cloudDesktop.dataDisk")}
                      </option>
                    </CloudSelect>
                  ) : (
                    <input
                      className={inputClass}
                      value={diskId}
                      disabled={submitted}
                      onChange={(e) => setDiskId(e.target.value)}
                    />
                  )}
                </Field>
              </>
            )}
            {action !== "prepareEcsDesktop" && (
              <Field name="confirmResource">
                <input
                  className={inputClass}
                  value={confirmed}
                  placeholder={resource.resourceId}
                  disabled={submitted}
                  onChange={(e) => setConfirmed(e.target.value)}
                />
              </Field>
            )}
            {action !== "start" && (
              <label className="flex items-start gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={saved}
                  disabled={submitted}
                  onChange={(e) => setSaved(e.target.checked)}
                />
                {t(
                  `settings.cloudDesktop.${action === "prepareEcsDesktop" ? "prepareConsent" : "workSaved"}`,
                )}
              </label>
            )}
            {action === "release" && (
              <label className="flex items-start gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={discardData}
                  disabled={submitted}
                  onChange={(e) => setDiscardData(e.target.checked)}
                />
                {t("settings.cloudDesktop.discardData")}
              </label>
            )}
            {submitted && (
              <p className="break-all text-[13px]">
                {t("settings.cloudDesktop.operationId")}: {operationId}
              </p>
            )}
            {error && (
              <p role="alert" className="text-[13px] text-destructive">
                {error}
              </p>
            )}
            {receipt !== undefined && <CloudReceipt data={receipt} />}
            {pending && (
              <p role="status" className="text-[13px] text-muted-foreground">
                {t("settings.cloudDesktop.working")}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Dialog.Close asChild>
                <SettingsAction disabled={pending}>
                  {t("settings.cloudDesktop.close")}
                </SettingsAction>
              </Dialog.Close>
              {submitted ? (
                <SettingsAction
                  disabled={pending}
                  onClick={() => void execute(true)}
                >
                  {t("settings.cloudDesktop.readOperation")}
                </SettingsAction>
              ) : (
                <SettingsAction
                  $tone={action === "release" ? "danger" : undefined}
                  disabled={
                    pending ||
                    (action !== "prepareEcsDesktop" &&
                      confirmed !== resource.resourceId) ||
                    (action !== "start" && !saved) ||
                    (action === "release" && !discardData) ||
                    (action === "snapshot" && !diskId)
                  }
                  onClick={() => void execute()}
                >
                  {t("settings.cloudDesktop.confirm")}
                </SettingsAction>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
