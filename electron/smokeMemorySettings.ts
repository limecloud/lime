import type { BrowserWindow } from "./electronRuntime";

export interface MemorySettingsSmokeSnapshot {
  ok?: boolean;
  stage?: string;
  problemTexts?: unknown[];
  invokeErrors?: unknown[];
  traceErrors?: unknown[];
  backgroundInvokeErrors?: unknown[];
  backgroundTraceErrors?: unknown[];
  targetStates?: unknown[];
  visibleButtons?: unknown[];
  bodyStart?: string;
  url?: string;
  title?: string;
}

export async function waitForElectronSmokeMemorySettingsReady(
  window: BrowserWindow,
): Promise<MemorySettingsSmokeSnapshot> {
  if (window.isDestroyed()) {
    throw new Error("main window was destroyed before memory settings smoke");
  }

  const result = (await window.webContents.executeJavaScript(
    `new Promise((resolve) => {
      const timeoutMs = 90000;
      const intervalMs = 250;
      const startedAt = Date.now();
      const problemPatterns = [
        /无法连接后端桥接/,
        /Desktop Host 尚未支持命令/,
        /Electron host command is not supported/,
        /Electron host command is not implemented/,
        /Unsupported command/,
        /未知命令/,
        /bridge cooldown active/,
        /加载.*失败/,
        /加载失败/,
        /调用失败/,
      ];
      const forbiddenPatterns = [
        /灵感库/,
        /MemoryPage/,
        /命中预演/,
      ];
      const sanitize = (value) => String(value || "").replace(/\\s+/g, " ").trim();
      const readJsonArray = (key) => {
        try {
          const parsed = JSON.parse(localStorage.getItem(key) || "[]");
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      };
      const isCurrentRunEntry = (entry) => {
        const timestamp = Date.parse(entry?.timestamp || "");
        return Number.isFinite(timestamp) && timestamp >= startedAt;
      };
      const memorySettingsErrorCommands = [
        "app_server_handle_json_lines",
        "app_server_drain_events",
      ];
      const ignoredBackgroundErrorCommands = [
        "check_for_updates",
      ];
      const isIgnoredBackgroundErrorEntry = (entry) =>
        ignoredBackgroundErrorCommands.includes(String(entry?.command || ""));
      const isMemorySettingsErrorEntry = (entry) => {
        const command = String(entry?.command || "");
        return memorySettingsErrorCommands.includes(command) || command.startsWith("memoryStore/");
      };
      const displayed = (element) => {
        if (!element) {
          return false;
        }
        const style = window.getComputedStyle(element);
        return element.getClientRects().length > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      const interactable = (element) => {
        return displayed(element) && !element.disabled && element.getAttribute("aria-disabled") !== "true";
      };
      const click = (selector) => {
        const element = document.querySelector(selector);
        if (!interactable(element)) {
          return false;
        }
        element.scrollIntoView({ block: "center", inline: "nearest" });
        element.click();
        return true;
      };
      const sidebarMemoryTabSelector = '[data-testid="settings-sidebar-tab-memory"]';
      const sidebarSettingsSelector = '[data-testid="app-sidebar-nav-settings"]';
      const memoryTabNavigationReady = () =>
        interactable(document.querySelector(sidebarMemoryTabSelector));
      const memoryActionSelectors = [
        '#memory-enabled button',
        '#memory-delete button',
        '[data-testid="settings-instructions-open"]',
      ];
      const memoryActionsReady = () => memoryActionSelectors.every((selector) => interactable(document.querySelector(selector)));
      const targetState = (selector) => {
        const element = document.querySelector(selector);
        if (!element) {
          return { selector, exists: false };
        }
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return {
          selector,
          exists: true,
          displayed: displayed(element),
          disabled: Boolean(element.disabled) || element.getAttribute("aria-disabled") === "true",
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
          display: style.display,
          visibility: style.visibility,
          text: sanitize(element.textContent).slice(0, 80),
        };
      };
      const collectErrors = () => {
        const text = document.body?.innerText || "";
        const problemTexts = problemPatterns.flatMap((pattern) => {
          const match = text.match(pattern);
          return match ? [match[0]] : [];
        });
        const forbiddenTexts = forbiddenPatterns.flatMap((pattern) => {
          const match = text.match(pattern);
          return match ? [match[0]] : [];
        });
        const currentInvokeErrors = readJsonArray("lime_invoke_error_buffer_v1")
          .filter(isCurrentRunEntry)
          .filter((entry) => !isIgnoredBackgroundErrorEntry(entry));
        const currentTraceErrors = readJsonArray("lime_invoke_trace_buffer_v1")
          .filter((entry) => entry && entry.status === "error" && isCurrentRunEntry(entry))
          .filter((entry) => !isIgnoredBackgroundErrorEntry(entry));
        const invokeErrors = currentInvokeErrors.filter(isMemorySettingsErrorEntry);
        const traceErrors = currentTraceErrors.filter(isMemorySettingsErrorEntry);
        const backgroundInvokeErrors = currentInvokeErrors.filter((entry) => !isMemorySettingsErrorEntry(entry));
        const backgroundTraceErrors = currentTraceErrors.filter((entry) => !isMemorySettingsErrorEntry(entry));
        return { text, problemTexts, forbiddenTexts, invokeErrors, traceErrors, backgroundInvokeErrors, backgroundTraceErrors };
      };
      const summarize = (stage) => {
        const errors = collectErrors();
        return {
          ok: false,
          stage,
          problemTexts: [...errors.problemTexts, ...errors.forbiddenTexts],
          invokeErrors: errors.invokeErrors.slice(-5).map((entry) => ({
            command: entry?.command || null,
            transport: entry?.transport || null,
            error: sanitize(entry?.error),
          })),
          traceErrors: errors.traceErrors.slice(-5).map((entry) => ({
            command: entry?.command || null,
            transport: entry?.transport || null,
            status: entry?.status || null,
            error: sanitize(entry?.error),
          })),
          backgroundInvokeErrors: errors.backgroundInvokeErrors.slice(-3).map((entry) => ({
            command: entry?.command || null,
            transport: entry?.transport || null,
            error: sanitize(entry?.error),
          })),
          backgroundTraceErrors: errors.backgroundTraceErrors.slice(-3).map((entry) => ({
            command: entry?.command || null,
            transport: entry?.transport || null,
            status: entry?.status || null,
            error: sanitize(entry?.error),
          })),
          targetStates: [
            '[data-testid="settings-memory-page"]',
            '#memory-enabled', '#memory-tools', '#memory-delete', '#memory-instructions',
            '[data-testid="settings-instructions-open"]',
            '[data-testid="settings-instructions-editor"]',
            sidebarMemoryTabSelector,
          ].map(targetState),
          visibleButtons: Array.from(document.querySelectorAll("button"))
            .map((button, index) => {
              const rect = button.getBoundingClientRect();
              return {
                index,
                visible: rect.width > 0 && rect.height > 0,
                text: sanitize(button.textContent),
                aria: button.getAttribute("aria-label") || "",
                testId: button.getAttribute("data-testid") || "",
                disabled: button.disabled || button.getAttribute("aria-disabled") === "true",
              };
            })
            .filter((button) => button.visible)
            .slice(0, 30),
          url: window.location.href,
          title: document.title,
          bodyStart: sanitize(errors.text).slice(0, 700),
        };
      };
      const waitFor = (predicate, stage) =>
        new Promise((waitResolve) => {
          const tick = () => {
            const errors = collectErrors();
            if (errors.problemTexts.length || errors.forbiddenTexts.length || errors.invokeErrors.length || errors.traceErrors.length) {
              waitResolve(summarize(stage));
              return;
            }
            if (predicate()) {
              waitResolve({ ok: true });
              return;
            }
            if (Date.now() - startedAt >= timeoutMs) {
              waitResolve(summarize(stage));
              return;
            }
            setTimeout(tick, intervalMs);
          };
          tick();
        });
      const run = async () => {
        let result = await waitFor(() =>
          interactable(document.querySelector('[data-testid="app-sidebar-account-button"]')) ||
          interactable(document.querySelector(sidebarSettingsSelector)),
          "wait settings navigation trigger",
        );
        if (!result.ok) return result;
        if (interactable(document.querySelector(sidebarSettingsSelector))) {
          if (!click(sidebarSettingsSelector)) return summarize("open settings page");
        } else {
          if (!click('[data-testid="app-sidebar-account-button"]')) return summarize("open account menu");
          result = await waitFor(() => displayed(document.querySelector('[data-testid="app-sidebar-account-model-settings"]')), "wait model settings entry");
          if (!result.ok) return result;
          if (!click('[data-testid="app-sidebar-account-model-settings"]')) return summarize("open settings page");
        }

        result = await waitFor(memoryTabNavigationReady, "wait settings memory tab");
        if (!result.ok) return result;
        if (!click(sidebarMemoryTabSelector)) return summarize("open memory settings tab");

        result = await waitFor(() => displayed(document.querySelector('[data-testid="settings-memory-page"]')) && memoryActionsReady(), "wait personalization settings");
        if (!result.ok) return result;
        if (!click('[data-testid="settings-instructions-open"]')) return summarize("open instructions");
        result = await waitFor(() => displayed(document.querySelector('[data-testid="settings-instructions-editor"] textarea')) && !document.querySelector('[data-testid="settings-instructions-editor"] [role="alert"]'), "wait instructions read");
        if (!result.ok) return result;
        if (!click('[data-testid="settings-instructions-back"]')) return summarize("return from instructions");
        result = await waitFor(memoryActionsReady, "wait personalization return");
        if (!result.ok) return result;

        return { ...summarize("done"), ok: true, stage: "done" };
      };
      run().then(resolve).catch((error) => resolve({
        ...summarize("exception"),
        error: error instanceof Error ? error.message : String(error),
      }));
    })`,
    true,
  )) as MemorySettingsSmokeSnapshot;

  if (result?.ok) {
    return result;
  }

  throw new Error(
    `memory settings smoke not ready: ${JSON.stringify({
      stage: result?.stage ?? "unknown",
      problemTexts: result?.problemTexts ?? [],
      invokeErrors: result?.invokeErrors ?? [],
      traceErrors: result?.traceErrors ?? [],
      backgroundInvokeErrors: result?.backgroundInvokeErrors ?? [],
      backgroundTraceErrors: result?.backgroundTraceErrors ?? [],
      targetStates: result?.targetStates ?? [],
      visibleButtons: result?.visibleButtons ?? [],
      url: result?.url ?? "",
      bodyStart: result?.bodyStart ?? "",
    })}`,
  );
}
