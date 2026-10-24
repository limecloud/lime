import { useEffect, useState } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { LocalEnvironmentResult } from "../../../../../packages/app-server-client/src/protocol";
import {
  listProjects,
  ensureProjectWorkspace,
  type Project,
} from "@/lib/api/project";
import { open } from "@/lib/desktop-host/dialog";
import { localEnvironments } from "@/lib/api/localEnvironments";
import {
  nextEnvironmentConfigPath,
  partitionLocalEnvironments,
} from "@/lib/localEnvironments";
import {
  SettingsAction,
  SettingsEmptyState,
  SettingsGroup,
  SettingsPageBody,
  SettingsPageHeader,
} from "../../SettingsPrimitives";
import { LocalEnvironmentEditor } from "./LocalEnvironmentEditor";
import { LocalEnvironmentDetails } from "./LocalEnvironmentDetails";

const rowClass =
  "flex w-full min-w-0 items-center justify-between gap-3 border-b border-border px-3 py-3 text-left text-[13px] last:border-b-0 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

export function LocalEnvironmentsSettings() {
  const { t } = useTranslation("settings");
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setFailed(false);
    void listProjects()
      .then((result) => {
        if (current) setProjects(result.filter((entry) => !entry.isArchived));
      })
      .catch(() => {
        if (current) setFailed(true);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [refresh]);
  const addProject = async () => {
    if (adding) return;
    setAdding(true);
    setFailed(false);
    try {
      const rootPath = await open({
        directory: true,
        multiple: false,
        title: t("settings.localEnvironments.addProject"),
      });
      if (!rootPath) return;
      const name =
        rootPath
          .replace(/[\\/]+$/, "")
          .split(/[\\/]/)
          .pop() || rootPath;
      const added = await ensureProjectWorkspace({ rootPath, name });
      setProject(added);
      setRefresh((value) => value + 1);
    } catch {
      setFailed(true);
    } finally {
      setAdding(false);
    }
  };
  if (project)
    return (
      <ProjectEnvironments
        key={project.id}
        project={project}
        onBack={() => setProject(null)}
      />
    );
  return (
    <SettingsPageBody
      data-testid="local-environments-settings"
      aria-busy={loading || adding}
    >
      <SettingsPageHeader
        title={t("settings.localEnvironments.title")}
        actions={
          <SettingsAction disabled={adding} onClick={() => void addProject()}>
            <Plus />
            {t("settings.localEnvironments.addProject")}
          </SettingsAction>
        }
      />
      <p
        data-settings-search-target="local-environments-projects"
        tabIndex={-1}
        aria-label={t("settings.localEnvironments.title")}
        className="text-[13px] text-muted-foreground"
      >
        {t("settings.localEnvironments.description")}
      </p>
      {loading ? (
        <p role="status">{t("settings.localEnvironments.loading")}</p>
      ) : null}
      {failed ? (
        <div role="alert" className="text-destructive">
          {t("settings.localEnvironments.error.load")}{" "}
          <SettingsAction onClick={() => setRefresh((value) => value + 1)}>
            {t("settings.localEnvironments.reload")}
          </SettingsAction>
        </div>
      ) : null}
      {!loading && !failed ? (
        <SettingsGroup>
          {projects.map((entry) => (
            <button
              type="button"
              key={entry.id}
              className={rowClass}
              onClick={() => setProject(entry)}
            >
              <span className="min-w-0">
                <span className="block truncate">{entry.name}</span>
                <span className="block truncate text-[12px] text-muted-foreground">
                  {entry.rootPath}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
            </button>
          ))}
          {!projects.length ? (
            <SettingsEmptyState>
              {t("settings.localEnvironments.noProjects")}
            </SettingsEmptyState>
          ) : null}
        </SettingsGroup>
      ) : null}
    </SettingsPageBody>
  );
}

function ProjectEnvironments({
  project,
  onBack,
}: {
  project: Project;
  onBack: () => void;
}) {
  const { t } = useTranslation("settings");
  const [entries, setEntries] = useState<LocalEnvironmentResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [showInherited, setShowInherited] = useState(false);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setFailed(false);
    void localEnvironments
      .list(project.rootPath)
      .then((result) => {
        if (current) setEntries(result.environments);
      })
      .catch(() => {
        if (current) setFailed(true);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [project.rootPath, refresh]);
  const finishEditing = () => {
    setSelected(editing);
    setEditing(null);
    setRefresh((value) => value + 1);
  };
  if (editing)
    return (
      <LocalEnvironmentEditor
        key={editing}
        configPath={editing}
        defaultName={project.name}
        onBack={() => setEditing(null)}
        onSaved={finishEditing}
      />
    );
  if (selected)
    return (
      <LocalEnvironmentDetails
        key={selected}
        configPath={selected}
        onBack={() => setSelected(null)}
        onEdit={() => setEditing(selected)}
      />
    );
  const nextPath = nextEnvironmentConfigPath(entries, project.rootPath);
  const { projectEnvironments, inheritedEnvironments } =
    partitionLocalEnvironments(entries, project.rootPath);
  const renderEnvironment = (entry: LocalEnvironmentResult) => (
    <button
      type="button"
      key={entry.configPath}
      data-testid="local-environment-row"
      className={rowClass}
      onClick={() => setSelected(entry.configPath)}
    >
      <span className="min-w-0">
        <span className="block truncate">
          {entry.type === "success"
            ? entry.environment.name
            : t("settings.localEnvironments.error.invalid")}
        </span>
        <span className="block truncate text-[12px] text-muted-foreground">
          {entry.configPath}
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
    </button>
  );
  return (
    <SettingsPageBody data-testid="project-environments" aria-busy={loading}>
      <SettingsPageHeader
        title={project.name}
        actions={
          <div className="flex gap-2">
            <SettingsAction onClick={onBack}>
              {t("settings.localEnvironments.back")}
            </SettingsAction>
            <SettingsAction
              disabled={loading || failed}
              onClick={() => setEditing(nextPath)}
            >
              {t("settings.localEnvironments.create")}
            </SettingsAction>
          </div>
        }
      />
      <p
        data-settings-search-target="local-environments-projects"
        tabIndex={-1}
        aria-label={t("settings.localEnvironments.title")}
        className="text-[13px] text-muted-foreground"
      >
        {t("settings.localEnvironments.description")}
      </p>
      {loading ? (
        <p role="status">{t("settings.localEnvironments.loading")}</p>
      ) : null}
      {failed ? (
        <div role="alert" className="text-destructive">
          {t("settings.localEnvironments.error.load")}{" "}
          <SettingsAction onClick={() => setRefresh((value) => value + 1)}>
            {t("settings.localEnvironments.reload")}
          </SettingsAction>
        </div>
      ) : null}
      {!loading && !failed ? (
        <SettingsGroup>
          {projectEnvironments.map(renderEnvironment)}
          {!projectEnvironments.length ? (
            <SettingsEmptyState>
              {t("settings.localEnvironments.noEnvironments")}
            </SettingsEmptyState>
          ) : null}
        </SettingsGroup>
      ) : null}
      {!loading && !failed && inheritedEnvironments.length ? (
        <section>
          <SettingsAction
            aria-expanded={showInherited}
            onClick={() => setShowInherited((value) => !value)}
          >
            {t(
              showInherited
                ? "settings.localEnvironments.hideInherited"
                : "settings.localEnvironments.showInherited",
              { count: inheritedEnvironments.length },
            )}
          </SettingsAction>
          {showInherited ? (
            <SettingsGroup className="mt-3">
              {inheritedEnvironments.map(renderEnvironment)}
            </SettingsGroup>
          ) : null}
        </section>
      ) : null}
    </SettingsPageBody>
  );
}
