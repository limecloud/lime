import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { getExpertCatalog, getSeededExpertCatalog } from "@/features/experts";
import {
  cloudAccountIdentity,
  getCloudAccount,
  subscribeCloudAccount,
} from "@/lib/cloudAccount";
import { getLimeI18n } from "@/i18n/createI18n";

/** Published cloud content lives only in this view's memory and identity lifetime. */
export function useExpertCatalog(language: string) {
  const account = useSyncExternalStore(
    subscribeCloudAccount,
    getCloudAccount,
    getCloudAccount,
  );
  const identity = cloudAccountIdentity(account);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState(() => ({
    catalog: getSeededExpertCatalog(),
    identity: null as string | null,
    language,
    loading: false,
    failed: false,
  }));
  useEffect(() => {
    let cancelled = false;
    setState({
      catalog: getSeededExpertCatalog(),
      identity,
      language,
      loading: !!identity,
      failed: false,
    });
    if (identity) {
      void getExpertCatalog()
        .then((catalog) => {
          if (
            !cancelled &&
            cloudAccountIdentity(getCloudAccount()) === identity &&
            getLimeI18n().language === language
          ) {
            setState({
              catalog,
              identity,
              language,
              loading: false,
              failed: false,
            });
          }
        })
        .catch(() => {
          if (!cancelled)
            setState({
              catalog: getSeededExpertCatalog(),
              identity,
              language,
              loading: false,
              failed: true,
            });
        });
    }
    return () => {
      cancelled = true;
    };
  }, [identity, language, attempt]);
  const current = state.identity === identity && state.language === language;
  return {
    catalog: current ? state.catalog : getSeededExpertCatalog(),
    loading: current ? state.loading : !!identity,
    failed: current && state.failed,
    retry: useCallback(() => setAttempt((n) => n + 1), []),
  };
}
