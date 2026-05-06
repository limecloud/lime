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

// 启动诊断工具
import { startupTracker } from "@/lib/diagnostics/startupPerformance";
import "@/lib/diagnostics/layoutShiftDetector";

// 预加载 AgentChatWorkspace 模块,避免首次点击"新建任务"时才加载
import { preloadAgentChatWorkspaceModule } from "@/components/agent/chat/agentChatWorkspaceLoader";

startupTracker.mark("main.tsx: start");

// 只引入轻量渲染器注册入口,避免启动期拖入整条 Artifact 重型依赖链
import { registerLightweightRenderers } from "./components/artifact/renderers";
registerLightweightRenderers();
startupTracker.mark("renderers registered");

initializeLimeColorScheme();
startupTracker.mark("color scheme initialized");

initializeLimeThemeMode();
startupTracker.mark("theme mode initialized");

void initCrashReporting();

startupTracker.mark("before React render");
ReactDOM.createRoot(document.getElementById("root")!).render(<RootRouter />);
startupTracker.mark("React render called");

// 在 React 渲染后立即开始预加载 AgentChatWorkspace
// 这样用户在浏览首页时,模块就在后台加载了
setTimeout(() => {
  startupTracker.mark("preloading AgentChatWorkspace");
  preloadAgentChatWorkspaceModule();
}, 100);

scheduleStyledRuntimeDiagnostics();
