import { useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import {
  configuredCloudOrigin,
  getCloudAccountState,
  logoutCloudAccount,
  readCloudAccountState,
  startCloudAuthorization,
  subscribeCloudAccount,
  type CloudResource,
} from "@/lib/cloudAccount";
import {
  SettingsAction,
  SettingsGroup,
  SettingsPageBody,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
} from "../../SettingsPrimitives";

export function UserCenterSessionSettings() {
  const { t, i18n } = useTranslation("settings");
  const state = useSyncExternalStore(
    subscribeCloudAccount,
    getCloudAccountState,
    getCloudAccountState,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const account = state.account;
  const unresolved = (resource: CloudResource) =>
    state.authorizations.some(
      (a) =>
        a.resource === resource &&
        ["pending", "exchanging", "outcome_unknown"].includes(a.status),
    );
  let configured = false;
  try {
    configured = Boolean(account || configuredCloudOrigin());
  } catch {
    /* Show the unavailable service state. */
  }

  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch {
      setError(t("settings.cloudAccount.requestFailed"));
    } finally {
      setBusy(false);
    }
  };
  const authorize = (resource: CloudResource = "default") =>
    run(() => startCloudAuthorization({ resource, language: i18n.language }));

  return (
    <SettingsPageBody>
      <SettingsPageHeader title={t("settings.cloudAccount.title")} />
      {error ? (
        <p role="alert" className="text-[13px] text-[color:var(--lime-danger)]">
          {error}
        </p>
      ) : null}
      <SettingsSection>
        <SettingsGroup style={{ borderWidth: "0.5px", borderRadius: 8 }}>
          <SettingsRow
            label={
              account?.displayName ||
              account?.email ||
              t("settings.cloudAccount.signedOut")
            }
            description={account?.displayName ? account.email : undefined}
          >
            <SettingsAction
              type="button"
              disabled={
                busy || !configured || (!account && unresolved("default"))
              }
              onClick={() =>
                void (account ? run(logoutCloudAccount) : authorize())
              }
            >
              {t(
                account
                  ? "settings.cloudAccount.signOut"
                  : "settings.cloudAccount.signIn",
              )}
            </SettingsAction>
          </SettingsRow>
        </SettingsGroup>
        {!configured ? (
          <p
            role="status"
            className="mt-3 text-[12px] text-[color:var(--lime-text-muted)]"
          >
            {t("settings.cloudAccount.unconfigured")}
          </p>
        ) : null}
      </SettingsSection>
      {account ? (
        <SettingsSection title={t("settings.cloudAccount.permissions")}>
          <SettingsGroup style={{ borderWidth: "0.5px", borderRadius: 8 }}>
            {(["market", "web", "connections"] as const).map((resource) => {
              const credential = account.resources.find(
                (r) => r.resource === resource,
              );
              const authorization = state.authorizations.find(
                (a) => a.resource === resource,
              );
              const pending =
                authorization &&
                ["pending", "exchanging"].includes(authorization.status);
              return (
                <SettingsRow
                  key={resource}
                  label={t(`settings.cloudAccount.resources.${resource}`)}
                  description={t(
                    `settings.cloudAccount.status.${pending ? "pending" : (credential?.status ?? "disconnected")}`,
                  )}
                >
                  {resource !== "connections" ||
                  account.environment === "sandbox" ? (
                    <SettingsAction
                      type="button"
                      disabled={busy || unresolved(resource)}
                      onClick={() => void authorize(resource)}
                    >
                      {t(
                        credential
                          ? "settings.cloudAccount.reauthorize"
                          : "settings.cloudAccount.authorize",
                      )}
                    </SettingsAction>
                  ) : null}
                </SettingsRow>
              );
            })}
          </SettingsGroup>
        </SettingsSection>
      ) : null}
      {state.authorizations
        .filter((a) => a.status !== "completed")
        .map((authorization) => (
          <SettingsSection key={authorization.id}>
            <SettingsRow
              label={t(
                `settings.cloudAccount.authorization.${authorization.status}`,
              )}
            >
              {!account &&
              authorization.resource === "default" &&
              unresolved("default") ? (
                <SettingsAction
                  type="button"
                  disabled={busy}
                  onClick={() => void run(logoutCloudAccount)}
                >
                  {t("settings.cloudAccount.cancelSignIn")}
                </SettingsAction>
              ) : null}
              <SettingsAction
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(() => readCloudAccountState(authorization.id))
                }
              >
                {t("settings.cloudAccount.checkStatus")}
              </SettingsAction>
            </SettingsRow>
          </SettingsSection>
        ))}
    </SettingsPageBody>
  );
}
