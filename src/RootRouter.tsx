/**
 * @file RootRouter.tsx
 * @description 根路由组件 - 根据 URL 路径渲染对应的组件
 */

import { lazy, Suspense, useEffect } from "react";
import App from "./App";
import { SmartInputPage } from "./pages/smart-input";
import { UpdateNotificationPage } from "./pages/update-notification";
import { BrowserRuntimeDebuggerPage } from "./pages";
import { ResourceManagerPage } from "./features/resource-manager";
import { BrowserConnectorGuideWindow } from "./components/settings-v2/system/chrome-relay/guide-window";
import { Toaster } from "./components/ui/sonner";
import { AppCrashBoundary } from "./components/layout/AppCrashBoundary";
import { finalizeModuleImportAutoReload } from "./components/layout/CrashRecoveryPanel.helpers";
import { getRuntimeAppVersion } from "./lib/appVersion";
import { startOemCloudStartupLoginIfRequired } from "./lib/oemCloudStartupLogin";

const DesignCanvasSmokePage = lazy(() =>
  import("./pages/design-canvas-smoke").then((module) => ({
    default: module.DesignCanvasSmokePage,
  })),
);

/**
 * 根据 URL 路径渲染对应的组件
 *
 * - /smart-input: 截图对话悬浮窗口（独立 Tauri 窗口，支持语音模式）
 * - /update-notification: 更新提醒悬浮窗口（独立 Tauri 窗口）
 * - /browser-runtime-debugger: 浏览器运行时独立调试窗口
 * - /resource-manager: 独立资源管理器窗口
 * - /browser-connector-guide: 浏览器连接器独立引导窗口
 * - 其他: 主应用
 */
export function RootRouter() {
  const pathname = window.location.pathname;
  const isMainAppRoute = ![
    "/smart-input",
    "/update-notification",
    "/browser-runtime-debugger",
    "/resource-manager",
    "/browser-connector-guide",
  ].includes(pathname);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    finalizeModuleImportAutoReload(
      window.location.href,
      getRuntimeAppVersion(),
      window.sessionStorage,
      window.history,
    );
  }, [pathname]);

  useEffect(() => {
    if (!isMainAppRoute) {
      return;
    }

    void startOemCloudStartupLoginIfRequired();
  }, [isMainAppRoute]);

  // 截图对话悬浮窗口路由（也用于语音输入）
  if (pathname === "/smart-input") {
    return (
      <AppCrashBoundary>
        <SmartInputPage />
      </AppCrashBoundary>
    );
  }

  // 更新提醒悬浮窗口路由
  if (pathname === "/update-notification") {
    return (
      <AppCrashBoundary>
        <UpdateNotificationPage />
      </AppCrashBoundary>
    );
  }

  if (pathname === "/browser-runtime-debugger") {
    return (
      <AppCrashBoundary>
        <BrowserRuntimeDebuggerPage />
        <Toaster />
      </AppCrashBoundary>
    );
  }

  if (pathname === "/resource-manager") {
    return (
      <AppCrashBoundary>
        <ResourceManagerPage />
        <Toaster />
      </AppCrashBoundary>
    );
  }

  if (pathname === "/browser-connector-guide") {
    return (
      <AppCrashBoundary>
        <BrowserConnectorGuideWindow />
        <Toaster />
      </AppCrashBoundary>
    );
  }

  if (pathname === "/design-canvas-smoke" && import.meta.env.DEV) {
    return (
      <AppCrashBoundary>
        <Suspense fallback={null}>
          <DesignCanvasSmokePage />
        </Suspense>
        <Toaster />
      </AppCrashBoundary>
    );
  }

  // 默认渲染主应用
  return (
    <AppCrashBoundary>
      <App />
      <Toaster />
    </AppCrashBoundary>
  );
}
