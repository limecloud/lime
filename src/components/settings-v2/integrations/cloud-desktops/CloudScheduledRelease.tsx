import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useTranslation } from "react-i18next";
import type { CloudDesktopResource } from "@limecloud/app-server-client";
import { SettingsAction } from "../../SettingsPrimitives";
import {
  CloudReceipt,
  CloudSelect,
  Field,
  type CloudRequest,
} from "./CloudDesktopPrimitives";
import { object } from "./cloudDesktopData";

export function CloudScheduledRelease({
  resource,
  status,
  postPaid,
  autoReleaseTime,
  operations,
  disabled,
  request,
  onChanged,
}: {
  resource: CloudDesktopResource;
  status: string;
  postPaid: boolean;
  autoReleaseTime?: string;
  operations: Record<string, unknown>[];
  disabled: boolean;
  request: CloudRequest;
  onChanged: () => void;
}) {
  const { t } = useTranslation("settings");
  const [open, setOpen] = useState(false);
  const [dialogAction, setDialogAction] = useState<
    "scheduleEcsRelease" | "cancelEcsRelease"
  >("scheduleEcsRelease");
  const [releaseAt, setReleaseAt] = useState("");
  const [image, setImage] = useState("");
  const [formContext, setFormContext] = useState("");
  const [approvedFor, setApprovedFor] = useState<string | null>(null);
  const [operationId, setOperationId] = useState("");
  const [receipt, setReceipt] = useState<unknown>();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const sameResource = (entry: Record<string, unknown>) => {
    const target = object(entry.resource);
    return (["provider", "regionId", "resourceId", "profile"] as const).every(
      (key) => target[key] === resource[key],
    );
  };
  const unresolved = operations.find(
    (entry) =>
      sameResource(entry) &&
      ["scheduleEcsRelease", "cancelEcsRelease"].includes(
        String(entry.action),
      ) &&
      ["accepted", "unknown", "scheduleChanged"].includes(
        String(entry.outcome),
      ),
  );
  const id =
    operationId ||
    (typeof unresolved?.operationId === "string" ? unresolved.operationId : "");
  const images = operations.filter(
    (entry) =>
      sameResource(entry) &&
      entry.action === "createEcsImage" &&
      entry.outcome === "imageReady",
  );
  const action = open
    ? dialogAction
    : autoReleaseTime
      ? "cancelEcsRelease"
      : "scheduleEcsRelease";
  const cancelling = action === "cancelEcsRelease";
  const currentContext = JSON.stringify([
    resource.provider,
    resource.profile,
    resource.regionId,
    resource.resourceId,
    status,
    postPaid,
    autoReleaseTime ?? null,
  ]);
  const imageAvailable = images.some((entry) => entry.operationId === image);
  const contextChanged =
    formContext !== currentContext ||
    (!cancelling && !!image && !imageAvailable);
  const consentContext = JSON.stringify([
    currentContext,
    action,
    releaseAt,
    image,
    imageAvailable,
    disabled,
  ]);
  const approved = !contextChanged && approvedFor === consentContext;
  const canSubmit = !disabled && approved && (cancelling || imageAvailable);
  // A changed context must invalidate consent even if the old state returns.
  // The scoped value also blocks submission before this effect is flushed.
  useEffect(() => {
    setApprovedFor(null);
  }, [currentContext, imageAvailable, disabled]);
  const completed = [
    "scheduled",
    "released",
    "releaseCancelled",
    "scheduleCancelled",
  ].includes(String(object(receipt).outcome));
  const shownDeadline = id
    ? object(object(receipt).request).releaseAt ||
      unresolved?.releaseAt ||
      releaseAt ||
      autoReleaseTime
    : open
      ? releaseAt
      : autoReleaseTime;
  if (
    resource.provider !== "ecs" ||
    (!cancelling && !id && (status !== "Stopped" || !postPaid))
  )
    return null;

  function begin() {
    const pendingAction =
      object(object(receipt).request).action || unresolved?.action;
    const nextAction =
      id && typeof pendingAction === "string"
        ? pendingAction === "cancelEcsRelease"
          ? "cancelEcsRelease"
          : "scheduleEcsRelease"
        : autoReleaseTime
          ? "cancelEcsRelease"
          : "scheduleEcsRelease";
    setDialogAction(nextAction);
    setFormContext(currentContext);
    setApprovedFor(null);
    setError("");
    setReceipt(undefined);
    // ECS truncates seconds; round up to keep the full half-hour grace period.
    setReleaseAt(
      id
        ? String(
            object(object(receipt).request).releaseAt ||
              unresolved?.releaseAt ||
              releaseAt,
          )
        : nextAction === "cancelEcsRelease"
          ? autoReleaseTime!
          : new Date((Math.floor(Date.now() / 60000) + 32) * 60000)
              .toISOString()
              .replace(".000Z", "Z"),
    );
    setImage("");
    setOpen(true);
  }
  async function run() {
    if (busy.current || (!id && !canSubmit)) return;
    busy.current = true;
    setPending(true);
    setError("");
    const nextId = id || crypto.randomUUID();
    setOperationId(nextId);
    try {
      const time = releaseAt;
      const data = (
        await request(
          id
            ? { action: "readOperation", operationId: nextId }
            : cancelling
              ? {
                  action: "cancelEcsRelease",
                  resource,
                  operationId: nextId,
                  releaseAt: time,
                  confirmation: `cancelEcsRelease:${resource.regionId}:${resource.resourceId}:${time}`,
                }
              : {
                  action: "scheduleEcsRelease",
                  resource,
                  operationId: nextId,
                  imageOperationId: image,
                  releaseAt: time,
                  confirmation: `scheduleEcsRelease:${resource.regionId}:${resource.resourceId}:${time}:discard-data:image:${image}`,
                  workSaved: approved,
                  discardData: approved,
                },
        )
      ).data;
      setReceipt(data);
      if (
        [
          "scheduled",
          "released",
          "releaseCancelled",
          "scheduleCancelled",
          "notSubmitted",
        ].includes(String(object(data).outcome))
      ) {
        setOperationId("");
        setApprovedFor(null);
        if (object(data).outcome === "notSubmitted") {
          setReleaseAt(
            new Date((Math.floor(Date.now() / 60000) + 32) * 60000)
              .toISOString()
              .replace(".000Z", "Z"),
          );
        }
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
      <SettingsAction ref={trigger} disabled={disabled} onClick={begin}>
        {t(`settings.cloudDesktop.${id ? "readReleaseSchedule" : action}`)}
      </SettingsAction>
      <Dialog.Root
        open={open}
        onOpenChange={(value) => {
          if (!pending) setOpen(value);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/30" />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 z-[70] max-h-[85vh] w-[min(480px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 space-y-4 overflow-y-auto rounded-xl border-[0.5px] border-border bg-popover p-6 text-[13px] text-popover-foreground outline-none"
            onEscapeKeyDown={(event) => {
              if (pending) event.preventDefault();
            }}
            onCloseAutoFocus={(event) => {
              if (trigger.current?.isConnected) {
                event.preventDefault();
                trigger.current.focus();
              }
            }}
            onInteractOutside={(event) => {
              if (pending) event.preventDefault();
            }}
          >
            <Dialog.Title className="text-base font-medium">
              {t(`settings.cloudDesktop.${action}`)}
            </Dialog.Title>
            <Dialog.Description className="text-muted-foreground">
              {t("settings.cloudDesktop.changeDescription", { ...resource })}
            </Dialog.Description>
            {typeof shownDeadline === "string" &&
              (!completed || object(receipt).outcome === "scheduled") && (
                <p className="select-text break-all">
                  {t("settings.cloudDesktop.releaseDeadline", {
                    date: new Date(shownDeadline).toLocaleString(),
                  })}
                </p>
              )}
            {!completed && (
              <p className="text-muted-foreground">
                {t(
                  `settings.cloudDesktop.${cancelling ? "cancelReleaseHelp" : "scheduleReleaseHelp"}`,
                )}
              </p>
            )}
            {!completed && !cancelling && (
              <>
                <p className="text-destructive">
                  {t("settings.cloudDesktop.scheduleReleaseWarning")}
                </p>
                <Field name="releaseSystemImage">
                  <CloudSelect
                    value={image}
                    disabled={pending || !!id}
                    onChange={(event) => {
                      setImage(event.target.value);
                      setApprovedFor(null);
                    }}
                  >
                    <option value="">
                      {t("settings.cloudDesktop.chooseReleaseImage")}
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
              </>
            )}
            {!completed && !id && (
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={approved}
                  disabled={pending || disabled || contextChanged}
                  onChange={(event) =>
                    setApprovedFor(event.target.checked ? consentContext : null)
                  }
                />
                {t(
                  `settings.cloudDesktop.${cancelling ? "cancelReleaseConsent" : "scheduleReleaseConsent"}`,
                )}
              </label>
            )}
            {!completed && !id && contextChanged && (
              <p role="alert" className="text-destructive">
                {t("settings.cloudDesktop.releaseConfirmationChanged")}
              </p>
            )}
            {error && (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            )}
            {object(receipt).outcome === "notSubmitted" ? (
              <p role="alert">
                {t("settings.cloudDesktop.schedulePreflightFailed")}
              </p>
            ) : (
              receipt !== undefined && (
                <CloudReceipt
                  data={
                    completed
                      ? { ...object(receipt), diagnostic: undefined }
                      : receipt
                  }
                />
              )
            )}
            {pending && (
              <p role="status">{t("settings.cloudDesktop.working")}</p>
            )}
            <div className="flex justify-end gap-2">
              <Dialog.Close asChild>
                <SettingsAction disabled={pending}>
                  {t("settings.cloudDesktop.close")}
                </SettingsAction>
              </Dialog.Close>
              {!completed && (
                <SettingsAction
                  $tone={!id && !cancelling ? "danger" : undefined}
                  disabled={pending || (!id && !canSubmit)}
                  onClick={() => void run()}
                >
                  {t(
                    `settings.cloudDesktop.${id ? "readOperation" : "confirm"}`,
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
