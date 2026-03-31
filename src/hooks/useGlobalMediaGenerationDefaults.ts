import { useEffect, useState } from "react";
import { getConfig } from "@/lib/api/appConfig";
import type { MediaGenerationDefaults } from "@/lib/mediaGeneration";

interface UseGlobalMediaGenerationDefaultsResult {
  mediaDefaults: MediaGenerationDefaults;
  loading: boolean;
}

export function useGlobalMediaGenerationDefaults(): UseGlobalMediaGenerationDefaultsResult {
  const [mediaDefaults, setMediaDefaults] = useState<MediaGenerationDefaults>(
    {},
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      try {
        const config = await getConfig();
        if (!active) {
          return;
        }
        setMediaDefaults(config.workspace_preferences?.media_defaults ?? {});
      } catch (error) {
        console.error("加载全局媒体默认设置失败:", error);
        if (active) {
          setMediaDefaults({});
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, []);

  return { mediaDefaults, loading };
}

export default useGlobalMediaGenerationDefaults;
