import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useTranslation } from "react-i18next";
import type { CloudDesktopResource } from "@limecloud/app-server-client";
import { configureCloudDesktopConnection } from "@/lib/api/cloudDesktopConnection";
import { isElectronHostCommandAvailable } from "@/lib/electron-host";
import type { CloudReleaseBackup } from "@/lib/desktop-host/cloudDesktopConnection";
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
  operations = [],
  only,
  request,
  onChanged,
}: {
  resource: CloudDesktopResource;
  status: string;
  disabled: boolean;
  canRelease?: boolean;
  operations?: readonly Record<string, unknown>[];
  only?: "start";
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
  const [applicationsValidated, setApplicationsValidated] = useState(false);
  const [releaseBackup, setReleaseBackup] = useState<CloudReleaseBackup | null>(
    null,
  );
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupLookupFailed, setBackupLookupFailed] = useState(false);
  const [discardWithoutBackup, setDiscardWithoutBackup] = useState(false);
  const [imageOperationId, setImageOperationId] = useState("");
  const [imageApproved, setImageApproved] = useState(false);
  const [diskId, setDiskId] = useState("system");
  const [operationId, setOperationId] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<unknown>();
  const busy = useRef(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const backupAvailable = isElectronHostCommandAvailable(
    "cloud_desktop_connection",
  );
  const verifiedBackup =
    !imageOperationId && !discardWithoutBackup && releaseBackup?.restoredTo
      ? {
          sha256: releaseBackup.sha256,
          savedAt: releaseBackup.savedAt,
          restoredTo: releaseBackup.restoredTo,
        }
      : null;
  const images = operations.filter(
    (entry) =>
      resource.provider === "ecs" &&
      entry.action === "createEcsImage" &&
      entry.outcome === "imageReady" &&
      typeof entry.operationId === "string" &&
      (["provider", "profile", "regionId", "resourceId"] as const).every(
        (key) => object(entry.resource)[key] === resource[key],
      ),
  );
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

  useEffect(() => {
    if (
      !isOpen ||
      action !== "release" ||
      !backupAvailable ||
      submitted ||
      imageOperationId
    )
      return;
    let current = true;
    void configureCloudDesktopConnection({
      action: "readReleaseBackup",
      resource,
    })
      .then((result) => {
        if (!("kind" in result) || result.kind !== "releaseBackup")
          throw new Error("CLOUD_RELEASE_BACKUP_INVALID");
        if (current) setReleaseBackup(result.backup);
      })
      .catch(() => {
        if (current) setBackupLookupFailed(true);
      })
      .finally(() => {
        if (current) setBackupLoading(false);
      });
    return () => {
      current = false;
    };
  }, [action, backupAvailable, isOpen, resource, submitted, imageOperationId]);

  function open(value: typeof action, button: HTMLButtonElement) {
    trigger.current = button;
    setIsOpen(true);
    if (unresolved) return;
    setAction(value);
    setConfirmed("");
    setSaved(false);
    setDiscardData(false);
    setApplicationsValidated(false);
    setReleaseBackup(null);
    setBackupLookupFailed(false);
    setDiscardWithoutBackup(false);
    const image =
      value === "release" ? String(images[0]?.operationId ?? "") : "";
    setImageOperationId(image);
    setImageApproved(false);
    setBackupLoading(value === "release" && backupAvailable && !image);
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
      const confirmation = `${action}:${resource.regionId}:${resource.resourceId}${action === "snapshot" ? `:${diskId}` : action === "release" ? `:discard-data${imageOperationId ? `:image:${imageOperationId}` : ""}` : ""}`;
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
                    ...(imageOperationId ? { imageOperationId } : {}),
                  }
                : {
                    action,
                    resource,
                    operationId,
                    confirmation,
                    diskId,
                    workSaved: saved,
                  };
      let data;
      if (!read && action === "release" && verifiedBackup) {
        const result = await configureCloudDesktopConnection({
          action: "releaseWithBackup",
          resource,
          operationId,
          confirmation,
          archiveSha256: verifiedBackup.sha256,
          restoredTo: verifiedBackup.restoredTo,
          workSaved: saved,
          discardData,
          applicationsValidated,
        });
        if (!("kind" in result) || result.kind !== "releaseWithBackup")
          throw new Error(t("settings.cloudDesktop.invalidResponse"));
        if (
          object(result.data).outcome === "notSubmitted" &&
          object(result.data).submitted === false
        ) {
          setSubmitted(false);
          setApplicationsValidated(false);
          setDiscardData(false);
          setOperationId(crypto.randomUUID());
          setError(t("settings.cloudDesktop.releaseBackupRejected"));
          return;
        }
        data = result.data;
      } else {
        data = (await request(params)).data;
      }
      if (
        action === "release" &&
        imageOperationId &&
        object(data).operationId === operationId &&
        object(data).outcome === "notSubmitted" &&
        object(data).submitted === false &&
        object(data).requiresInspection === false
      ) {
        setSubmitted(false);
        setDiscardData(false);
        setImageApproved(false);
        setOperationId(crypto.randomUUID());
        setError(t("settings.cloudDesktop.releaseSystemImageRejected"));
        return;
      }
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
          {!only && status === "Running" && resource.provider === "ecs" && (
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
          {!only && status === "Running" && (
            <SettingsAction
              disabled={disabled || status !== "Running"}
              onClick={(event) => open("stop", event.currentTarget)}
            >
              {t("settings.cloudDesktop.stop")}
            </SettingsAction>
          )}
          {!only && status === "Stopped" && (
            <SettingsAction
              disabled={disabled || status !== "Stopped"}
              onClick={(event) => open("snapshot", event.currentTarget)}
            >
              {t("settings.cloudDesktop.snapshot")}
            </SettingsAction>
          )}
          {!only && status === "Stopped" && canRelease && (
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
            {action === "release" && images.length > 0 && (
              <Field name="releaseSystemImage">
                <CloudSelect
                  value={imageOperationId}
                  disabled={submitted}
                  onChange={(event) => {
                    setImageOperationId(event.target.value);
                    setImageApproved(false);
                    setDiscardData(false);
                    setApplicationsValidated(false);
                    setReleaseBackup(null);
                    setBackupLookupFailed(false);
                    setBackupLoading(backupAvailable && !event.target.value);
                  }}
                >
                  <option value="">
                    {t("settings.cloudDesktop.releaseWithoutSystemImage")}
                  </option>
                  {images.map((entry) => (
                    <option
                      key={String(entry.operationId)}
                      value={String(entry.operationId)}
                    >
                      {String(entry.operationId)}
                    </option>
                  ))}
                </CloudSelect>
              </Field>
            )}
            {action === "release" && imageOperationId && (
              <div className="space-y-2 text-[13px]">
                <p>{t("settings.cloudDesktop.releaseSystemImageHelp")}</p>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={imageApproved}
                    disabled={submitted}
                    onChange={(event) => setImageApproved(event.target.checked)}
                  />
                  {t("settings.cloudDesktop.releaseSystemImageConsent")}
                </label>
              </div>
            )}
            {action === "release" && backupAvailable && !imageOperationId && (
              <div className="space-y-2 text-[13px]">
                {backupLoading ? (
                  <p role="status">{t("settings.cloudDesktop.loading")}</p>
                ) : backupLookupFailed ? (
                  <p role="alert">
                    {t("settings.cloudDesktop.releaseBackupLookupFailed")}
                  </p>
                ) : verifiedBackup ? (
                  <p className="break-all">
                    {t("settings.cloudDesktop.releaseBackupTarget", {
                      target: verifiedBackup.restoredTo.resourceId,
                      date: new Date(verifiedBackup.savedAt).toLocaleString(),
                    })}
                  </p>
                ) : (
                  <p>{t("settings.cloudDesktop.releaseBackupMissing")}</p>
                )}
                {releaseBackup?.restoredTo && !submitted && (
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={discardWithoutBackup}
                      onChange={(event) => {
                        setDiscardWithoutBackup(event.target.checked);
                        setDiscardData(false);
                        setApplicationsValidated(false);
                      }}
                    />
                    {t("settings.cloudDesktop.releaseBackupSkip")}
                  </label>
                )}
              </div>
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
            {action === "release" && verifiedBackup && (
              <label className="flex items-start gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={applicationsValidated}
                  disabled={submitted}
                  onChange={(event) =>
                    setApplicationsValidated(event.target.checked)
                  }
                />
                {t("settings.cloudDesktop.releaseBackupApplicationConsent")}
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
                    (action === "release" &&
                      (!discardData ||
                        backupLoading ||
                        (!!imageOperationId && !imageApproved) ||
                        (!!verifiedBackup && !applicationsValidated))) ||
                    (action === "snapshot" && !diskId)
                  }
                  onClick={() => void execute()}
                >
                  {t(
                    action === "release" && imageOperationId
                      ? "settings.cloudDesktop.releaseSystemImageConfirm"
                      : action === "release" && verifiedBackup
                        ? "settings.cloudDesktop.releaseBackupConfirm"
                        : "settings.cloudDesktop.confirm",
                  )}
                </SettingsAction>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
