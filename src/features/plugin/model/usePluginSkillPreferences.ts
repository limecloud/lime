import { useEffect, useRef, useState } from "react";
import type { AppServerPluginDetail } from "@/lib/api/appServerTypes";
import { readPlugin, setPluginSkillEnabled } from "@/lib/api/pluginCatalog";
import { cloudAccountIdentityVersion } from "@/lib/cloudAccount";

type PreferenceError = { skillName: string; kind: "save" | "refresh" };
type PreferenceState = {
  input: AppServerPluginDetail;
  accountVersion: number;
  detail: AppServerPluginDetail;
  pending: string | null;
  error: PreferenceError | null;
};

export function usePluginSkillPreferences(
  detail: AppServerPluginDetail,
  accountVersion: number,
) {
  const [state, setState] = useState<PreferenceState | null>(null);
  const current = useRef({ detail, accountVersion });
  current.current = { detail, accountVersion };
  const operation = useRef<symbol | null>(null);
  useEffect(() => {
    operation.current = null;
    return () => {
      operation.current = null;
    };
  }, [detail, accountVersion]);
  const snapshot =
    state?.input === detail && state.accountVersion === accountVersion
      ? state
      : null;
  const projected = snapshot?.detail ?? detail;
  const remoteId = projected.summary.remotePluginId;
  const installed =
    projected.summary.source.type === "remote" &&
    projected.summary.installed &&
    Boolean(remoteId);
  const adminDisabled = projected.summary.availability === "DISABLED_BY_ADMIN";
  // App runtime readiness is not an account's authorization. Keep enabling
  // gated until the current Apps link/connection owner can supply that fact.
  const requiresAppConnection =
    projected.apps.length > 0 ||
    projected.appTemplates.some(
      (template) => (template.materializedAppIds?.length ?? 0) > 0,
    );

  const run = async (
    skillName: string,
    enabled: boolean | null,
  ): Promise<void> => {
    if (!installed || !remoteId || operation.current) return;
    if (enabled !== null) {
      const skill = projected.skills.find((item) => item.name === skillName);
      if (
        !skill ||
        adminDisabled ||
        (enabled && requiresAppConnection) ||
        snapshot?.error?.kind === "refresh"
      )
        return;
    }
    const token = Symbol();
    operation.current = token;
    const isCurrent = () =>
      operation.current === token &&
      current.current.detail === detail &&
      current.current.accountVersion === accountVersion &&
      cloudAccountIdentityVersion() === accountVersion;
    const next: PreferenceState = {
      input: detail,
      accountVersion,
      detail: projected,
      pending: skillName,
      error: null,
    };
    setState(next);
    let saved = enabled === null;
    try {
      if (enabled !== null) {
        await setPluginSkillEnabled({
          path: projected.skills.find(skill => skill.name === skillName)?.path ?? (() => { throw new Error("skill path required"); })(),
          enabled,
        });
        saved = true;
      }
      if (!isCurrent()) return;
      const fresh = await readPlugin({
        remoteMarketplaceName: projected.marketplaceName,
        pluginName: remoteId,
      });
      if (!isCurrent()) return;
      if (
        fresh.plugin.summary.source.type !== "remote" ||
        fresh.plugin.summary.remotePluginId !== remoteId
      )
        throw new Error("plugin preference refresh returned another plugin");
      setState({ ...next, detail: fresh.plugin, pending: null });
    } catch {
      if (isCurrent()) {
        setState({
          ...next,
          pending: null,
          error: { skillName, kind: saved ? "refresh" : "save" },
        });
      }
    } finally {
      if (operation.current === token) operation.current = null;
    }
  };

  return {
    detail: projected,
    installed,
    adminDisabled,
    requiresAppConnection,
    busy: Boolean(snapshot?.pending) || snapshot?.error?.kind === "refresh",
    error: snapshot?.error ?? null,
    setEnabled: (skillName: string, enabled: boolean) =>
      run(skillName, enabled),
    retryRefresh: (skillName: string) => run(skillName, null),
  };
}
