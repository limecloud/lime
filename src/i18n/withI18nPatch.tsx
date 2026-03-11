/**
 * withI18nPatch Higher-Order Component
 *
 * HOC that wraps a component with I18nPatchProvider.
 * Loads the language config from Tauri and passes it to the provider.
 *
 * This HOC is used to wrap the root App component, enabling
 * the Patch Layer architecture for the entire application.
 *
 * Features:
 * - Loads language config from Tauri backend
 * - Handles loading state
 * - Applies fade-in transition to prevent text flashing
 * - Falls back to default language in non-Tauri environments
 */

import React, { useEffect, useState } from "react";
import { getConfig, type Config } from "@/lib/api/appConfig";
import { I18nPatchProvider } from "./I18nPatchProvider";
import { Language } from "./text-map";
import { replaceTextInDOM } from "./dom-replacer";

/**
 * 检查是否在 Tauri 环境中运行
 */
function isTauriEnvironment(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as any;
  return !!(w.__TAURI__?.core?.invoke || w.__TAURI__?.invoke);
}

interface WithI18nPatchOptions {
  /** Fade-in duration in milliseconds (default: 150ms) */
  fadeInDuration?: number;
}

/**
 * Higher-Order Component that adds i18n patch support
 *
 * @param Component - The component to wrap
 * @param options - Configuration options
 * @returns A new component with i18n patch support
 */
export function withI18nPatch<P extends object>(
  Component: React.ComponentType<P>,
  options: WithI18nPatchOptions = {},
): React.ComponentType<P> {
  const { fadeInDuration = 150 } = options;

  return function PatchedComponent(props: P) {
    const [config, setConfig] = useState<Config | null>(null);
    const [isReady, setIsReady] = useState(false);

    useEffect(() => {
      // 如果不在 Tauri 环境，使用默认配置
      if (!isTauriEnvironment()) {
        console.warn("[i18n] Not in Tauri environment, using default language");
        const defaultConfig = { language: "zh" } as Config;
        setConfig(defaultConfig);
        replaceTextInDOM("zh");
        requestAnimationFrame(() => {
          setIsReady(true);
        });
        return;
      }

      getConfig()
        .then((c) => {
          setConfig(c);
          // Apply initial patch immediately (synchronous)
          const lang = (c.language || "zh") as Language;
          replaceTextInDOM(lang);
          // Fade in after patch is complete
          requestAnimationFrame(() => {
            setIsReady(true);
          });
        })
        .catch((err) => {
          console.error("[i18n] Failed to load config:", err);
          // Use default language on error
          const defaultConfig = { language: "zh" } as Config;
          setConfig(defaultConfig);
          replaceTextInDOM("zh");
          requestAnimationFrame(() => {
            setIsReady(true);
          });
        });
    }, []);

    if (!config) {
      // Return null or minimal loading state
      return null;
    }

    return (
      <div
        style={{
          opacity: isReady ? 1 : 0,
          transition: `opacity ${fadeInDuration}ms ease-in`,
        }}
      >
        <I18nPatchProvider
          initialLanguage={(config.language || "zh") as Language}
        >
          <Component {...props} />
        </I18nPatchProvider>
      </div>
    );
  };
}
