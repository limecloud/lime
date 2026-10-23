import { useCallback, useEffect, useRef, useState } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import {
  Check,
  Copy,
  Download,
  Loader2,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  deleteDictationHistory,
  listDictationHistory,
  readDictationHistoryAudio,
  type DictationHistoryEntry,
} from "@/lib/api/dictationHistory";
import { getAsrCredentials } from "@/lib/api/asrProvider";
import { downloadBlob } from "@/lib/artifact/downloadBlob";
import {
  recoverDictationHistory,
  selectDictationHistory,
  selectedDictationHistoryId,
} from "@/lib/dictationHistoryRecovery";
import { SettingsAction, SettingsRow } from "../../SettingsPrimitives";

const STATUS_KEYS = {
  recording: "settings.voice.history.status.recording",
  cancelled: "settings.voice.history.status.cancelled",
  interrupted: "settings.voice.history.status.interrupted",
  saved: "settings.voice.history.status.saved",
} as const;

type Action = "copy" | "download" | "delete" | "transcribe";
const MENU_ITEM =
  "flex cursor-default items-center gap-2 rounded-md px-3 py-1.5 text-[13px] outline-none data-[highlighted]:bg-accent data-[disabled]:opacity-50";

export function DictationHistory({
  capabilityRevision = 0,
}: {
  capabilityRevision?: number;
}) {
  const { t, i18n } = useTranslation("settings");
  const [items, setItems] = useState<DictationHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [capable, setCapable] = useState(false);
  const [selected, setSelected] = useState(selectedDictationHistoryId);
  const [copied, setCopied] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [action, setAction] = useState<{ id: string; kind: Action } | null>(
    null,
  );
  const busy = useRef(false);
  const mounted = useRef(false);
  const sequence = useRef(0);
  const capabilitySequence = useRef(0);
  const refreshCapability = useCallback(async () => {
    const request = ++capabilitySequence.current;
    try {
      const credentials = await getAsrCredentials();
      if (mounted.current && request === capabilitySequence.current)
        setCapable(credentials.some((c) => !c.disabled && c.is_default));
    } catch {
      if (mounted.current && request === capabilitySequence.current)
        setCapable(false);
    }
  }, []);
  const reload = useCallback(async () => {
    const request = ++sequence.current;
    setLoading(true);
    setLoadError(false);
    try {
      const recordings = await listDictationHistory();
      if (mounted.current && request === sequence.current) setItems(recordings);
    } catch {
      if (mounted.current && request === sequence.current) setLoadError(true);
    } finally {
      if (mounted.current && request === sequence.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void reload();
    const onFocus = () => {
      if (!busy.current) {
        void reload();
        void refreshCapability();
      }
    };
    window.addEventListener("focus", onFocus);
    return () => {
      mounted.current = false;
      sequence.current += 1;
      capabilitySequence.current += 1;
      window.removeEventListener("focus", onFocus);
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, [reload, refreshCapability]);
  useEffect(() => {
    void refreshCapability();
  }, [capabilityRevision, refreshCapability]);

  const run = async (item: DictationHistoryEntry, kind: Action) => {
    if (busy.current) return;
    busy.current = true;
    setAction({ id: item.id, kind });
    try {
      if (kind === "copy") {
        await navigator.clipboard.writeText(item.text ?? "");
        if (mounted.current) {
          setCopied(item.id);
          if (copyTimer.current) clearTimeout(copyTimer.current);
          copyTimer.current = setTimeout(() => setCopied(null), 2000);
        }
      }
      if (kind === "delete") await deleteDictationHistory(item.id);
      if (kind === "transcribe") await recoverDictationHistory(item.id);
      if (kind === "download") {
        const blob = await readDictationHistoryAudio(item.id);
        const extension =
          (
            {
              "audio/webm": "webm",
              "audio/mp4": "m4a",
              "audio/ogg": "ogg",
              "audio/wav": "wav",
            } as Record<string, string>
          )[blob.type.split(";")[0]] ?? "audio";
        downloadBlob(blob, `dictation-${item.id}.${extension}`);
      }
      if (mounted.current && (kind === "delete" || kind === "transcribe"))
        await reload();
    } catch {
      if (mounted.current) toast.error(t("settings.voice.history.actionError"));
    } finally {
      busy.current = false;
      if (mounted.current) setAction(null);
    }
  };
  const visible = selected
    ? items.filter((item) => item.id === selected)
    : items.slice(0, 20);
  const disabled = action !== null;
  return (
    <div data-settings-search-target="voice-history" tabIndex={-1}>
      <SettingsRow
        label={t("settings.voice.history.label")}
        description={t("settings.voice.history.description", { count: 20 })}
      />
      {selected ? (
        <div className="py-2">
          <SettingsAction
            onClick={() => {
              selectDictationHistory(null);
              setSelected(null);
            }}
          >
            {t("settings.voice.history.showAll")}
          </SettingsAction>
        </div>
      ) : null}
      {loadError ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 py-3 text-[12px]"
        >
          {t("settings.voice.history.loadError")}
          <SettingsAction disabled={disabled} onClick={() => void reload()}>
            {t("settings.voice.page.retry")}
          </SettingsAction>
        </div>
      ) : loading ? (
        <p role="status" className="py-3 text-[12px] text-muted-foreground">
          {t("settings.voice.history.loading")}
        </p>
      ) : (
        visible.map((item) => (
          <SettingsRow
            key={item.id}
            label={
              <span
                className={
                  selected
                    ? "block whitespace-pre-wrap break-words font-normal select-text"
                    : "block truncate font-normal"
                }
              >
                {item.text || t(STATUS_KEYS[item.status])}
              </span>
            }
            description={
              <time
                dateTime={new Date(item.createdAtMs).toISOString()}
                className="tabular-nums"
              >
                {new Intl.DateTimeFormat(i18n.language, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                }).format(item.createdAtMs)}
              </time>
            }
          >
            {item.text ? (
              <SettingsAction
                aria-label={t("settings.voice.history.copy")}
                disabled={disabled}
                onClick={() => void run(item, "copy")}
              >
                {copied === item.id ? <Check /> : <Copy />}
                {copied === item.id ? (
                  <span className="sr-only" role="status">
                    {t("settings.voice.history.copied")}
                  </span>
                ) : null}
              </SettingsAction>
            ) : null}
            {capable &&
            !item.text &&
            item.sizeBytes > 0 &&
            item.status !== "recording" ? (
              <SettingsAction
                aria-label={t("settings.voice.history.retryAria")}
                disabled={disabled}
                onClick={() => void run(item, "transcribe")}
              >
                {action?.id === item.id && action.kind === "transcribe" ? (
                  <Loader2 className="animate-spin" />
                ) : null}
                {t("settings.voice.history.retry")}
              </SettingsAction>
            ) : null}
            {selected && item.sizeBytes > 0 ? (
              <SettingsAction
                disabled={disabled}
                onClick={() => void run(item, "download")}
              >
                {t("settings.voice.history.downloadAudio")}
              </SettingsAction>
            ) : null}
            <Menu.Root>
              <Menu.Trigger asChild>
                <SettingsAction
                  aria-label={t("settings.voice.history.actions")}
                  disabled={disabled}
                >
                  <MoreHorizontal />
                </SettingsAction>
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Content
                  align="end"
                  sideOffset={4}
                  className="z-50 min-w-40 rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg"
                >
                  {item.sizeBytes > 0 ? (
                    <Menu.Item
                      className={MENU_ITEM}
                      disabled={disabled}
                      onSelect={() => void run(item, "download")}
                    >
                      <Download className="size-3.5" />
                      {t("settings.voice.history.download")}
                    </Menu.Item>
                  ) : null}
                  <Menu.Item
                    className={MENU_ITEM}
                    disabled={disabled || item.status === "recording"}
                    onSelect={() => void run(item, "delete")}
                  >
                    <Trash2 className="size-3.5" />
                    {t("settings.voice.history.delete")}
                  </Menu.Item>
                </Menu.Content>
              </Menu.Portal>
            </Menu.Root>
          </SettingsRow>
        ))
      )}
    </div>
  );
}
