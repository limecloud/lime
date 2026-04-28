import ReactDOM from "react-dom/client";
import { RootRouter } from "./RootRouter";
import "./index.css";

// Initialize Tauri mock for web mode
import "./lib/tauri-mock/index";

// Initialize i18n configuration
import "./i18n/config";
import { initCrashReporting } from "@/lib/crashReporting";
import { scheduleStyledRuntimeDiagnostics } from "@/lib/styledRuntime";
import { initializeLimeColorScheme } from "@/lib/appearance/colorSchemes";
import { initializeLimeThemeMode } from "@/lib/appearance/themeMode";

// 只引入轻量渲染器注册入口，避免启动期拖入整条 Artifact 重型依赖链
import { registerLightweightRenderers } from "./components/artifact/renderers";
registerLightweightRenderers();
initializeLimeColorScheme();
initializeLimeThemeMode();

void initCrashReporting();

ReactDOM.createRoot(document.getElementById("root")!).render(<RootRouter />);

scheduleStyledRuntimeDiagnostics();
