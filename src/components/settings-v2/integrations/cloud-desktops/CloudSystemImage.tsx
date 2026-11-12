import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingsAction, SettingsSection } from "../../SettingsPrimitives";
import {
  CloudReceipt,
  CloudSelect,
  Field,
  type CloudRequest,
} from "./CloudDesktopPrimitives";
import { object } from "./cloudDesktopData";

export function CloudSystemImage({
  operations,
  request,
  onChanged,
}: {
  operations: Record<string, unknown>[];
  request: CloudRequest;
  onChanged: () => void;
}) {
  const { t } = useTranslation("settings");
  const [selected, setSelected] = useState("");
  const [approved, setApproved] = useState(false);
  const [operationId, setOperationId] = useState("");
  const [receipt, setReceipt] = useState<unknown>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const snapshots = operations.filter(
    (entry) =>
      entry.action === "snapshot" &&
      entry.outcome === "snapshotReady" &&
      object(entry.resource).provider === "ecs",
  );
  const source = snapshots.find((entry) => entry.operationId === selected);
  const submitted = operationId !== "";
  async function run(read: boolean) {
    if (busy.current || (!read && (submitted || !source || !approved))) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      const id = read ? operationId : crypto.randomUUID();
      if (!read) setOperationId(id);
      const result = (
        await request(
          read
            ? { action: "readOperation", operationId: id }
            : {
                action: "createEcsImage",
                snapshotOperationId: selected,
                operationId: id,
                confirmation: `createEcsImage:${selected}`,
                includeCredentials: approved,
              },
        )
      ).data;
      setReceipt(result);
      onChanged();
    } catch (cause) {
      setError(String(cause));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <SettingsSection title={t("settings.cloudDesktop.systemImageTitle")}>
      <div className="space-y-3 text-[13px]">
        <p className="text-muted-foreground">
          {t("settings.cloudDesktop.systemImageHelp")}
        </p>
        <p>{t("settings.cloudDesktop.systemImagePrivacy")}</p>
        <Field name="systemSnapshotOperation">
          <CloudSelect
            value={selected}
            disabled={pending || submitted}
            onChange={(event) => {
              setSelected(event.target.value);
              setApproved(false);
              setError("");
            }}
          >
            <option value="">
              {t("settings.cloudDesktop.chooseSystemSnapshot")}
            </option>
            {snapshots.map((entry) => (
              <option
                key={String(entry.operationId)}
                value={String(entry.operationId)}
              >
                {String(object(entry.resource).resourceId)} /{" "}
                {String(entry.operationId)}
              </option>
            ))}
          </CloudSelect>
        </Field>
        {snapshots.length === 0 && (
          <p className="text-muted-foreground">
            {t("settings.cloudDesktop.noSystemSnapshots")}
          </p>
        )}
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={approved}
            disabled={pending || submitted || !source}
            onChange={(event) => setApproved(event.target.checked)}
          />
          {t("settings.cloudDesktop.systemImageConsent")}
        </label>
        <div className="flex flex-wrap gap-2">
          {submitted ? (
            <SettingsAction disabled={pending} onClick={() => void run(true)}>
              {t("settings.cloudDesktop.readOperation")}
            </SettingsAction>
          ) : (
            <SettingsAction
              disabled={pending || !source || !approved}
              onClick={() => void run(false)}
            >
              {t("settings.cloudDesktop.createEcsImage")}
            </SettingsAction>
          )}
        </div>
        {submitted && (
          <p className="select-text break-all text-muted-foreground">
            {t("settings.cloudDesktop.operationId")}: {operationId}
          </p>
        )}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {receipt !== undefined && <CloudReceipt data={receipt} />}
      </div>
    </SettingsSection>
  );
}
