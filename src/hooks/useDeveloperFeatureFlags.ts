import { useEffect, useState } from "react";
import { getConfig, subscribeAppConfigChanged } from "@/lib/api/appConfig";
import { resolveWorkspaceHarnessEnabled } from "@/lib/developerFeatures";

interface UseDeveloperFeatureFlagsResult {
  workspaceHarnessEnabled: boolean;
}

export function useDeveloperFeatureFlags(): UseDeveloperFeatureFlagsResult {
  const [workspaceHarnessEnabled, setWorkspaceHarnessEnabled] = useState(() =>
    resolveWorkspaceHarnessEnabled(),
  );

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
        setWorkspaceHarnessEnabled(resolveWorkspaceHarnessEnabled(config));
      } catch (error) {
        console.error("加载开发者功能开关失败:", error);
        if (active) {
          setWorkspaceHarnessEnabled(resolveWorkspaceHarnessEnabled());
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
