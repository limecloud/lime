import ReactDOM from "react-dom/client";
import { RootRouter } from "./RootRouter";
import "./index.css";
import "./lib/appearance/colors.css";

// Initialize Desktop Host fallback for web mode
import "./lib/desktop-host/index";

// Initialize i18n configuration
import "./i18n/config";
import { initCrashReporting } from "@/lib/crashReporting";
import { scheduleStyledRuntimeDiagnostics } from "@/lib/styledRuntime";
import { initializeLimeThemeMode } from "@/lib/appearance/themeMode";

// 启动诊断工具
import { startupTracker } from "@/lib/diagnostics/startupPerformance";
import "@/lib/diagnostics/layoutShiftDetector";

startupTracker.mark("main.tsx: start");

// 只引入轻量渲染器注册入口,避免启动期拖入整条 Artifact 重型依赖链
import { registerLightweightRenderers } from "./components/artifact/renderers";
registerLightweightRenderers();
startupTracker.mark("renderers registered");

initializeLimeThemeMode();
startupTracker.mark("theme mode initialized");

void initCrashReporting();

startupTracker.mark("before React render");
ReactDOM.createRoot(document.getElementById("root")!).render(<RootRouter />);
startupTracker.mark("React render called");
scheduleStyledRuntimeDiagnostics();
