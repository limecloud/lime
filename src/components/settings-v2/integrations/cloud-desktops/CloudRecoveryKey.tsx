import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { save } from "@/lib/desktop-host/dialog";
import { SettingsAction } from "../../SettingsPrimitives";
import type { CloudRequest } from "./CloudDesktopPrimitives";
import { object } from "./cloudDesktopData";

export function CloudRecoveryKey({
  request,
  disabled,
  onCreated,
  onBusyChange,
}: {
  request: CloudRequest;
  disabled: boolean;
  onCreated: (identityFile: string, recipient: string) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const { t } = useTranslation("settings");
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState(false);
  const busy = useRef(false);
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  async function create() {
    if (disabled || busy.current) return;
    busy.current = true;
    setPending(true);
    setError(false);
    onBusyChange(true);
    try {
      const identityFile = await save({
        title: t("settings.cloudDesktop.createRecoveryKey"),
        defaultPath: "lime-cloud-recovery.agekey",
        filters: [{ name: "age", extensions: ["agekey"] }],
      });
      if (!identityFile || !active.current) return;
      const data = object(
        (await request({ action: "createArchiveIdentity", identityFile })).data,
      );
      if (
        typeof data.identityFile !== "string" ||
        !data.identityFile ||
        typeof data.recipient !== "string" ||
        !/^age1[a-z0-9]{58}$/.test(data.recipient)
      )
        throw new Error("Invalid recovery key response");
      if (!active.current) return;
      onCreated(data.identityFile, data.recipient);
      setSaved(data.identityFile);
    } catch {
      if (active.current) setError(true);
    } finally {
      busy.current = false;
      onBusyChange(false);
      if (active.current) setPending(false);
    }
  }

  return (
    <div className="space-y-2 text-[13px]">
      <SettingsAction
        disabled={disabled || pending}
        onClick={() => void create()}
      >
        {t(
          pending
            ? "settings.cloudDesktop.working"
            : "settings.cloudDesktop.createRecoveryKey",
        )}
      </SettingsAction>
      <p className="text-muted-foreground">
        {t("settings.cloudDesktop.recoveryKeyDescription")}
      </p>
      {saved && (
        <p role="status" className="break-all select-text">
          {t("settings.cloudDesktop.recoveryKeySaved", { path: saved })}
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {t("settings.cloudDesktop.recoveryKeyFailed")}
        </p>
      )}
    </div>
  );
}
