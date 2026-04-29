import { afterEach, describe, expect, it, vi } from "vitest";
import * as logsApi from "@/lib/api/logs";
import {
  buildCrashDiagnosticPayload,
  buildCrashDiagnosticFileName,
  buildCrashDiagnosticClipboardText,
  clearCrashDiagnosticHistory,
  copyCrashDiagnosticJsonToClipboard,
  copyCrashDiagnosticToClipboard,
  detectDesktopPlatform,
  getClipboardPermissionGuide,
  sanitizeDiagnosticSceneTag,
} from "./crashDiagnostic";
import { clearInvokeTraceBuffer } from "./dev-bridge/safeInvoke";
import {
  clearWorkspaceRepairHistory,
  recordWorkspaceRepair,
} from "./workspaceHealthTelemetry";

const payload = {
  generated_at: "2026-03-02T00:00:00.000Z",
  app_version: "0.76.0",
  platform: "MacIntel",
  user_agent: "Lime-Test",
  locale: "zh-CN",
  timezone: "Asia/Shanghai",
  page_url: "tauri://localhost/settings",
  runtime: "tauri" as const,
  crash_reporting: {
    enabled: true,
    dsn: null,
    environment: "production",
    sample_rate: 1,
    send_pii: false,
  },
  frontend_crash_logs: [],
};

describe("copyCrashDiagnosticToClipboard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearWorkspaceRepairHistory();
    clearInvokeTraceBuffer();
  });

  it("应支持复制纯 JSON", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    await copyCrashDiagnosticJsonToClipboard(payload);

    expect(writeText).toHaveBeenCalledWith(JSON.stringify(payload, null, 2));
  });

  it("优先使用 navigator.clipboard 写入", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    await copyCrashDiagnosticToClipboard(payload);

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(
      buildCrashDiagnosticClipboardText(payload),
    );
  });

  it("clipboard API 失败时回退 execCommand", async () => {
    const writeText = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "The request is not allowed by the user agent or the platform in the current context, possibly because the user denied permission.",
        ),
      );
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });

    await copyCrashDiagnosticToClipboard(payload);

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("全部复制方案失败时返回中文可操作错误", async () => {
    const writeText = vi
      .fn()
      .mockRejectedValue(new Error("NotAllowedError: denied permission"));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    const execCommand = vi.fn().mockReturnValue(false);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });

    await expect(copyCrashDiagnosticToClipboard(payload)).rejects.toThrow(
      "剪贴板权限被系统拒绝，请允许权限后重试，或使用“导出诊断 JSON”",
    );
  });
});

describe("clipboard permission guide", () => {
  it("应正确识别平台", () => {
    expect(detectDesktopPlatform("MacIntel", "")).toBe("macos");
    expect(detectDesktopPlatform("Win32", "")).toBe("windows");
    expect(detectDesktopPlatform("Linux x86_64", "")).toBe("linux");
  });

  it("应返回分系统引导文案", () => {
    const macGuide = getClipboardPermissionGuide("MacIntel", "");
    expect(macGuide.title).toContain("macOS");
    expect(macGuide.steps.length).toBeGreaterThan(0);
    expect(macGuide.settingsUrl).toContain("x-apple.systempreferences");

    const windowsGuide = getClipboardPermissionGuide("Win32", "");
    expect(windowsGuide.title).toContain("Windows");
    expect(windowsGuide.settingsUrl).toBe("ms-settings:clipboard");
  });
});

describe("diagnostic clipboard text", () => {
  it("应包含提示词和 JSON 诊断数据", () => {
    const text = buildCrashDiagnosticClipboardText(payload);
    expect(text).toContain("Lime 故障诊断请求");
    expect(text).toContain("自动摘要");
    expect(text).toContain("你的任务");
    expect(text).toContain("诊断数据（JSON）");
    expect(text).toContain('"platform": "MacIntel"');
  });
});

describe("diagnostic export file name", () => {
  it("应支持场景标签并生成稳定文件名", () => {
    const fileName = buildCrashDiagnosticFileName(payload, {
      sceneTag: "Workspace Path Missing",
      timestamp: new Date("2026-03-02T08:09:10.000Z").getTime(),
    });

    expect(fileName).toContain("lime-crash-workspace-path-missing");
    expect(fileName).toContain("v-0-76-0");
    expect(fileName).toContain("20260302-");
    expect(fileName.endsWith(".json")).toBe(true);
  });

  it("应对场景标签做安全清洗", () => {
    expect(sanitizeDiagnosticSceneTag("  Crash@Recovery/中文  ")).toBe(
      "crash-recovery",
    );
    expect(sanitizeDiagnosticSceneTag("___")).toBeUndefined();
  });
});

describe("buildCrashDiagnosticPayload", () => {
  afterEach(() => {
    clearWorkspaceRepairHistory();
    clearInvokeTraceBuffer();
  });

  it("应注入 workspace 自动修复记录", () => {
    recordWorkspaceRepair({
      workspaceId: "ws-001",
      rootPath: "/tmp/ws-001",
      source: "workspace_refresh",
    });

    const diagnostic = buildCrashDiagnosticPayload({
      crashConfig: payload.crash_reporting,
      logs: payload.frontend_crash_logs,
      appVersion: payload.app_version,
      platform: payload.platform,
      userAgent: payload.user_agent,
    });

    expect(diagnostic.workspace_repair_history?.length).toBe(1);
    expect(diagnostic.workspace_repair_history?.[0].workspace_id).toBe(
      "ws-001",
    );
    expect(diagnostic.workspace_repair_history?.[0].source).toBe(
      "workspace_refresh",
    );
  });

  it("摘要应包含最近调用轨迹条数", () => {
    window.localStorage.setItem(
      "lime_invoke_trace_buffer_v1",
      JSON.stringify([
        {
          timestamp: "2026-03-09T01:02:03.000Z",
          command: "get_config",
          transport: "tauri-ipc",
          status: "success",
          duration_ms: 12,
        },
      ]),
    );

    const diagnostic = buildCrashDiagnosticPayload({
      crashConfig: payload.crash_reporting,
      logs: payload.frontend_crash_logs,
      appVersion: payload.app_version,
      platform: payload.platform,
      userAgent: payload.user_agent,
    });

    const text = buildCrashDiagnosticClipboardText(diagnostic);
    expect(diagnostic.invoke_trace_buffer?.length).toBe(1);
    expect(text).toContain("最近调用轨迹条数：1");
  });

  it("摘要应包含服务端诊断与日志文件统计", () => {
    const diagnostic = buildCrashDiagnosticPayload({
      crashConfig: payload.crash_reporting,
      logs: payload.frontend_crash_logs,
      appVersion: payload.app_version,
      platform: payload.platform,
      userAgent: payload.user_agent,
      serverDiagnostics: {
        generated_at: "2026-03-09T01:00:00.000Z",
        running: true,
        host: "127.0.0.1",
        port: 8999,
        telemetry_summary: {
          total_requests: 0,
          successful_requests: 0,
          failed_requests: 0,
          timeout_requests: 0,
          success_rate: 0,
          avg_latency_ms: 0,
          min_latency_ms: null,
          max_latency_ms: null,
          total_input_tokens: 0,
          total_output_tokens: 0,
          total_tokens: 0,
        },
        capability_routing: {
          filter_eval_total: 0,
          filter_excluded_total: 0,
          filter_excluded_tools_total: 0,
          filter_excluded_vision_total: 0,
          filter_excluded_context_total: 0,
          provider_fallback_total: 0,
          model_fallback_total: 0,
          all_candidates_excluded_total: 0,
        },
        response_cache: {
          config: {
            enabled: true,
            ttl_secs: 60,
            max_entries: 100,
            max_body_bytes: 1024,
            cacheable_status_codes: [200],
          },
          stats: {
            size: 0,
            hits: 0,
            misses: 0,
            evictions: 0,
          },
          hit_rate_percent: 0,
        },
        request_dedup: {
          config: {
            enabled: true,
            ttl_secs: 30,
            wait_timeout_ms: 1000,
          },
          stats: {
            inflight_size: 0,
            completed_size: 0,
            check_new_total: 0,
            check_in_progress_total: 0,
            check_completed_total: 0,
            wait_success_total: 0,
            wait_timeout_total: 0,
            wait_no_result_total: 0,
            complete_total: 0,
            remove_total: 0,
          },
          replay_rate_percent: 0,
        },
        idempotency: {
          config: {
            enabled: true,
            ttl_secs: 30,
            header_name: "x-idempotency-key",
          },
          stats: {
            entries_size: 0,
            in_progress_size: 0,
            completed_size: 0,
            check_new_total: 0,
            check_in_progress_total: 0,
            check_completed_total: 0,
            complete_total: 0,
            remove_total: 0,
          },
          replay_rate_percent: 0,
        },
      },
      logStorageDiagnostics: {
        log_directory: "/tmp/lime/logs",
        current_log_path: "/tmp/lime/logs/lime.log",
        current_log_exists: true,
        current_log_size_bytes: 1024,
        in_memory_log_count: 5,
        related_log_files: [
          {
            file_name: "lime.log",
            path: "/tmp/lime/logs/lime.log",
            size_bytes: 1024,
            compressed: false,
          },
          {
            file_name: "lime.log.20260309-010000",
            path: "/tmp/lime/logs/lime.log.20260309-010000",
            size_bytes: 2048,
            compressed: false,
          },
        ],
        raw_response_files: [
          {
            file_name: "raw_response_1.txt",
            path: "/tmp/lime/logs/raw_response_1.txt",
            size_bytes: 300,
            compressed: false,
          },
        ],
      },
    });

    const text = buildCrashDiagnosticClipboardText(diagnostic);
    expect(text).toContain("服务端诊断已采集：是");
    expect(text).toContain("关联日志文件数：2");
    expect(text).toContain("原始响应文件数：1");
  });

  it("摘要应包含运行时快照统计", () => {
    const diagnostic = buildCrashDiagnosticPayload({
      crashConfig: payload.crash_reporting,
      logs: payload.frontend_crash_logs,
      appVersion: payload.app_version,
      platform: payload.platform,
      userAgent: payload.user_agent,
      runtimeSnapshot: {
        config_summary: {
          default_provider: "deepseek",
          server_host: "127.0.0.1",
          server_port: 8999,
          tls_enabled: false,
          response_cache_enabled: true,
          remote_management_allow_remote: false,
          minimize_to_tray: true,
          language: "zh",
          proxy_configured: false,
          gateway_tunnel_enabled: false,
          crash_reporting_enabled: true,
        },
        api_key_provider_summary: {
          total_providers: 2,
          enabled_providers: 2,
          system_providers: 1,
          custom_providers: 1,
          total_api_keys: 4,
          enabled_api_keys: 3,
          disabled_api_keys: 1,
          providers: [
            {
              id: "deepseek",
              type: "openai-compatible",
              enabled: true,
              is_system: true,
              api_key_count: 3,
              enabled_api_key_count: 2,
              custom_model_count: 1,
            },
            {
              id: "custom-openai",
              type: "openai-compatible",
              enabled: true,
              is_system: false,
              api_key_count: 1,
              enabled_api_key_count: 1,
              custom_model_count: 2,
            },
          ],
        },
        mcp_summary: {
          total_servers: 3,
          running_servers: 1,
          enabled_lime: 2,
          enabled_claude: 1,
          enabled_codex: 1,
          enabled_gemini: 0,
          servers: [
            {
              name: "filesystem",
              is_running: true,
              enabled_lime: true,
              enabled_claude: false,
              enabled_codex: true,
              enabled_gemini: false,
            },
            {
              name: "fetch",
              is_running: false,
              enabled_lime: true,
              enabled_claude: true,
              enabled_codex: false,
              enabled_gemini: false,
            },
            {
              name: "sqlite",
              is_running: false,
              enabled_lime: false,
              enabled_claude: false,
              enabled_codex: false,
              enabled_gemini: false,
            },
          ],
        },
      },
    });

    const text = buildCrashDiagnosticClipboardText(diagnostic);
    expect(diagnostic.runtime_snapshot?.config_summary?.default_provider).toBe(
      "deepseek",
    );
    expect(text).toContain("运行时快照已采集：是");
    expect(text).toContain("API Key Provider / Key 数：2 / 4");
    expect(text).toContain("MCP 服务器数 / 运行中数：3 / 1");
  });

  it("无可用凭证时应提示初始化不足", () => {
    const diagnostic = buildCrashDiagnosticPayload({
      crashConfig: payload.crash_reporting,
      logs: payload.frontend_crash_logs,
      appVersion: payload.app_version,
      platform: payload.platform,
      userAgent: payload.user_agent,
      runtimeSnapshot: {
        api_key_provider_summary: {
          total_providers: 1,
          enabled_providers: 1,
          system_providers: 1,
          custom_providers: 0,
          total_api_keys: 0,
          enabled_api_keys: 0,
          disabled_api_keys: 0,
          providers: [
            {
              id: "deepseek",
              type: "openai-compatible",
              enabled: true,
              is_system: true,
              api_key_count: 0,
              enabled_api_key_count: 0,
              custom_model_count: 1,
            },
          ],
        },
      },
    });

    expect(diagnostic.diagnostic_collection_notes).toEqual(
      expect.arrayContaining([expect.stringContaining("API Key 数为 0")]),
    );
  });

  it("Windows 摘要应包含启动自检统计", () => {
    const diagnostic = buildCrashDiagnosticPayload({
      crashConfig: payload.crash_reporting,
      logs: payload.frontend_crash_logs,
      appVersion: payload.app_version,
      platform: "Win32",
      userAgent: payload.user_agent,
      windowsStartupDiagnostics: {
        platform: "windows",
        app_data_dir: "C:/Users/test/AppData/Roaming/lime",
        legacy_lime_dir: "C:/Users/test/.lime",
        db_path: "C:/Users/test/.lime/lime.db",
        webview2_version: "123.0.0.0",
        current_exe: "C:/Users/test/AppData/Local/Programs/Lime/Lime.exe",
        current_dir: "C:/Users/test/AppData/Local/Programs/Lime",
        resource_dir: "C:/Users/test/AppData/Local/Programs/Lime/resources",
        home_dir: "C:/Users/test",
        shell_env: "/bin/bash",
        comspec_env: "C:/Windows/System32/cmd.exe",
        resolved_terminal_shell: "cmd.exe",
        installation_kind_guess: "installed-like",
        checks: [
          {
            key: "shell_env",
            status: "warning",
            message: "检测到 Unix 风格 SHELL 环境变量: /bin/bash",
            detail:
              "旧版本 Windows 终端实现可能错误使用该值并触发 /bin/bash 启动失败。",
          },
          {
            key: "database",
            status: "error",
            message: "数据库不可访问",
            detail: "open failed",
          },
        ],
        has_blocking_issues: true,
        has_warnings: true,
        summary_message: "检测到 1 个阻塞问题与 1 个警告。",
      },
    });

    const text = buildCrashDiagnosticClipboardText(diagnostic);
    expect(text).toContain("Windows 启动自检已采集：是");
    expect(text).toContain("Windows 启动阻塞 / 警告：1 / 1");
    expect(text).toContain("Windows 终端默认 Shell：cmd.exe");
  });

  it("Windows 自动说明应提示 Unix 风格 SHELL", () => {
    const diagnostic = buildCrashDiagnosticPayload({
      crashConfig: payload.crash_reporting,
      logs: payload.frontend_crash_logs,
      appVersion: payload.app_version,
      platform: "Win32",
      userAgent: payload.user_agent,
      windowsStartupDiagnostics: {
        platform: "windows",
        app_data_dir: null,
        legacy_lime_dir: null,
        db_path: null,
        webview2_version: null,
        current_exe: null,
        current_dir: null,
        resource_dir: null,
        home_dir: null,
        shell_env: "/bin/bash",
        comspec_env: null,
        resolved_terminal_shell: "cmd.exe",
        installation_kind_guess: "unknown",
        checks: [],
        has_blocking_issues: false,
        has_warnings: true,
        summary_message: "检测到 Unix 风格 SHELL 环境变量。",
      },
    });

    expect(diagnostic.diagnostic_collection_notes).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Windows 启动自检提示"),
        expect.stringContaining("Unix 风格 SHELL 环境变量"),
      ]),
    );
  });

  it("应自动附加诊断采集说明", () => {
    window.localStorage.setItem(
      "lime_invoke_trace_buffer_v1",
      JSON.stringify([
        {
          timestamp: "2026-03-09T01:02:03.000Z",
          command: "get_config",
          transport: "tauri-ipc",
          status: "success",
          duration_ms: 12,
        },
      ]),
    );

    const diagnostic = buildCrashDiagnosticPayload({
      crashConfig: payload.crash_reporting,
      logs: payload.frontend_crash_logs,
      appVersion: payload.app_version,
      platform: payload.platform,
      userAgent: payload.user_agent,
      persistedLogTail: [],
    });

    expect(diagnostic.diagnostic_collection_notes).toEqual(
      expect.arrayContaining([
        expect.stringContaining("frontend_crash_buffer 为空"),
        expect.stringContaining("invoke_error_buffer 只记录失败调用"),
        expect.stringContaining("persisted_log_tail 当前仅收集到 0 行"),
      ]),
    );
  });

  it("检测到多日志文件时应提示已合并上下文", () => {
    const diagnostic = buildCrashDiagnosticPayload({
      crashConfig: payload.crash_reporting,
      logs: payload.frontend_crash_logs,
      appVersion: payload.app_version,
      platform: payload.platform,
      userAgent: payload.user_agent,
      logStorageDiagnostics: {
        log_directory: "/tmp/lime/logs",
        current_log_path: "/tmp/lime/logs/lime.log",
        current_log_exists: true,
        current_log_size_bytes: 1024,
        in_memory_log_count: 5,
        related_log_files: [
          {
            file_name: "lime.log",
            path: "/tmp/lime/logs/lime.log",
            size_bytes: 1024,
            compressed: false,
          },
          {
            file_name: "lime.log.20260309-010000",
            path: "/tmp/lime/logs/lime.log.20260309-010000",
            size_bytes: 2048,
            compressed: false,
          },
        ],
        raw_response_files: [],
      },
    });

    expect(diagnostic.diagnostic_collection_notes).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "persisted_log_tail 已按时间顺序合并最近日志上下文",
        ),
      ]),
    );
  });
});

describe("clearCrashDiagnosticHistory", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    clearWorkspaceRepairHistory();
  });

  it("应清空本地诊断缓存并触发日志历史清理", async () => {
    vi.spyOn(logsApi, "clearDiagnosticLogHistory").mockResolvedValue();

    window.localStorage.setItem(
      "lime_frontend_crash_buffer_v1",
      JSON.stringify([{ timestamp: "2026-03-09T00:00:00.000Z" }]),
    );
    window.localStorage.setItem(
      "lime_invoke_error_buffer_v1",
      JSON.stringify([{ timestamp: "2026-03-09T00:00:00.000Z" }]),
    );
    window.localStorage.setItem(
      "lime_invoke_trace_buffer_v1",
      JSON.stringify([{ timestamp: "2026-03-09T00:00:00.000Z" }]),
    );
    recordWorkspaceRepair({
      workspaceId: "ws-clear",
      rootPath: "/tmp/ws-clear",
      source: "workspace_refresh",
    });

    await clearCrashDiagnosticHistory();

    expect(
      window.localStorage.getItem("lime_frontend_crash_buffer_v1"),
    ).toBeNull();
    expect(
      window.localStorage.getItem("lime_invoke_error_buffer_v1"),
    ).toBeNull();
    expect(
      window.localStorage.getItem("lime_invoke_trace_buffer_v1"),
    ).toBeNull();
    expect(
      window.localStorage.getItem("lime.workspace_repair_history.v1"),
    ).toBeNull();
    expect(logsApi.clearDiagnosticLogHistory).toHaveBeenCalledTimes(1);
  });
});
