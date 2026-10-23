import { useEffect, useRef, useState } from "react";
import { ChevronRight, Laptop } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  SettingsAction,
  SettingsGroup,
  SettingsPageBody,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
} from "../../SettingsPrimitives";
import { DeleteMemoriesDialog } from "./DeleteMemoriesDialog";
import { InstructionsEditor } from "./InstructionsEditor";
import { useMemorySettings } from "./useMemorySettings";

function DocumentationLink({ href }: { href: string }) {
  const { t } = useTranslation("settings");
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="relative z-10 inline-flex pointer-events-auto text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
    >
      {t("settings.personalization.learnMore")}
    </a>
  );
}

export function MemorySettings({ initialTab }: { initialTab?: string }) {
  const { t } = useTranslation("settings");
  const { memory, error, pending, refresh, save } = useMemorySettings();
  const [editing, setEditing] = useState(initialTab === "instructions");
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const instructions = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (!editing && restoreFocus.current) {
      instructions.current?.focus();
      restoreFocus.current = false;
    }
  }, [editing]);
  if (editing)
    return (
      <InstructionsEditor
        onBack={() => {
          restoreFocus.current = true;
          setEditing(false);
        }}
      />
    );
  const enabled = Boolean(memory?.enabled && memory.auto?.enabled !== false);
  return (
    <SettingsPageBody data-testid="settings-memory-page">
      <SettingsPageHeader title={t("settings.desktop.personalization")} />
      {!memory && !error ? (
        <p role="status">{t("settings.personalization.loading")}</p>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 text-[13px] text-[color:var(--lime-danger,hsl(var(--destructive)))]"
        >
          <span>
            {t(
              `settings.personalization.${error === "load" ? "loadFailed" : "saveFailed"}`,
            )}
          </span>
          <SettingsAction
            type="button"
            disabled={pending}
            onClick={() => void refresh()}
          >
            {t("settings.personalization.retry")}
          </SettingsAction>
        </div>
      ) : null}
      <SettingsSection
        className="[&>header]:min-h-0 [&>header]:pb-0"
        title={t("settings.personalization.memory")}
        actions={
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-[12px]">
            <Laptop className="size-3.5" aria-hidden="true" />
            {t("settings.personalization.localHost")}
          </span>
        }
      >
        <p className="mb-4 text-[12px] leading-4 text-muted-foreground">
          {t("settings.personalization.memoryDescription")}{" "}
          <DocumentationLink href="https://developers.openai.com/codex/memories" />
        </p>
        <SettingsGroup>
          <SettingsRow
            targetId="memory-enabled"
            label={t("settings.personalization.enabled")}
            description={t("settings.personalization.enabledDescription")}
          >
            <SettingsSwitch
              data-testid="settings-memory-toggle"
              aria-labelledby="memory-enabled-label"
              checked={enabled}
              disabled={!memory || pending}
              onCheckedChange={(value) => void save("enabled", value)}
            />
          </SettingsRow>
          <SettingsRow
            targetId="memory-tools"
            label={t("settings.personalization.tools")}
            description={t("settings.personalization.toolsDescription")}
          >
            <SettingsSwitch
              aria-labelledby="memory-tools-label"
              checked={memory?.disable_on_external_context !== true}
              disabled={!memory || pending}
              onCheckedChange={(value) => void save("tools", value)}
            />
          </SettingsRow>
          <SettingsRow
            targetId="memory-delete"
            label={t("settings.personalization.delete")}
            description={t("settings.personalization.deleteRowDescription")}
          >
            <SettingsAction
              type="button"
              style={{
                color: "var(--lime-danger, hsl(var(--destructive)))",
                background:
                  "var(--lime-danger-soft, hsl(var(--destructive) / 0.08))",
              }}
              disabled={pending}
              onClick={() => {
                setDeleted(false);
                setDeleting(true);
              }}
            >
              {t("settings.personalization.deleteAction")}
            </SettingsAction>
          </SettingsRow>
        </SettingsGroup>
        {deleted ? (
          <p role="status" className="mt-3 text-[12px] text-muted-foreground">
            {t("settings.personalization.deleted")}
          </p>
        ) : null}
      </SettingsSection>
      <SettingsSection title={t("settings.personalization.customInstructions")}>
        <SettingsGroup>
          <SettingsRow
            targetId="memory-instructions"
            className="relative [&>.settings-row-copy]:relative [&>.settings-row-copy]:z-10 [&>.settings-row-copy]:pointer-events-none"
            label={t("settings.personalization.instructions")}
            description={
              <>
                {t("settings.personalization.instructionsDescription")}{" "}
                <DocumentationLink href="https://developers.openai.com/codex/guides/agents-md" />
              </>
            }
          >
            <button
              ref={instructions}
              data-testid="settings-instructions-open"
              type="button"
              aria-label={t("settings.personalization.editInstructions")}
              onClick={() => setEditing(true)}
              className="absolute inset-0 z-0 cursor-pointer bg-transparent hover:bg-muted/30 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
            />
            <ChevronRight
              className="relative z-10 size-3.5 pointer-events-none text-muted-foreground"
              aria-hidden="true"
            />
          </SettingsRow>
        </SettingsGroup>
      </SettingsSection>
      <DeleteMemoriesDialog
        open={deleting}
        onOpenChange={setDeleting}
        onDeleted={() => setDeleted(true)}
      />
    </SettingsPageBody>
  );
}
