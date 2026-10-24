/**
 * @file RootRouter.tsx
 * @description 根路由组件 - 根据 URL 路径渲染对应的组件
 */

import { lazy, Suspense, useEffect } from "react";
import App from "./App";
import { UpdateNotificationPage } from "./pages/update-notification";
import { Toaster } from "./components/ui/sonner";
import { AppCrashBoundary } from "./components/layout/AppCrashBoundary";
import { finalizeCrashRecoveryAutoReload } from "./components/layout/CrashRecoveryPanel.helpers";
import { getRuntimeAppVersion } from "./lib/appVersion";

const DesignCanvasSmokePage = lazy(() =>
  import("./pages/design-canvas-smoke").then((module) => ({
    default: module.DesignCanvasSmokePage,
  })),
);

const INDEX_ENTRY_PATH = "/index.html";
const WINDOW_ROUTE_QUERY_PARAM = "lime_window";
const UPDATE_NOTIFICATION_ROUTE_ID = "update-notification";
const UPDATE_NOTIFICATION_PATH = "/update-notification";

function getEffectivePathname(location: Location): string {
  if (
    location.pathname !== INDEX_ENTRY_PATH &&
    !location.pathname.endsWith(INDEX_ENTRY_PATH)
  ) {
    return location.pathname;
  }

  const params = new URLSearchParams(location.search);
  const windowRoute = params.get(WINDOW_ROUTE_QUERY_PARAM);
  if (windowRoute === UPDATE_NOTIFICATION_ROUTE_ID) {
    return UPDATE_NOTIFICATION_PATH;
  }
  return location.pathname;
}

/**
 * 根据 URL 路径渲染对应的组件
 *
 * - /update-notification: 更新提醒悬浮窗口（独立 Desktop Host 窗口）
 * - 其他: 主应用
 */
export function RootRouter() {
  const pathname = getEffectivePathname(window.location);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    finalizeCrashRecoveryAutoReload(
      window.location.href,
      getRuntimeAppVersion(),
      window.sessionStorage,
      window.history,
    );
  }, [pathname]);

  // 更新提醒悬浮窗口路由
  if (pathname === "/update-notification") {
    return (
      <AppCrashBoundary>
        <UpdateNotificationPage />
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
