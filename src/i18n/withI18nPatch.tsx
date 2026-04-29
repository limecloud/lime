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
import { StartupLoadingScreen } from "./StartupLoadingScreen";
import { Language } from "./text-map";
import { hasTauriInvokeCapability } from "@/lib/tauri-runtime";

const CONFIG_LOAD_TIMEOUT_MS = 2500;
const READY_COMMIT_TIMEOUT_MS = 48;

/**
 * 检查是否在 Tauri 环境中运行
 */
function isTauriEnvironment(): boolean {
  return hasTauriInvokeCapability();
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
      let cancelled = false;
      let timeoutId: number | null = null;
      let readyCommitTimeoutId: number | null = null;
      let readyRafId: number | null = null;

      const markReady = () => {
        if (cancelled) {
          return;
        }
        setIsReady(true);
      };

      const applyConfig = (nextConfig: Config) => {
        if (cancelled) {
          return;
        }

        setConfig(nextConfig);

        if (typeof window.requestAnimationFrame === "function") {
          readyCommitTimeoutId = window.setTimeout(() => {
            if (
              readyRafId !== null &&
              typeof window.cancelAnimationFrame === "function"
            ) {
              window.cancelAnimationFrame(readyRafId);
            }
            readyRafId = null;
            markReady();
          }, READY_COMMIT_TIMEOUT_MS);

          readyRafId = window.requestAnimationFrame(() => {
            if (readyCommitTimeoutId !== null) {
              window.clearTimeout(readyCommitTimeoutId);
              readyCommitTimeoutId = null;
            }
            readyRafId = null;
            markReady();
          });
          return;
        }

        markReady();
      };

      const fallbackToDefault = (reason: string, error?: unknown) => {
        if (error) {
          console.error(`[i18n] ${reason}:`, error);
        } else {
          console.warn(`[i18n] ${reason}`);
        }
        applyConfig({ language: "zh" } as Config);
      };

      // 如果不在 Tauri 环境，使用默认配置
      if (!isTauriEnvironment()) {
        applyConfig({ language: "zh" } as Config);
        return () => {
          cancelled = true;
        };
      }

      timeoutId = window.setTimeout(() => {
        fallbackToDefault("Config load timed out, using default language");
      }, CONFIG_LOAD_TIMEOUT_MS);

      getConfig()
        .then((c) => {
          if (timeoutId !== null) {
            window.clearTimeout(timeoutId);
            timeoutId = null;
          }
          applyConfig(c);
        })
        .catch((err) => {
          if (timeoutId !== null) {
            window.clearTimeout(timeoutId);
            timeoutId = null;
          }
          fallbackToDefault("Failed to load config", err);
        });

      return () => {
        cancelled = true;
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
        }
        if (readyCommitTimeoutId !== null) {
          window.clearTimeout(readyCommitTimeoutId);
        }
        if (
          readyRafId !== null &&
          typeof window.cancelAnimationFrame === "function"
        ) {
          window.cancelAnimationFrame(readyRafId);
        }
      };
    }, []);

    if (!config) {
      return <StartupLoadingScreen />;
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
