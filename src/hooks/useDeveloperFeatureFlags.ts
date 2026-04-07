import { useEffect, useState } from "react";
import { getConfig, subscribeAppConfigChanged } from "@/lib/api/appConfig";
import { isWorkspaceHarnessEnabled } from "@/lib/developerFeatures";

interface UseDeveloperFeatureFlagsResult {
  workspaceHarnessEnabled: boolean;
}

export function useDeveloperFeatureFlags(): UseDeveloperFeatureFlagsResult {
  const [workspaceHarnessEnabled, setWorkspaceHarnessEnabled] = useState(false);

  useEffect(() => {
    let active = true;

    const load = async (forceRefresh = false) => {
      try {
        const config = await getConfig(
          forceRefresh ? { forceRefresh: true } : undefined,
        );
        if (!active) {
          return;
        }
        setWorkspaceHarnessEnabled(isWorkspaceHarnessEnabled(config));
      } catch (error) {
        console.error("加载开发者功能开关失败:", error);
        if (active) {
          setWorkspaceHarnessEnabled(false);
        }
      }
    };

    void load();

    const unsubscribe = subscribeAppConfigChanged(() => {
      void load(true);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return {
    workspaceHarnessEnabled,
  };
}
