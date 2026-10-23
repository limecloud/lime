import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  readInstructions,
  writeInstructions,
  type InstructionsReadResponse,
} from "@/lib/api/instructions";
import { useSettingsDraft } from "../../_layout/useSettingsDraft";
import { SettingsUnsavedChangesDialog } from "../../_layout/SettingsUnsavedChangesDialog";
import {
  SettingsAction,
  SettingsPageBody,
  SettingsPageHeader,
} from "../../SettingsPrimitives";

export function InstructionsEditor({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation("settings");
  const [snapshot, setSnapshot] = useState<InstructionsReadResponse | null>(
    null,
  );
  const [contents, setContents] = useState("");
  const [error, setError] = useState<"load" | "save" | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [reloadPending, setReloadPending] = useState(false);
  const alive = useRef(false);
  const busy = useRef(false);
  const editor = useRef<HTMLTextAreaElement>(null);
  const dirty = snapshot !== null && snapshot.contents !== contents;
  const oversized = new TextEncoder().encode(contents).length > 32 * 1024;
  useSettingsDraft({ dirty, saving });
  async function load() {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    setError(null);
    try {
      const result = await readInstructions();
      if (alive.current) {
        setSnapshot(result);
        setContents(result.contents);
        setSaved(false);
      }
    } catch {
      if (alive.current) setError("load");
    } finally {
      busy.current = false;
      if (alive.current) setLoading(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, []);
  async function save() {
    if (!snapshot || !dirty || oversized || busy.current) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    const submitted = contents;
    try {
      const result = await writeInstructions(submitted, snapshot.revision);
      if (alive.current) {
        setSnapshot(result);
        setContents((current) =>
          current === submitted ? result.contents : current,
        );
        setSaved(true);
      }
    } catch {
      if (alive.current) setError("save");
    } finally {
      busy.current = false;
      if (alive.current) setSaving(false);
    }
  }
  return (
    <SettingsPageBody data-testid="settings-instructions-editor">
      <SettingsPageHeader
        title={t("settings.personalization.instructions")}
        actions={
          <SettingsAction
            data-testid="settings-instructions-back"
            type="button"
            disabled={saving}
            onClick={() => (dirty ? setLeaving(true) : onBack())}
          >
            <ArrowLeft aria-hidden="true" />
            {t("settings.personalization.back")}
          </SettingsAction>
        }
      />
      <div className="flex min-w-0 flex-col gap-3">
        <p className="text-[12px] text-muted-foreground">
          {t("settings.personalization.instructionsDescription")}
        </p>
        {snapshot ? (
          <code className="break-all text-[12px] text-muted-foreground">
            {snapshot.path}
          </code>
        ) : null}
        {snapshot?.hasOverride ? (
          <p role="status" className="rounded-lg bg-muted p-3 text-[12px]">
            {t("settings.personalization.overrideWarning")}
          </p>
        ) : null}
        {loading ? (
          <p role="status">{t("settings.personalization.loading")}</p>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="text-[13px] text-[color:var(--lime-danger,hsl(var(--destructive)))]"
          >
            {t(
              `settings.personalization.${error === "load" ? "instructionsLoadFailed" : "instructionsSaveFailed"}`,
            )}
          </p>
        ) : null}
        {snapshot ? (
          <textarea
            ref={editor}
            aria-label={t("settings.personalization.instructions")}
            spellCheck={false}
            disabled={loading}
            value={contents}
            onChange={(event) => {
              setContents(event.target.value);
              setSaved(false);
            }}
            onKeyDown={(event) => {
              if (
                (event.metaKey || event.ctrlKey) &&
                event.key.toLowerCase() === "s" &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void save();
              }
            }}
            className="min-h-[360px] w-full resize-y rounded-xl border border-border bg-background p-4 font-mono text-[13px] leading-6 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        ) : null}
        {oversized ? (
          <p
            role="alert"
            className="text-[12px] text-[color:var(--lime-danger,hsl(var(--destructive)))]"
          >
            {t("settings.personalization.tooLarge")}
          </p>
        ) : null}
        <div className="flex items-center justify-end gap-3">
          {saved && !dirty ? (
            <span role="status" className="text-[12px] text-muted-foreground">
              {t("settings.personalization.saved")}
            </span>
          ) : null}
          {error ? (
            <SettingsAction
              type="button"
              disabled={loading || saving}
              onClick={() => {
                if (dirty) {
                  setReloadPending(true);
                  setLeaving(true);
                } else void load();
              }}
            >
              {t("settings.personalization.reload")}
            </SettingsAction>
          ) : null}
          <SettingsAction
            type="button"
            disabled={!dirty || loading || saving || oversized}
            aria-busy={saving}
            onClick={() => void save()}
          >
            {t(`settings.personalization.${saving ? "saving" : "save"}`)}
          </SettingsAction>
        </div>
      </div>
      <SettingsUnsavedChangesDialog
        pendingNavigation={leaving}
        saving={saving}
        onClearPendingNavigation={() => {
          setLeaving(false);
          setReloadPending(false);
        }}
        onDiscardChanges={() => {
          setLeaving(false);
          if (reloadPending) {
            setReloadPending(false);
            void load();
          } else onBack();
        }}
      />
    </SettingsPageBody>
  );
}
