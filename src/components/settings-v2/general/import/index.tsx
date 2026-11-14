import { useEffect, useState } from "react";
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
import { importCodexSkills } from "@/lib/api/externalAgentImport";
import { readCodexSettings } from "@/lib/api/codexSettingsImport";
import { CodexChatImportSection } from "./CodexChatImportSection";
import { updateConfig } from "@/lib/api/appConfig";
import { ensureProjectWorkspace } from "@/lib/api/project";
import {
  clearImportHistory,
  recordImport,
  useImportHistory,
} from "@/lib/importHistory";
import {
  setImportAutoSyncEnabled,
  useImportAutoSyncEnabled,
} from "@/lib/importAutoSync";

export function ImportSettings() {
  const { t } = useTranslation("settings");
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [importingSettings, setImportingSettings] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [importingProjects, setImportingProjects] = useState(false);
  const [projectsMessage, setProjectsMessage] = useState<string | null>(null);
  const history = useImportHistory();
  const autoSync = useImportAutoSyncEnabled();
  useEffect(() => {
    if (!autoSync) return;
    const timer = window.setInterval(() => {
      void importCodexSkills()
        .then((result) => {
          if (result.imported.length > 0) {
            recordImport({
              kind: "skills",
              summary: result.imported.join(", "),
            });
          }
        })
        .catch(() => undefined);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [autoSync]);

  return (
    <SettingsPageBody>
      <div>
        <SettingsPageHeader title={t("settings.import.title")} />
        <p className="mt-2 text-[13px] text-muted-foreground">
          {t("settings.import.description")}
        </p>
      </div>
      <SettingsSection>
        <SettingsGroup>
          <SettingsRow
            label={t("settings.import.autoSync")}
            description={t("settings.import.autoSyncDescription")}
            targetId="import-auto-sync"
          >
            <SettingsSwitch
              aria-checked={autoSync}
              checked={autoSync}
              onCheckedChange={setImportAutoSyncEnabled}
            />
          </SettingsRow>
          <SettingsRow
            label={t("settings.import.codexSkills")}
            description={t("settings.import.codexSkillsDescription")}
            targetId="import-codex-skills"
          >
            <div className="flex min-w-0 flex-col items-end gap-1">
              <SettingsAction
                type="button"
                disabled={running}
                onClick={async () => {
                  setRunning(true);
                  setMessage(null);
                  try {
                    const result = await importCodexSkills();
                    if (result.imported.length > 0) {
                      recordImport({
                        kind: "skills",
                        summary: result.imported.join(", "),
                      });
                    }
                    setMessage(
                      result.imported.length > 0
                        ? t("settings.import.done", {
                            count: result.imported.length,
                          })
                        : result.detected > 0
                          ? t("settings.import.alreadyImported", {
                              count: result.skipped.length,
                            })
                          : t("settings.import.none"),
                    );
                  } catch {
                    setMessage(t("settings.import.failed"));
                  } finally {
                    setRunning(false);
                  }
                }}
              >
                {running
                  ? t("settings.import.running")
                  : t("settings.import.action")}
              </SettingsAction>
              {message ? (
                <span
                  role="status"
                  className="max-w-[280px] text-right text-[11px] text-muted-foreground"
                >
                  {message}
                </span>
              ) : null}
            </div>
          </SettingsRow>
        </SettingsGroup>
      </SettingsSection>
      <CodexChatImportSection />
      <SettingsSection title={t("settings.import.settingsTitle")}>
        <SettingsGroup>
          <SettingsRow
            label={t("settings.import.codexSettings")}
            description={t("settings.import.codexSettingsDescription")}
            targetId="import-codex-settings"
          >
            <div className="flex min-w-0 flex-col items-end gap-1">
              <SettingsAction
                type="button"
                disabled={importingSettings}
                onClick={async () => {
                  setImportingSettings(true);
                  setSettingsMessage(null);
                  try {
                    const snapshot = await readCodexSettings();
                    if (!snapshot) {
                      setSettingsMessage(t("settings.import.settingsNone"));
                      return;
                    }
                    const report = await updateConfig((current) => {
                      const projects = { ...(current.projects ?? {}) };
                      for (const project of snapshot.projects) {
                        projects[project] ??= { trust_level: "trusted" };
                      }
                      return {
                        ...current,
                        approval_policy:
                          current.approval_policy ??
                          (snapshot.approvalPolicy as typeof current.approval_policy),
                        sandbox_mode:
                          current.sandbox_mode ??
                          (snapshot.sandboxMode as typeof current.sandbox_mode),
                        projects,
                      };
                    });
                    const projectCount = snapshot.projects.filter(
                      (project) =>
                        project in ((report.projects ?? {}) as object),
                    ).length;
                    recordImport({
                      kind: "settings",
                      summary: t("settings.import.settingsDone", {
                        count: projectCount,
                      }),
                    });
                    setSettingsMessage(
                      t("settings.import.settingsDone", {
                        count: projectCount,
                      }),
                    );
                  } catch {
                    setSettingsMessage(t("settings.import.settingsFailed"));
                  } finally {
                    setImportingSettings(false);
                  }
                }}
              >
                {importingSettings
                  ? t("settings.import.running")
                  : t("settings.import.settingsAction")}
              </SettingsAction>
              {settingsMessage ? (
                <span
                  role="status"
                  className="max-w-[280px] text-right text-[11px] text-muted-foreground"
                >
                  {settingsMessage}
                </span>
              ) : null}
            </div>
          </SettingsRow>
        </SettingsGroup>
      </SettingsSection>
      <SettingsSection title={t("settings.import.projectsTitle")}>
        <SettingsGroup>
          <SettingsRow
            label={t("settings.import.codexProjects")}
            description={t("settings.import.codexProjectsDescription")}
            targetId="import-codex-projects"
          >
            <div className="flex min-w-0 flex-col items-end gap-1">
              <SettingsAction
                type="button"
                disabled={importingProjects}
                onClick={async () => {
                  setImportingProjects(true);
                  setProjectsMessage(null);
                  try {
                    const snapshot = await readCodexSettings();
                    if (!snapshot || snapshot.projects.length === 0) {
                      setProjectsMessage(t("settings.import.projectsNone"));
                      return;
                    }
                    let count = 0;
                    for (const rootPath of snapshot.projects) {
                      const name =
                        rootPath
                          .replace(/\\/g, "/")
                          .split("/")
                          .filter(Boolean)
                          .pop() || rootPath;
                      try {
                        await ensureProjectWorkspace({ name, rootPath });
                        count += 1;
                      } catch {
                        // Keep importing the remaining projects.
                      }
                    }
                    if (count > 0) {
                      recordImport({
                        kind: "projects",
                        summary: t("settings.import.projectsDone", { count }),
                      });
                    }
                    setProjectsMessage(
                      t("settings.import.projectsDone", { count }),
                    );
                  } catch {
                    setProjectsMessage(t("settings.import.projectsFailed"));
                  } finally {
                    setImportingProjects(false);
                  }
                }}
              >
                {importingProjects
                  ? t("settings.import.running")
                  : t("settings.import.projectsAction")}
              </SettingsAction>
              {projectsMessage ? (
                <span
                  role="status"
                  className="max-w-[280px] text-right text-[11px] text-muted-foreground"
                >
                  {projectsMessage}
                </span>
              ) : null}
            </div>
          </SettingsRow>
        </SettingsGroup>
      </SettingsSection>
      <SettingsSection title={t("settings.import.historyTitle")}>
        {history.length > 0 ? (
          <div className="flex justify-end">
            <SettingsAction type="button" onClick={clearImportHistory}>
              {t("settings.import.historyClear")}
            </SettingsAction>
          </div>
        ) : null}
        {history.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">
            {t("settings.import.historyEmpty")}
          </p>
        ) : (
          <SettingsGroup>
            {history.map((entry) => (
              <SettingsRow
                key={entry.id}
                label={t(`settings.import.historyKind.${entry.kind}`)}
                description={entry.summary}
                targetId={`import-history-${entry.id}`}
              >
                <span className="text-[11px] text-muted-foreground">
                  {new Date(entry.createdAt).toLocaleString()}
                </span>
              </SettingsRow>
            ))}
          </SettingsGroup>
        )}
      </SettingsSection>
    </SettingsPageBody>
  );
}
