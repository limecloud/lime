import { useEffect } from "react";
import { toast } from "sonner";
import { getWindowsStartupDiagnostics } from "@/lib/api/serverRuntime";
import { ensureDefaultWorkspaceReady } from "@/lib/api/project";
import { showRegistryLoadError } from "@/lib/utils/connectError";
import { recordWorkspaceRepair } from "@/lib/workspaceHealthTelemetry";
import { hasTauriInvokeCapability } from "@/lib/tauri-runtime";
import type { Page } from "@/types/page";

function isTauriDesktopEnvironment(): boolean {
  return hasTauriInvokeCapability();
}

function isWindowsNavigatorPlatform(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }

  const platform = navigator.platform || "";
  const userAgent = navigator.userAgent || "";
  return /win/i.test(platform) || /windows/i.test(userAgent);
}

interface UseAppStartupEffectsOptions {
  currentPage: Page;
  registryError: { message: string } | null;
}

export function useAppStartupEffects({
  currentPage,
  registryError,
}: UseAppStartupEffectsOptions): void {
  useEffect(() => {
    if (registryError) {
      console.warn("[App] Registry 加载失败:", registryError);
      showRegistryLoadError(registryError.message);
    }
  }, [registryError]);

  useEffect(() => {
    if (!isTauriDesktopEnvironment() || !isWindowsNavigatorPlatform()) {
      return;
    }

    void getWindowsStartupDiagnostics()
      .then((diagnostics) => {
        if (!diagnostics.summary_message) {
          return;
        }

        if (diagnostics.has_blocking_issues) {
          toast.error("Windows 启动自检发现阻塞问题", {
            description: diagnostics.summary_message,
            duration: 12000,
          });
          return;
        }

        if (diagnostics.has_warnings) {
          toast.warning("Windows 环境检测提示", {
            description: diagnostics.summary_message,
            duration: 8000,
          });
        }
      })
      .catch((error) => {
        console.warn("[App] 获取 Windows 启动诊断失败:", error);
      });
  }, []);

  useEffect(() => {
    if (!isTauriDesktopEnvironment()) {
      return;
    }

    void ensureDefaultWorkspaceReady()
      .then((result) => {
        if (result?.repaired) {
          recordWorkspaceRepair({
            workspaceId: result.workspaceId,
            rootPath: result.rootPath,
            source: "app_startup",
          });
          console.info(
            "[App] 启动时检测到默认工作区目录缺失，已自动修复:",
            result.rootPath,
          );
        }
      })
      .catch((error) => {
        console.warn("[App] 启动时工作区健康检查失败:", error);
      });
  }, []);

  useEffect(() => {
    const mainElement = document.querySelector("main");
    if (mainElement) {
      mainElement.scrollTop = 0;
    }
  }, [currentPage]);
}
