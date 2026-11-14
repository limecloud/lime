import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ensureSshConfig,
  listSshConnections,
  removeSshConnection,
  type SshConnection,
} from "@/lib/api/sshConnections";
import { openIn } from "@/lib/api/openIn";
import {
  listConnectionGrants,
  type ConnectionGrant,
} from "@/lib/api/connections";
import { formatDate } from "@/i18n/format";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SshConnectionDialog } from "./SshConnectionDialog";
import {
  SettingsAction,
  SettingsEmptyState,
  SettingsGroup,
  SettingsLoading,
  SettingsPageBody,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
} from "../../SettingsPrimitives";

function connectionTarget(connection: SshConnection): string {
  const user = connection.user ? `${connection.user}@` : "";
  const port = connection.port ? `:${connection.port}` : "";
  return `${user}${connection.hostName}${port}`;
}

export function ConnectionsSettings() {
  const { t } = useTranslation("settings");
  const [connections, setConnections] = useState<SshConnection[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [openError, setOpenError] = useState(false);
  const [removeError, setRemoveError] = useState(false);
  const [grants, setGrants] = useState<ConnectionGrant[] | null>(null);
  const [grantsError, setGrantsError] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<SshConnection | null>(
    null,
  );
  const [addOpen, setAddOpen] = useState(false);

  const load = async () => {
    setLoadError(false);
    try {
      setConnections(await listSshConnections());
    } catch {
      setLoadError(true);
    }
  };

  const loadGrants = async () => {
    setGrantsError(false);
    try {
      setGrants(await listConnectionGrants());
    } catch {
      setGrantsError(true);
    }
  };

  useEffect(() => {
    void load();
    void loadGrants();
  }, []);

  const confirmRemove = async () => {
    if (!pendingRemove) return;
    const alias = pendingRemove.alias;
    setPendingRemove(null);
    setRemoveError(false);
    try {
      const removed = await removeSshConnection(alias);
      if (!removed) setRemoveError(true);
      else await load();
    } catch {
      setRemoveError(true);
    }
  };

  const openConfig = async () => {
    setOpenError(false);
    try {
      const configPath = await ensureSshConfig();
      await openIn.open({
        target: "systemDefault",
        path: configPath,
        openMode: "file",
      });
    } catch {
      setOpenError(true);
    }
  };

  if (connections === null && !loadError) return <SettingsLoading />;

  return (
    <SettingsPageBody>
      <SettingsPageHeader title={t("settings.connections.title")} />
      <SettingsSection
        data-settings-search-target="connections-grants"
        tabIndex={-1}
        title={t("settings.connections.external.title")}
      >
        <p className="mb-3 text-xs text-muted-foreground">
          {t("settings.connections.external.description")}
        </p>
        {grants === null && !grantsError ? (
          <div
            role="status"
            aria-busy="true"
            data-testid="settings-connections-grants-loading"
            className="px-4 py-6 text-center text-xs text-muted-foreground"
          >
            {t("settings.connections.external.loading")}
          </div>
        ) : grantsError ? (
          <div
            role="alert"
            data-testid="settings-connections-grants-error"
            className="flex items-center gap-3 px-4 py-6 text-[12px] text-destructive"
          >
            {t("settings.connections.external.loadFailed")}
            <SettingsAction type="button" onClick={() => void loadGrants()}>
              {t("settings.connections.external.retry")}
            </SettingsAction>
          </div>
        ) : grants && grants.length > 0 ? (
          <SettingsGroup>
            {grants.map((grant) => (
              <SettingsRow
                key={grant.id}
                targetId={`connection-grant-${grant.id}`}
                label={grant.applicationName?.trim() || grant.applicationId}
                description={
                  <>
                    {t("settings.connections.external.fileCount", {
                      count: grant.fileCount,
                    })}
                    {" · "}
                    {t("settings.connections.external.expires", {
                      date: formatDate(grant.expiresAt, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }),
                    })}
                  </>
                }
              >
                <span className="text-[12px] text-muted-foreground">
                  {t("settings.connections.external.statusActive")}
                </span>
              </SettingsRow>
            ))}
          </SettingsGroup>
        ) : (
          <SettingsEmptyState data-testid="settings-connections-grants-empty">
            {t("settings.connections.external.empty")}
          </SettingsEmptyState>
        )}
      </SettingsSection>
      <SettingsSection
        data-settings-search-target="connections-ssh"
        tabIndex={-1}
        title={t("settings.connections.description")}
        actions={
          <div className="flex items-center gap-2">
            <SettingsAction type="button" onClick={() => void openConfig()}>
              {t("settings.connections.openConfig")}
            </SettingsAction>
            <SettingsAction type="button" onClick={() => setAddOpen(true)}>
              {t("settings.connections.add")}
            </SettingsAction>
          </div>
        }
      >
        <p className="mb-3 text-xs text-muted-foreground">
          {t("settings.connections.sectionDescription")}
        </p>
        <SshConnectionDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          onAdded={() => void load()}
        />
        <SettingsGroup>
          {connections && connections.length > 0 ? (
            connections.map((connection) => (
              <SettingsRow
                key={connection.alias}
                targetId={`ssh-connection-${connection.alias}`}
                label={connection.alias}
                description={connectionTarget(connection)}
              >
                <SettingsAction
                  type="button"
                  onClick={() => setPendingRemove(connection)}
                >
                  {t("settings.connections.remove")}
                </SettingsAction>
              </SettingsRow>
            ))
          ) : (
            <SettingsEmptyState>
              {t("settings.connections.empty")}
            </SettingsEmptyState>
          )}
        </SettingsGroup>
        <ConfirmDialog
          isOpen={pendingRemove !== null}
          title={t("settings.connections.removeTitle")}
          message={t("settings.connections.removeMessage", {
            alias: pendingRemove?.alias ?? "",
          })}
          confirmText={t("settings.connections.remove")}
          cancelText={t("settings.connections.cancel")}
          onCancel={() => setPendingRemove(null)}
          onConfirm={() => void confirmRemove()}
        />
        {removeError ? (
          <p role="alert" className="mt-2 text-[12px] text-destructive">
            {t("settings.connections.removeFailed")}
          </p>
        ) : null}
        {openError ? (
          <p role="alert" className="mt-2 text-[12px] text-destructive">
            {t("settings.connections.openFailed")}
          </p>
        ) : null}
        {loadError ? (
          <div
            role="alert"
            className="mt-2 flex items-center gap-3 text-[12px] text-destructive"
          >
            {t("settings.connections.loadFailed")}
            <SettingsAction type="button" onClick={() => void load()}>
              {t("settings.connections.retry")}
            </SettingsAction>
          </div>
        ) : null}
      </SettingsSection>
    </SettingsPageBody>
  );
}
