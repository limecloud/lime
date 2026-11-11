import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { requestCloudDesktop } from "@/lib/api/cloud";
import { SettingsAction } from "../../SettingsPrimitives";
import { object } from "./CloudDesktopPrimitives";

type Connection = {
  status: "disconnected" | "preparing" | "authorizing" | "connected" | "failed";
  profile?: string;
  errorCode?: string;
};

export function AlibabaConnection({
  regionId,
  profile,
  locked,
  onConnected,
  onAuthorizingChange,
}: {
  regionId: string;
  profile: string;
  locked: boolean;
  onConnected: (profile: string) => void;
  onAuthorizingChange: (pending: boolean) => void;
}) {
  const { t } = useTranslation("settings");
  const [connection, setConnection] = useState<Connection>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<"read" | "connect">();
  const active = useRef(false);
  const busy = useRef(false);
  const current = useRef({ profile, onConnected, locked });
  current.current = { profile, onConnected, locked };

  function apply(value: unknown, switching = false) {
    const data = object(value);
    if (
      ![
        "disconnected",
        "preparing",
        "authorizing",
        "connected",
        "failed",
      ].includes(String(data.status)) ||
      (data.status === "connected" &&
        (typeof data.profile !== "string" ||
          !data.profile.startsWith("lime-oauth-")))
    )
      throw new Error("Invalid Alibaba connection status");
    if (!active.current) return;
    setError(undefined);
    setConnection(data as Connection);
    if (
      data.status === "connected" &&
      !current.current.locked &&
      (switching || !current.current.profile)
    ) {
      current.current.onConnected(String(data.profile));
    }
  }

  useEffect(() => {
    active.current = true;
    let cancelled = false;
    async function read() {
      try {
        const data = (
          await requestCloudDesktop({ action: "readAlibabaConnection" })
        ).data;
        if (!cancelled) apply(data);
      } catch {
        if (!cancelled) setError("read");
      }
    }
    void read();
    return () => {
      cancelled = true;
      active.current = false;
    };
  }, []);

  // Starting a new authorization also starts polling. The task lives in the
  // local App Server, so closing/reopening the dialog does not restart OAuth.
  useEffect(() => {
    if (
      !connection ||
      !["preparing", "authorizing"].includes(connection.status)
    )
      return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const result = await requestCloudDesktop({
          action: "readAlibabaConnection",
        });
        if (!cancelled) apply(result.data, true);
      } catch {
        if (!cancelled) setError("read");
      }
    }, 1500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [connection]);

  async function connect() {
    if (busy.current || locked) return;
    busy.current = true;
    const reading = error === "read";
    if (!reading) current.current.onConnected("");
    setPending(true);
    setError(undefined);
    try {
      apply(
        (
          await requestCloudDesktop(
            reading
              ? { action: "readAlibabaConnection" }
              : { action: "connectAlibaba", regionId },
          )
        ).data,
        !reading,
      );
    } catch {
      if (active.current) setError(reading ? "read" : "connect");
    } finally {
      busy.current = false;
      if (active.current) setPending(false);
    }
  }
  const authorizing =
    connection && ["preparing", "authorizing"].includes(connection.status);
  useEffect(() => {
    onAuthorizingChange(pending || !!authorizing);
    return () => onAuthorizingChange(false);
  }, [pending, authorizing, onAuthorizingChange]);
  const connected =
    profile &&
    profile === connection?.profile &&
    connection.status === "connected";
  return (
    <div className="space-y-2 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <SettingsAction
          disabled={locked || pending || (!!authorizing && !error) || !regionId}
          onClick={() => void connect()}
        >
          {t(
            error === "read"
              ? "settings.cloudDesktop.refresh"
              : connected
                ? "settings.cloudDesktop.switchAlibaba"
                : "settings.cloudDesktop.connectAlibaba",
          )}
        </SettingsAction>
        {connected && (
          <span role="status">
            {t("settings.cloudDesktop.alibabaConnected")}
          </span>
        )}
      </div>
      <p className="text-muted-foreground">
        {t("settings.cloudDesktop.alibabaAuthorizationDescription")}
      </p>
      {authorizing && (
        <p role="status">
          {t(
            connection.status === "preparing"
              ? "settings.cloudDesktop.preparingAlibaba"
              : "settings.cloudDesktop.authorizingAlibaba",
          )}
        </p>
      )}
      {(error || connection?.status === "failed") && (
        <p role="alert" className="text-destructive">
          {t(
            error === "read"
              ? "settings.cloudDesktop.alibabaConnectionReadFailed"
              : connection?.errorCode === "cliUnavailable"
                ? "settings.cloudDesktop.alibabaCliUnavailable"
                : "settings.cloudDesktop.alibabaAuthorizationFailed",
          )}{" "}
          <a
            className="underline"
            href="https://help.aliyun.com/zh/cli/oauth-credentials"
            target="_blank"
            rel="noreferrer"
          >
            {t("settings.cloudDesktop.alibabaAuthorizationHelp")}
          </a>
        </p>
      )}
    </div>
  );
}
