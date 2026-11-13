import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { requestCloudDesktop } from "@/lib/api/cloud";
import { SettingsAction } from "../../SettingsPrimitives";
import { CloudSelect, Field } from "./CloudDesktopPrimitives";
import { object } from "./cloudDesktopData";

export type EcsSystemImage = {
  imageId: string;
  name: string;
  systemDiskGiB: number;
  ready: boolean;
};

export function EcsSystemImages({
  profile,
  regionId,
  disabled,
  onSelected,
}: {
  profile: string;
  regionId: string;
  disabled: boolean;
  onSelected: (image: EcsSystemImage | undefined) => void;
}) {
  const { t } = useTranslation("settings");
  const [images, setImages] = useState<EcsSystemImage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [selection, setSelection] = useState("");
  const generation = useRef(0);
  const busy = useRef(false);
  useEffect(() => {
    generation.current += 1;
    busy.current = false;
    setImages([]);
    setLoaded(false);
    setPending(false);
    setError("");
    setSelection("");
    onSelected(undefined);
    return () => {
      generation.current += 1;
    };
  }, [profile, regionId, onSelected]);
  async function load() {
    if (busy.current || disabled || !profile || !regionId) return;
    busy.current = true;
    const expected = generation.current;
    setImages([]);
    setLoaded(false);
    setPending(true);
    setError("");
    setSelection("");
    onSelected(undefined);
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
  const loader = useRef(load);
  loader.current = load;
  useEffect(() => {
    void loader.current();
  }, [profile, regionId]);
  const locked = disabled || pending;
  const selected = images.find((image) => image.imageId === selection);
  return (
    <div className="space-y-3 text-[13px]">
      <h3 className="font-medium">
        {t("settings.cloudDesktop.restoreSystemImage")}
      </h3>
      <p className="text-muted-foreground">
        {t("settings.cloudDesktop.restoreSystemImageHelp")}
      </p>
      <SettingsAction
        disabled={locked || !profile || !regionId}
        onClick={() => void load()}
      >
        {t("settings.cloudDesktop.loadSystemImages")}
      </SettingsAction>
      {pending && <p role="status">{t("settings.cloudDesktop.loading")}</p>}
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
              setSelection(image.imageId);
              onSelected(image);
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
    </div>
  );
}
