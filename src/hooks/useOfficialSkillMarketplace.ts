import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useTranslation } from "react-i18next";
import {
  cloudAccountIdentity,
  getCloudAccount,
  subscribeCloudAccount,
} from "@/lib/cloudAccount";
import {
  listOfficialSkillMarketplace,
  type SkillMarketplaceItem,
} from "@/lib/api/officialSkillMarketplace";

interface UseOfficialSkillMarketplaceResult {
  skills: SkillMarketplaceItem[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useOfficialSkillMarketplace(
  enabled = true,
): UseOfficialSkillMarketplaceResult {
  const { i18n } = useTranslation("agent");
  const language = i18n.language;
  const identity = useSyncExternalStore(
    subscribeCloudAccount,
    () => cloudAccountIdentity(getCloudAccount()),
    () => null,
  );
  const pending = useRef<symbol | null>(null);
  const [skills, setSkills] = useState<SkillMarketplaceItem[]>([]);
  const [isLoading, setIsLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const request = Symbol();
    pending.current = request;
    if (!enabled) {
      setSkills([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const nextSkills = await listOfficialSkillMarketplace({
        sort: "default",
      });
      if (
        pending.current !== request ||
        identity !== cloudAccountIdentity(getCloudAccount())
      )
        return;
      setSkills(nextSkills);
      setError(null);
    } catch (reason) {
      if (
        pending.current !== request ||
        identity !== cloudAccountIdentity(getCloudAccount())
      )
        return;
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (pending.current === request) setIsLoading(false);
    }
  }, [enabled, identity, language]);

  useEffect(() => {
    setSkills([]);
    void refresh();
    return () => {
      pending.current = null;
    };
  }, [refresh]);

  return { skills, isLoading, error, refresh };
}
