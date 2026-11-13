import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { requestCloudDesktop } from "@/lib/api/cloud";
import { SettingsAction } from "../../SettingsPrimitives";
import { object } from "./cloudDesktopData";

type Connection = {
  status:
    | "disconnected"
    | "preparing"
    | "authorizing"
    | "verifying"
    | "connected"
    | "failed";
  profile?: string;
  errorCode?: string;
  accountIdSuffix?: string;
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
  const generation = useRef(0);
  const current = useRef({ profile, onConnected, locked });
  current.current = { profile, onConnected, locked };

  function apply(value: unknown, switching = false) {
    const data = object(value);
    if (
      ![
        "disconnected",
        "preparing",
        "authorizing",
        "verifying",
        "connected",
        "failed",
      ].includes(String(data.status)) ||
      (data.status === "connected" &&
        (typeof data.profile !== "string" ||
          !data.profile.startsWith("lime-oauth-"))) ||
      (data.accountIdSuffix !== undefined &&
        (typeof data.accountIdSuffix !== "string" ||
          !/^[0-9]{4}$/.test(data.accountIdSuffix)))
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
      const expected = generation.current;
      try {
        const data = (
          await requestCloudDesktop({ action: "readAlibabaConnection" })
        ).data;
        if (!cancelled && expected === generation.current) apply(data);
      } catch {
        if (!cancelled && expected === generation.current) setError("read");
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
      !["preparing", "authorizing", "verifying"].includes(connection.status)
    )
      return;
    let cancelled = false;
    const expected = generation.current;
    const timer = setTimeout(async () => {
      try {
        const result = await requestCloudDesktop({
          action: "readAlibabaConnection",
        });
        if (!cancelled && expected === generation.current)
          apply(result.data, true);
      } catch {
        if (!cancelled && expected === generation.current) setError("read");
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
    generation.current += 1;
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
    connection &&
    ["preparing", "authorizing", "verifying"].includes(connection.status);
  useEffect(() => {
    onAuthorizingChange(pending || !!authorizing);
    return () => onAuthorizingChange(false);
  }, [pending, authorizing, onAuthorizingChange]);
  const connected =
    !error &&
    !pending &&
    profile &&
    profile === connection?.profile &&
    connection.status === "connected";
  return (
    <div className="space-y-2 text-[13px]">
      <p>{t("settings.cloudDesktop.alibabaSiteCN")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <SettingsAction
          disabled={locked || pending || (!!authorizing && !error) || !regionId}
          onClick={() => void connect()}
        >
          {t(
            error === "read"
              ? "settings.cloudDesktop.refresh"
              : error || connection?.status === "failed"
                ? "settings.cloudDesktop.retryAlibaba"
                : connected
                  ? "settings.cloudDesktop.switchAlibaba"
                  : "settings.cloudDesktop.connectAlibaba",
          )}
        </SettingsAction>
        {connected && (
          <span role="status">
            {t("settings.cloudDesktop.alibabaConnected")}
            {connection.accountIdSuffix && (
              <>
                {" "}
                /{" "}
                {t("settings.cloudDesktop.alibabaAccountSuffix", {
                  suffix: connection.accountIdSuffix,
                })}
              </>
            )}
          </span>
        )}
      </div>
      <p className="text-muted-foreground">
        {t("settings.cloudDesktop.alibabaAuthorizationDescription")}
      </p>
      {connected && !connection.accountIdSuffix && (
        <p role="status" className="text-muted-foreground">
          {t("settings.cloudDesktop.alibabaAccountUnknown")}
        </p>
      )}
      {(pending || authorizing) && (
        <p
          role="status"
          aria-live="polite"
          aria-busy="true"
          className="flex items-center gap-2"
        >
          <Loader2 aria-hidden className="size-3.5 animate-spin" />
          {t(
            connection?.status === "verifying"
              ? "settings.cloudDesktop.verifyingAlibaba"
              : connection?.status === "authorizing"
                ? "settings.cloudDesktop.authorizingAlibaba"
                : "settings.cloudDesktop.preparingAlibaba",
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
                : ["verificationFailed", "verificationInterrupted"].includes(
                      connection?.errorCode ?? "",
                    )
                  ? "settings.cloudDesktop.alibabaVerificationFailed"
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
