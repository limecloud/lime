import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingsAction } from "../../SettingsPrimitives";
import {
  CloudReceipt,
  CloudSelect,
  Field,
  inputClass,
  type CloudRequest,
} from "./CloudDesktopPrimitives";
import { object } from "./cloudDesktopData";

export function CloudArchiveTransfer({
  request,
  upload,
  localPath,
  sha256,
  onBusyChange,
}: {
  request: CloudRequest;
  upload: boolean;
  localPath: string;
  sha256: string;
  onBusyChange: (busy: boolean) => void;
}) {
  const { t } = useTranslation("settings");
  const [storage, setStorage] = useState("oss");
  const [profile, setProfile] = useState("");
  const [region, setRegion] = useState("cn-hangzhou");
  const [buckets, setBuckets] = useState<string[]>();
  const [bucket, setBucket] = useState("");
  const [key, setKey] = useState(() =>
    upload ? `lime-backups/${crypto.randomUUID()}.age` : "",
  );
  const [remote, setRemote] = useState("");
  const [path, setPath] = useState(localPath);
  const [digest, setDigest] = useState(sha256);
  const [pending, setPending] = useState<
    "connection" | "buckets" | "transfer"
  >();
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<unknown>();
  const lease = useRef({ active: true, busy: false, generation: 0 });
  useEffect(() => {
    onBusyChange(!!pending);
    return () => onBusyChange(false);
  }, [pending, onBusyChange]);

  const readConnection = useCallback(async () => {
    if (lease.current.busy) return;
    lease.current.busy = true;
    const generation = ++lease.current.generation;
    setPending("connection");
    setError("");
    setProfile("");
    setBucket("");
    setBuckets(undefined);
    setReceipt(undefined);
    try {
      const data = object(
        (await request({ action: "readAlibabaConnection" })).data,
      );
      if (!lease.current.active || generation !== lease.current.generation)
        return;
      if (
        data.status === "connected" &&
        typeof data.profile === "string" &&
        /^lime-oauth-[a-f0-9]{32}$/i.test(data.profile)
      ) {
        setProfile(data.profile);
        if (typeof data.regionId === "string") setRegion(data.regionId);
      }
    } catch {
      if (lease.current.active && generation === lease.current.generation)
        setError(t("settings.cloudDesktop.alibabaConnectionReadFailed"));
    } finally {
      if (generation === lease.current.generation) {
        lease.current.busy = false;
        if (lease.current.active) setPending(undefined);
      }
    }
  }, [request, t]);
  useEffect(() => {
    const current = lease.current;
    current.active = true;
    void readConnection(); // Only reads existing authorization; never starts browser login.
    return () => {
      current.active = false;
      current.busy = false;
      current.generation++;
    };
  }, [readConnection]);

  function changed() {
    setReceipt(undefined);
    setError("");
  }
  async function run(listing: boolean) {
    if (lease.current.busy) return;
    lease.current.busy = true;
    const generation = ++lease.current.generation;
    setPending(listing ? "buckets" : "transfer");
    changed();
    if (listing) {
      setBucket("");
      setBuckets(undefined);
    }
    try {
      const result = await request(
        listing
          ? {
              action: "listOssBuckets",
              profile,
              regionId: region.trim(),
            }
          : storage === "oss"
            ? {
                action: "transferOssArchive",
                profile,
                regionId: region.trim(),
                bucket,
                objectKey: key.trim(),
                localPath: path.trim(),
                expectedSha256: digest.trim(),
                upload,
              }
            : {
                action: "transferArchive",
                remote: remote.trim(),
                localPath: path.trim(),
                expectedSha256: digest.trim(),
                upload,
              },
      );
      if (!lease.current.active || generation !== lease.current.generation)
        return;
      if (listing) {
        const data = object(result.data);
        if (
          !Array.isArray(data.buckets) ||
          !data.buckets.every((value) => typeof value === "string")
        )
          throw new Error("OSS_LIST_FAILED");
        setBuckets(data.buckets);
        if (data.buckets.length === 1) setBucket(data.buckets[0]);
      } else setReceipt(result.data);
    } catch (cause) {
      if (lease.current.active && generation === lease.current.generation)
        setError(
          t(
            String(cause).includes("OSS_TOOL_PREPARING")
              ? "settings.cloudDesktop.ossToolPreparing"
              : listing
                ? "settings.cloudDesktop.ossListFailed"
                : "settings.cloudDesktop.ossTransferFailed",
          ),
        );
    } finally {
      if (generation === lease.current.generation) {
        lease.current.busy = false;
        if (lease.current.active) setPending(undefined);
      }
    }
  }
  const oss = storage === "oss";
  return (
    <fieldset disabled={!!pending} className="space-y-3">
      <Field name="archiveStorage">
        <CloudSelect
          value={storage}
          onChange={(event) => {
            setStorage(event.target.value);
            setBucket("");
            setBuckets(undefined);
            changed();
          }}
        >
          <option value="oss">{t("settings.cloudDesktop.ossBrowser")}</option>
          <option value="rclone">
            {t("settings.cloudDesktop.configuredRemote")}
          </option>
        </CloudSelect>
      </Field>
      {oss && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <span>
              {t(
                profile
                  ? "settings.cloudDesktop.alibabaConnected"
                  : "settings.cloudDesktop.ossConnectionRequired",
              )}
            </span>
            <SettingsAction
              disabled={!!pending}
              onClick={() => void readConnection()}
            >
              {t("settings.cloudDesktop.refresh")}
            </SettingsAction>
          </div>
          <Field name="ossRegion">
            <input
              className={inputClass}
              value={region}
              onChange={(event) => {
                setRegion(event.target.value);
                setBucket("");
                setBuckets(undefined);
                changed();
              }}
            />
          </Field>
          <p className="text-[13px] text-muted-foreground">
            {t("settings.cloudDesktop.ossRegionDescription")}
          </p>
          <SettingsAction
            disabled={
              !!pending ||
              !profile ||
              !/^[a-z0-9][a-z0-9-]{1,39}$/.test(region.trim())
            }
            onClick={() => void run(true)}
          >
            {t("settings.cloudDesktop.ossLoadBuckets")}
          </SettingsAction>
          {buckets !== undefined && (
            <Field name="ossBucket">
              <CloudSelect
                value={bucket}
                onChange={(event) => {
                  setBucket(event.target.value);
                  changed();
                }}
              >
                <option value="">
                  {t(
                    buckets.length
                      ? "settings.cloudDesktop.ossChooseBucket"
                      : "settings.cloudDesktop.ossNoBuckets",
                  )}
                </option>
                {buckets.map((name) => (
                  <option value={name} key={name}>
                    {name}
                  </option>
                ))}
              </CloudSelect>
            </Field>
          )}
          <Field name="ossObjectKey">
            <input
              className={inputClass}
              value={key}
              onChange={(event) => {
                setKey(event.target.value);
                changed();
              }}
            />
          </Field>
        </>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field name="outputPath">
          <input
            className={inputClass}
            value={path}
            onChange={(event) => {
              setPath(event.target.value);
              changed();
            }}
          />
        </Field>
        <Field name="expectedSha256">
          <input
            className={inputClass}
            value={digest}
            onChange={(event) => {
              setDigest(event.target.value);
              changed();
            }}
          />
        </Field>
        {!oss && (
          <Field name="remote">
            <input
              className={inputClass}
              value={remote}
              onChange={(event) => {
                setRemote(event.target.value);
                changed();
              }}
            />
          </Field>
        )}
      </div>
      <p className="text-[13px] text-muted-foreground">
        {t(
          oss
            ? "settings.cloudDesktop.ossTransferDescription"
            : "settings.cloudDesktop.transferDescription",
        )}
      </p>
      <SettingsAction
        disabled={
          !!pending ||
          receipt !== undefined ||
          !path.trim() ||
          !/^[a-f0-9]{64}$/i.test(digest.trim()) ||
          (oss
            ? !profile || !bucket || !key.trim().endsWith(".age")
            : !remote.trim())
        }
        onClick={() => void run(false)}
      >
        {t(
          upload
            ? "settings.cloudDesktop.upload"
            : "settings.cloudDesktop.download",
        )}
      </SettingsAction>
      {pending && (
        <p role="status" className="text-[13px] text-muted-foreground">
          {t(
            pending === "buckets"
              ? "settings.cloudDesktop.ossLoadingBuckets"
              : "settings.cloudDesktop.working",
          )}
        </p>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      )}
      {receipt !== undefined && <CloudReceipt data={receipt} />}
    </fieldset>
  );
}
