import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CloudDesktopResource } from "@limecloud/app-server-client";
import { configureCloudDesktopConnection } from "@/lib/api/cloudDesktopConnection";
import { isElectronHostCommandAvailable } from "@/lib/electron-host";
import { sameCloudDesktop } from "@/lib/desktop-host/cloudDesktopConnection";
import { CloudRecoveryKey } from "./CloudRecoveryKey";
import { CloudArchiveTransfer } from "./CloudArchiveTransfer";
import { SettingsAction, SettingsSection } from "../../SettingsPrimitives";
import {
  CloudReceipt,
  CloudSelect,
  Field,
  inputClass,
  type CloudRequest,
} from "./CloudDesktopPrimitives";

export function CloudArchivePanel({
  request,
  computers,
  backupSources = computers,
}: {
  request: CloudRequest;
  computers: { key: string; name: string; resource: CloudDesktopResource }[];
  backupSources?: {
    key: string;
    name: string;
    resource: CloudDesktopResource;
  }[];
}) {
  const { t } = useTranslation("settings");
  const [mode, setMode] = useState("export");
  const [computer, setComputer] = useState("");
  const [backupSourceKey, setBackupSourceKey] = useState("");
  const selected = computers.find((item) => item.key === computer)?.resource;
  const eligibleSources = backupSources.filter(
    (item) => selected && !sameCloudDesktop(item.resource, selected),
  );
  const backupSource = eligibleSources.find(
    (item) => item.key === backupSourceKey,
  )?.resource;
  const remote = mode === "export" && computer !== "";
  const restoringToCloud = mode === "restoreToCloud";
  const transferring = mode === "upload" || mode === "download";
  const canDownload = isElectronHostCommandAvailable(
    "cloud_desktop_connection",
  );
  const [form, setForm] = useState({
    sourceRoot: "",
    paths: "",
    outputPath: "",
    recipient: "",
    identityFile: "",
    destination: "",
    expectedSha256: "",
    maxBytes: "10737418240",
    restoreFolderName: "",
  });
  const [saved, setSaved] = useState(false);
  const [credentials, setCredentials] = useState(false);
  const [restoreConfirmed, setRestoreConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [creatingKey, setCreatingKey] = useState(false);
  const [receipt, setReceipt] = useState<unknown>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const busy = useRef(false);
  const fields: (keyof typeof form)[] =
    mode === "export"
      ? remote
        ? ["sourceRoot", "paths", "recipient"]
        : ["sourceRoot", "paths", "outputPath", "recipient"]
      : mode === "restore"
        ? [
            "outputPath",
            "identityFile",
            "destination",
            "expectedSha256",
            "maxBytes",
          ]
        : restoringToCloud
          ? [
              "outputPath",
              "identityFile",
              "expectedSha256",
              "restoreFolderName",
            ]
          : [];
  async function run() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    setReceipt(undefined);
    setNotice("");
    try {
      if (restoringToCloud) {
        if (!selected) throw new Error("CLOUD_ARCHIVE_CONNECTION_REQUIRED");
        const result = await configureCloudDesktopConnection({
          action: "restoreArchiveToCloud",
          resource: selected,
          archivePath: form.outputPath.trim(),
          identityFile: form.identityFile.trim(),
          expectedSha256: form.expectedSha256.trim(),
          folderName: form.restoreFolderName.trim(),
          confirmed: restoreConfirmed,
          ...(backupSource ? { backupSource } : {}),
        });
        if (!("kind" in result) || result.kind !== "archiveRestore")
          throw new Error("CLOUD_ARCHIVE_RESTORE_FAILED");
        const { releaseBackupRecorded, ...receipt } = result;
        setReceipt(receipt);
        if (releaseBackupRecorded !== undefined)
          setNotice(
            t(
              releaseBackupRecorded
                ? "settings.cloudDesktop.releaseBackupLinked"
                : "settings.cloudDesktop.releaseBackupLinkFailed",
            ),
          );
        setRestoreConfirmed(false);
        return;
      }
      const paths = form.paths
        .split("\n")
        .map((p) => p.trim())
        .filter(Boolean);
      if (remote) {
        if (!selected)
          throw new Error(t("settings.cloudDesktop.archiveConnectionRequired"));
        const result = await configureCloudDesktopConnection({
          action: "downloadArchive",
          resource: selected,
          sourceRoot: form.sourceRoot,
          paths,
          recipient: form.recipient.trim(),
          workSaved: saved,
          includeCredentials: credentials,
        });
        if (!("kind" in result) || result.kind !== "archiveDownload")
          throw new Error(t("settings.cloudDesktop.invalidResponse"));
        if (!result.canceled) {
          setBackupSourceKey(result.backupRecorded ? computer : "");
          if (result.backupRecorded === false)
            setNotice(t("settings.cloudDesktop.releaseBackupSaveFailed"));
          setForm((previous) => ({
            ...previous,
            outputPath: result.localPath,
            expectedSha256: result.sha256,
          }));
          setReceipt({
            path: result.localPath,
            sha256: result.sha256,
            bytes: result.bytes,
            encrypted: true,
            restoreVerified: false,
          });
        }
        return;
      }
      const response = await request(
        mode === "export"
          ? {
              action: "exportArchive",
              sourceRoot: form.sourceRoot,
              paths,
              outputPath: form.outputPath,
              recipient: form.recipient,
              includeCredentials: credentials,
              workSaved: saved,
            }
          : {
              action: "restoreArchive",
              archivePath: form.outputPath,
              identityFile: form.identityFile,
              destination: form.destination,
              expectedSha256: form.expectedSha256,
              maxBytes: Number(form.maxBytes),
            },
      );
      setReceipt(response.data);
    } catch (cause) {
      const failure = String(cause);
      setError(
        restoringToCloud
          ? t(
              failure.includes("CLOUD_ARCHIVE_CONNECTION_REQUIRED")
                ? "settings.cloudDesktop.archiveConnectionRequired"
                : failure.includes("CLOUD_ARCHIVE_RESTORE_INSPECT_FOLDER")
                  ? "settings.cloudDesktop.restoreCloudInspect"
                  : "settings.cloudDesktop.restoreCloudError",
            )
          : remote
            ? t(
                failure.includes("CLOUD_ARCHIVE_CONNECTION_REQUIRED")
                  ? "settings.cloudDesktop.archiveConnectionRequired"
                  : "settings.cloudDesktop.archiveDownloadError",
              )
            : String(cause),
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <SettingsSection title={t("settings.cloudDesktop.archiveTitle")}>
      <p className="mb-4 text-[13px] text-muted-foreground">
        {t("settings.cloudDesktop.archiveDescription")}
      </p>
      <fieldset disabled={pending || creatingKey} className="space-y-3">
        <Field name="archiveAction">
          <CloudSelect
            value={mode}
            onChange={(e) => {
              setMode(e.target.value);
              setComputer("");
              setRestoreConfirmed(false);
              setReceipt(undefined);
              setError("");
              setNotice("");
            }}
          >
            {[
              "export",
              "restore",
              ...(canDownload ? ["restoreToCloud"] : []),
              "upload",
              "download",
            ].map((value) => (
              <option key={value} value={value}>
                {t(`settings.cloudDesktop.${value}`)}
              </option>
            ))}
          </CloudSelect>
        </Field>
        {transferring ? (
          <CloudArchiveTransfer
            key={mode}
            request={request}
            upload={mode === "upload"}
            localPath={form.outputPath}
            sha256={form.expectedSha256}
            onBusyChange={setCreatingKey}
          />
        ) : (
          <>
            {(mode === "export" || restoringToCloud) &&
              canDownload &&
              (restoringToCloud || computers.length > 0 || computer) && (
                <Field
                  name={
                    restoringToCloud ? "restoreCloudTarget" : "archiveSource"
                  }
                >
                  <CloudSelect
                    value={computer}
                    onChange={(event) => {
                      setComputer(event.target.value);
                      if (!restoringToCloud)
                        setForm((previous) => ({
                          ...previous,
                          sourceRoot: "",
                          paths: "",
                          outputPath: "",
                          expectedSha256: "",
                        }));
                      setSaved(false);
                      setCredentials(false);
                      setRestoreConfirmed(false);
                      setReceipt(undefined);
                      setError("");
                      setNotice("");
                    }}
                  >
                    <option value="">
                      {t(
                        restoringToCloud
                          ? "settings.cloudDesktop.restoreChooseComputer"
                          : "settings.cloudDesktop.archiveThisComputer",
                      )}
                    </option>
                    {computers.map((item) => (
                      <option key={item.key} value={item.key}>
                        {item.name}
                      </option>
                    ))}
                    {computer && !selected && (
                      <option value={computer}>
                        {t("settings.cloudDesktop.archiveConnectionRequired")}
                      </option>
                    )}
                  </CloudSelect>
                </Field>
              )}
            {(remote || restoringToCloud) && (
              <p className="text-[13px] text-muted-foreground">
                {t(
                  restoringToCloud
                    ? "settings.cloudDesktop.restoreCloudDescription"
                    : "settings.cloudDesktop.archiveRemoteDescription",
                )}
              </p>
            )}
            {restoringToCloud && eligibleSources.length > 0 && (
              <Field name="releaseBackupSource">
                <CloudSelect
                  value={backupSource ? backupSourceKey : ""}
                  onChange={(event) => {
                    setBackupSourceKey(event.target.value);
                    setRestoreConfirmed(false);
                    setReceipt(undefined);
                    setNotice("");
                  }}
                >
                  <option value="">
                    {t("settings.cloudDesktop.releaseBackupNoLink")}
                  </option>
                  {eligibleSources.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.name}
                    </option>
                  ))}
                </CloudSelect>
              </Field>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {fields.map((key) => (
                <Field name={key} key={key}>
                  {key === "paths" ? (
                    <textarea
                      className={inputClass}
                      rows={3}
                      value={form[key]}
                      onChange={(e) =>
                        setForm({ ...form, [key]: e.target.value })
                      }
                    />
                  ) : (
                    <input
                      className={inputClass}
                      type={key === "maxBytes" ? "number" : "text"}
                      min={1}
                      value={form[key]}
                      onChange={(e) => {
                        setForm({ ...form, [key]: e.target.value });
                        if (restoringToCloud) setRestoreConfirmed(false);
                      }}
                    />
                  )}
                </Field>
              ))}
            </div>
            {mode === "export" && (
              <>
                {canDownload && (
                  <CloudRecoveryKey
                    request={request}
                    disabled={pending}
                    onBusyChange={setCreatingKey}
                    onCreated={(identityFile, recipient) => {
                      setForm((previous) => ({
                        ...previous,
                        identityFile,
                        recipient,
                      }));
                      setReceipt(undefined);
                      setNotice("");
                      setError("");
                    }}
                  />
                )}
                <label className="flex items-start gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={saved}
                    onChange={(e) => setSaved(e.target.checked)}
                  />
                  {t("settings.cloudDesktop.workSaved")}
                </label>
                <label className="flex items-start gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={credentials}
                    onChange={(e) => setCredentials(e.target.checked)}
                  />
                  {t("settings.cloudDesktop.includeCredentials")}
                </label>
              </>
            )}
            {restoringToCloud && (
              <label className="flex items-start gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={restoreConfirmed}
                  onChange={(event) =>
                    setRestoreConfirmed(event.target.checked)
                  }
                />
                {t("settings.cloudDesktop.restoreCloudConsent")}
              </label>
            )}
            <SettingsAction
              disabled={
                pending ||
                fields.some((key) => !form[key].trim()) ||
                (remote && !selected) ||
                (restoringToCloud &&
                  (!selected ||
                    !restoreConfirmed ||
                    !/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(
                      form.restoreFolderName.trim(),
                    ) ||
                    !/^[a-f0-9]{64}$/i.test(form.expectedSha256.trim()))) ||
                (mode === "export" && !saved)
              }
              onClick={() => void run()}
            >
              {t(
                remote
                  ? "settings.cloudDesktop.archiveSaveLocally"
                  : `settings.cloudDesktop.${mode}`,
              )}
            </SettingsAction>
          </>
        )}
      </fieldset>
      {error && (
        <p role="alert" className="mt-3 text-[13px] text-destructive">
          {error}
        </p>
      )}
      {pending && (
        <p role="status" className="mt-3 text-[13px] text-muted-foreground">
          {t("settings.cloudDesktop.working")}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-3 text-[13px] text-muted-foreground">
          {notice}
        </p>
      )}
      {receipt !== undefined && (
        <div className="mt-3">
          <CloudReceipt data={receipt} />
        </div>
      )}
    </SettingsSection>
  );
}
