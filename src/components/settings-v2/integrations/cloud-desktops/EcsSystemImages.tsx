import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { EcsDesktopSpec } from "@limecloud/app-server-client";
import { requestCloudDesktop } from "@/lib/api/cloud";
import { SettingsAction } from "../../SettingsPrimitives";
import { CloudSelect, Field } from "./CloudDesktopPrimitives";
import { object } from "./cloudDesktopData";
import type { useCloudPurchase } from "./useCloudPurchase";

type Image = {
  imageId: string;
  name: string;
  systemDiskGiB: number;
  ready: boolean;
};

export function EcsSystemImages({
  purchase,
  disabled,
}: {
  purchase: ReturnType<typeof useCloudPurchase<EcsDesktopSpec>>;
  disabled: boolean;
}) {
  const { t } = useTranslation("settings");
  const { profile, regionId } = purchase.spec;
  const [images, setImages] = useState<Image[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const busy = useRef(false);
  const current = useRef(purchase);
  current.current = purchase;
  useEffect(() => {
    generation.current += 1;
    busy.current = false;
    setImages([]);
    setLoaded(false);
    setPending(false);
    setError("");
    return () => {
      generation.current += 1;
    };
  }, [profile, regionId]);
  async function load() {
    if (
      busy.current ||
      disabled ||
      purchase.pending ||
      purchase.submitted ||
      !profile ||
      !regionId
    )
      return;
    busy.current = true;
    const expected = generation.current;
    setImages([]);
    setLoaded(false);
    setPending(true);
    setError("");
    try {
      const data = object(
        (
          await requestCloudDesktop({
            action: "listEcsImages",
            profile,
            regionId,
          })
        ).data,
      );
      if (
        data.profile !== profile ||
        data.regionId !== regionId ||
        !Array.isArray(data.images)
      )
        throw new Error(t("settings.cloudDesktop.invalidResponse"));
      const seen = new Set<string>();
      const result = data.images.map((value) => {
        const image = object(value);
        if (
          typeof image.imageId !== "string" ||
          !image.imageId.startsWith("m-") ||
          seen.has(image.imageId) ||
          typeof image.name !== "string" ||
          !image.name ||
          image.encrypted !== true ||
          image.private !== true ||
          typeof image.ready !== "boolean" ||
          !Number.isSafeInteger(image.systemDiskGiB) ||
          Number(image.systemDiskGiB) < 60 ||
          Number(image.systemDiskGiB) > 500
        )
          throw new Error(t("settings.cloudDesktop.invalidResponse"));
        seen.add(image.imageId);
        return {
          imageId: image.imageId,
          name: image.name,
          systemDiskGiB: Number(image.systemDiskGiB),
          ready: image.ready,
        };
      });
      if (generation.current === expected) {
        setImages(result);
        setLoaded(true);
      }
    } catch (cause) {
      if (generation.current === expected) setError(String(cause));
    } finally {
      if (generation.current === expected) {
        busy.current = false;
        setPending(false);
      }
    }
  }
  const locked = disabled || pending || purchase.pending || purchase.submitted;
  const selected = images.find(
    (image) => image.imageId === purchase.spec.imageId,
  );
  return (
    <details className="space-y-3 text-[13px]">
      <summary className="w-fit cursor-pointer py-2">
        {t("settings.cloudDesktop.restoreSystemImage")}
      </summary>
      <p className="text-muted-foreground">
        {t("settings.cloudDesktop.restoreSystemImageHelp")}
      </p>
      <SettingsAction
        disabled={locked || !profile || !regionId}
        onClick={() => void load()}
      >
        {t("settings.cloudDesktop.loadSystemImages")}
      </SettingsAction>
      {images.length > 0 && (
        <Field name="systemImageSelection">
          <CloudSelect
            value={selected?.imageId ?? ""}
            disabled={locked}
            onChange={(event) => {
              const image = images.find(
                (item) => item.imageId === event.target.value,
              );
              if (!image?.ready || locked) return;
              const latest = current.current;
              latest.setSpec({
                ...latest.spec,
                imageId: image.imageId,
                systemDiskGib: Math.max(
                  latest.spec.systemDiskGib,
                  image.systemDiskGiB,
                ),
              });
              latest.setQuote(undefined);
              latest.setApproved(false);
              if (!latest.name)
                latest.setName(`Lime-${crypto.randomUUID().slice(0, 8)}`);
            }}
          >
            <option value="" disabled>
              {t("settings.cloudDesktop.chooseSystemImage")}
            </option>
            {images.map((image) => (
              <option
                key={image.imageId}
                value={image.imageId}
                disabled={!image.ready}
              >
                {image.name} / {image.systemDiskGiB} GiB / {image.imageId}
              </option>
            ))}
          </CloudSelect>
        </Field>
      )}
      {selected && (
        <p className="select-text break-all">
          {t("settings.cloudDesktop.imageId")}: {selected.imageId}
        </p>
      )}
      {loaded && images.length === 0 && (
        <p className="text-muted-foreground">
          {t("settings.cloudDesktop.noSystemImages")}
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </details>
  );
}
