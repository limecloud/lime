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
  object,
  type CloudRequest,
} from "./CloudDesktopPrimitives";

export function CloudRestoreVerification({
  receipt,
  request,
  onChanged,
  onVerified,
}: {
  receipt: unknown;
  request: CloudRequest;
  onChanged: () => void;
  onVerified: (receipt: unknown) => void;
}) {
  const { t } = useTranslation("settings");
  const data = object(receipt);
  const original = object(data.request);
  const resource = object(original.resource);
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  if (original.action !== "restoreSnapshot" || data.outcome === "verified")
    return null;
  async function verify() {
    if (!checked || busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      const result = object(
        (
          await request({
            action: "verifySnapshotRestore",
            operationId: String(data.operationId),
            confirmation: `verifyRestore:${resource.regionId}:${resource.resourceId}:${original.diskId}:${original.snapshotId}`,
            applicationsValidated: checked,
          })
        ).data,
      );
      if (result.outcome !== "verified")
        throw new Error(t("settings.cloudDesktop.invalidResponse"));
      onVerified(result);
      onChanged();
    } catch (cause) {
      setError(String(cause));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <div className="space-y-3 text-[13px]">
      <p>{t("settings.cloudDesktop.snapshotValidationHelp")}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 break-all">
        {(["resourceId", "diskId", "snapshotId"] as const).map((key) => (
          <div key={key} className="contents">
            <dt className="text-muted-foreground">
              {t(`settings.cloudDesktop.${key}`)}
            </dt>
            <dd className="select-text">
              {String(key === "resourceId" ? resource[key] : original[key])}
            </dd>
          </div>
        ))}
      </dl>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={checked}
          disabled={pending}
          onChange={(event) => setChecked(event.target.checked)}
        />
        {t("settings.cloudDesktop.snapshotApplicationsChecked")}
      </label>
      <SettingsAction
        disabled={!checked || pending}
        onClick={() => void verify()}
      >
        {t("settings.cloudDesktop.verifySnapshotRestore")}
      </SettingsAction>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function CloudSnapshotRestore({
  resource,
  status,
  disabled,
  request,
  onChanged,
}: {
  resource: CloudDesktopResource;
  status: string;
  disabled: boolean;
  request: CloudRequest;
  onChanged: () => void;
}) {
  const { t } = useTranslation("settings");
  const [open, setOpen] = useState(false);
  const [diskId, setDiskId] = useState(
    resource.provider === "wuying" ? "system" : "",
  );
  const [snapshotId, setSnapshotId] = useState("");
  const [confirmed, setConfirmed] = useState("");
  const [saved, setSaved] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [source, setSource] = useState<unknown>();
  const [receipt, setReceipt] = useState<unknown>();
  const [operationId, setOperationId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const submitted = operationId !== "";
  const ready = object(source).ready === true;
  const createdAt = object(source).createdAt;
  const encrypted = object(source).encrypted;
  function changeTarget(setValue: (value: string) => void, value: string) {
    setValue(value);
    setSource(undefined);
    setSaved(false);
    setDiscard(false);
    setConfirmed("");
    setError("");
  }
  async function execute(
    action: "inspectSnapshot" | "restoreSnapshot" | "readOperation",
  ) {
    if (busy.current || (submitted && action !== "readOperation")) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      if (action === "inspectSnapshot") {
        setSource(undefined);
        setSource(
          (await request({ action, resource, diskId, snapshotId })).data,
        );
      } else if (action === "readOperation") {
        setReceipt((await request({ action, operationId })).data);
      } else {
        const id = crypto.randomUUID();
        setOperationId(id);
        setReceipt(
          (
            await request({
              action,
              resource,
              diskId,
              snapshotId,
              operationId: id,
              confirmation: `restoreSnapshot:${resource.regionId}:${resource.resourceId}:${diskId}:${snapshotId}`,
              workSaved: saved,
              discardChanges: discard,
            })
          ).data,
        );
        onChanged();
      }
    } catch (cause) {
      setError(String(cause));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (pending) return;
        if (value && object(receipt).outcome === "verified") {
          setOperationId("");
          setReceipt(undefined);
          setSource(undefined);
          setConfirmed("");
          setSaved(false);
          setDiscard(false);
          setError("");
        }
        setOpen(value);
      }}
    >
      <Dialog.Trigger asChild>
        <SettingsAction disabled={disabled}>
          {t("settings.cloudDesktop.restoreSnapshot")}
        </SettingsAction>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/30" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[70] max-h-[85vh] w-[min(480px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 space-y-4 overflow-y-auto rounded-xl border-[0.5px] border-border bg-popover p-6 text-popover-foreground outline-none"
          onEscapeKeyDown={(event) => {
            if (pending) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (pending) event.preventDefault();
          }}
        >
          <Dialog.Title className="text-base font-medium">
            {t("settings.cloudDesktop.restoreSnapshot")}
          </Dialog.Title>
          <Dialog.Description className="text-[13px] text-muted-foreground">
            {t("settings.cloudDesktop.changeDescription", { ...resource })}
          </Dialog.Description>
          <p className="text-[13px] text-destructive">
            {t("settings.cloudDesktop.snapshotRestoreWarning")}
          </p>
          <Field name="diskId">
            {resource.provider === "wuying" ? (
              <CloudSelect
                value={diskId}
                disabled={submitted || pending}
                onChange={(e) => changeTarget(setDiskId, e.target.value)}
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
                disabled={submitted || pending}
                onChange={(e) => changeTarget(setDiskId, e.target.value)}
              />
            )}
          </Field>
          <Field name="snapshotId">
            <input
              className={inputClass}
              value={snapshotId}
              disabled={submitted || pending}
              onChange={(e) => changeTarget(setSnapshotId, e.target.value)}
            />
          </Field>
          {!submitted && (
            <>
              <SettingsAction
                disabled={pending || !diskId || !snapshotId}
                onClick={() => void execute("inspectSnapshot")}
              >
                {t("settings.cloudDesktop.inspectSnapshot")}
              </SettingsAction>
              {source !== undefined && (
                <div role="status" className="space-y-1 text-[13px]">
                  <p>
                    {t(
                      `settings.cloudDesktop.${ready ? "snapshotAvailable" : "snapshotUnavailable"}`,
                    )}
                  </p>
                  <p>
                    {t("settings.cloudDesktop.snapshotEncryption")}:{" "}
                    {t(
                      `settings.cloudDesktop.${encrypted === true ? "snapshotEncrypted" : encrypted === false ? "snapshotUnencrypted" : "snapshotEncryptionUnknown"}`,
                    )}
                  </p>
                  {typeof createdAt === "string" &&
                    Number.isFinite(Date.parse(createdAt)) && (
                      <p>
                        {t("settings.cloudDesktop.snapshotCreatedAt")}:{" "}
                        <time dateTime={createdAt}>
                          {new Date(createdAt).toLocaleString()}
                        </time>
                      </p>
                    )}
                </div>
              )}
              {status !== "Stopped" && (
                <p className="text-[13px]">
                  {t("settings.cloudDesktop.snapshotStopFirst")}
                </p>
              )}
              <Field name="confirmResource">
                <input
                  className={inputClass}
                  value={confirmed}
                  disabled={pending}
                  placeholder={resource.resourceId}
                  onChange={(e) => setConfirmed(e.target.value)}
                />
              </Field>
              <label className="flex items-start gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={saved}
                  disabled={pending}
                  onChange={(e) => setSaved(e.target.checked)}
                />
                {t("settings.cloudDesktop.workSaved")}
              </label>
              <label className="flex items-start gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={discard}
                  disabled={pending}
                  onChange={(e) => setDiscard(e.target.checked)}
                />
                {t("settings.cloudDesktop.discardSnapshotChanges")}
              </label>
            </>
          )}
          {submitted && (
            <p className="break-all text-[13px]">
              {t("settings.cloudDesktop.operationId")}: {operationId}
            </p>
          )}
          {receipt !== undefined && (
            <>
              <CloudReceipt data={receipt} />
              <CloudRestoreVerification
                key={operationId}
                receipt={receipt}
                request={request}
                onChanged={onChanged}
                onVerified={setReceipt}
              />
            </>
          )}
          {pending && (
            <p role="status" className="text-[13px]">
              {t("settings.cloudDesktop.working")}
            </p>
          )}
          {error && (
            <p role="alert" className="text-[13px] text-destructive">
              {error}
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
                onClick={() => void execute("readOperation")}
              >
                {t("settings.cloudDesktop.readOperation")}
              </SettingsAction>
            ) : (
              <SettingsAction
                $tone="danger"
                disabled={
                  pending ||
                  !ready ||
                  status !== "Stopped" ||
                  !saved ||
                  !discard ||
                  confirmed !== resource.resourceId
                }
                onClick={() => void execute("restoreSnapshot")}
              >
                {t("settings.cloudDesktop.confirm")}
              </SettingsAction>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
