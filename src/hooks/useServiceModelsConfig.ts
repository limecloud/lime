import { useEffect, useState } from "react";
import { getConfig, subscribeAppConfigChanged } from "@/lib/api/appConfig";
import type { ServiceModelsConfig } from "@/lib/api/appConfigTypes";

interface UseServiceModelsConfigResult {
  serviceModels: ServiceModelsConfig;
  loading: boolean;
}

export function useServiceModelsConfig(): UseServiceModelsConfigResult {
  const [serviceModels, setServiceModels] = useState<ServiceModelsConfig>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const load = async (forceRefresh = false) => {
      setLoading(true);
      try {
        const config = await getConfig(
          forceRefresh ? { forceRefresh: true } : undefined,
        );
        if (!active) {
          return;
        }
        setServiceModels(config.workspace_preferences?.service_models ?? {});
      } catch (error) {
        console.error("加载服务模型运行时配置失败:", error);
        if (active) {
          setServiceModels({});
        }
      } finally {
        if (active) {
          setLoading(false);
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
    serviceModels,
    loading,
  };
}
