import {
  APP_SERVER_METHOD_SESSION_READ,
  APP_SERVER_METHOD_SESSION_START,
  FIXTURE_MODEL,
  FIXTURE_PROVIDER,
  SESSION_TITLE,
} from "./constants.mjs";
import { evaluatePageSnapshot, invokeAppServerFromPage } from "./rpc.mjs";
import { assert, sanitizeJson, sleep } from "./utils.mjs";

export async function createFixtureSession(
  page,
  workspace,
  requestLog,
  preferences = {},
) {
  const { workspaceId, rootPath } = workspace;
  const provider = preferences.provider || FIXTURE_PROVIDER;
  const model = preferences.model || FIXTURE_MODEL;
  assert(rootPath, "workspace/default/ensure 未返回可用 rootPath");
  const session = await invokeAppServerFromPage(
    page,
    APP_SERVER_METHOD_SESSION_START,
    {
      cwd: rootPath,
      historyMode: "paginated",
      model,
      modelProvider: provider,
      runtimeWorkspaceRoots: [rootPath],
      serviceName: SESSION_TITLE,
      threadSource: "appServer",
    },
    requestLog,
  );
  const identity = readThreadStartIdentity(session.result);

  await page.evaluate(
    ({ sessionId, workspaceId }) => {
      window.dispatchEvent(
        new CustomEvent("lime:agent-runtime-sessions-changed", {
          detail: {
            reason: "external",
            sessionId,
            workspaceId,
          },
        }),
      );
    },
    { sessionId: identity.sessionId, workspaceId },
  );

  return {
    identity,
    session: session.result,
    update: null,
  };
}

function readThreadStartIdentity(result) {
  const thread = result?.thread;
  const sessionId =
    typeof thread?.sessionId === "string" ? thread.sessionId.trim() : "";
  const threadId = typeof thread?.id === "string" ? thread.id.trim() : "";
  assert(
    sessionId && threadId,
    `thread/start 未返回 canonical identity: ${JSON.stringify(
      sanitizeJson(result),
    )}`,
  );
  return { sessionId, threadId };
}

export async function navigateGuiToWorkspaceScopedAgent(
  page,
  options,
  workspaceId,
) {
  const startedAt = Date.now();
  let lastSnapshot = null;

  while (Date.now() - startedAt < options.timeoutMs) {
    const snapshot = await evaluatePageSnapshot(
      page,
      ({ workspaceId }) => {
        const text = document.body?.innerText || "";
        const recentShelf = document.querySelector(
          '[data-testid="app-sidebar-recent-conversations"]',
        );
        const buttons = Array.from(document.querySelectorAll("button")).map(
          (button) => ({
            title: button.getAttribute("title") || "",
            text: button.textContent || "",
            aria: button.getAttribute("aria-label") || "",
            testId: button.getAttribute("data-testid") || "",
          }),
        );
        return {
          url: window.location.href,
          localStorageWorkspace: window.localStorage.getItem(
            "agent_last_project_id",
          ),
          localStorageMatchesWorkspace:
            window.localStorage.getItem("agent_last_project_id") ===
            JSON.stringify(workspaceId),
          hasConversationList: Boolean(recentShelf),
          recentShelfText: recentShelf?.textContent || "",
          hasWorkspaceShell: Boolean(
            document.querySelector('[data-testid="agent-chat-workspace"]') ||
            document.querySelector('[data-testid="chat-workspace"]') ||
            document.querySelector(
              '[data-testid="theme-workbench-harness-toggle"]',
            ) ||
            document.querySelector('[data-testid="toggle-harness"]'),
          ),
          bodyText: text,
        };
      },
      { workspaceId },
    );

    if (!snapshot) {
      await sleep(options.intervalMs);
      continue;
    }
    lastSnapshot = snapshot;

    if (snapshot.hasConversationList && snapshot.localStorageMatchesWorkspace) {
      return snapshot;
    }

    await page.evaluate(() => {
      window.dispatchEvent(new Event("focus"));
    });

    await sleep(options.intervalMs);
  }

  throw new Error(
    `GUI 未进入 workspace-scoped Agent 状态: ${JSON.stringify(
      sanitizeJson(lastSnapshot),
    )}`,
  );
}

export async function waitForGuiSessionVisible(
  page,
  options,
  title = SESSION_TITLE,
) {
  const startedAt = Date.now();
  let lastRefreshAt = 0;
  let lastSnapshot = null;
  while (Date.now() - startedAt < options.timeoutMs) {
    const snapshot = await evaluatePageSnapshot(
      page,
      ({ title }) => {
        const text = document.body?.innerText || "";
        const recentShelf = document.querySelector(
          '[data-testid="app-sidebar-recent-conversations"]',
        );
        const buttons = Array.from(document.querySelectorAll("button")).map(
          (button) => ({
            title: button.getAttribute("title") || "",
            text: button.textContent || "",
            aria: button.getAttribute("aria-label") || "",
            testId: button.getAttribute("data-testid") || "",
          }),
        );
        return {
          url: window.location.href,
          hasSessionTitle: text.includes(title),
          hasRecentShelf: Boolean(recentShelf),
          recentShelfText: recentShelf?.textContent || "",
          matchingButtonCount: buttons.filter((button) =>
            [button.title, button.text, button.aria].some((label) =>
              label.includes(title),
            ),
          ).length,
          bodyText: text,
        };
      },
      { title },
    );
    if (!snapshot) {
      await sleep(options.intervalMs);
      continue;
    }
    lastSnapshot = snapshot;
    if (snapshot.hasSessionTitle || snapshot.matchingButtonCount > 0) {
      return snapshot;
    }
    if (Date.now() - lastRefreshAt > 2_000) {
      lastRefreshAt = Date.now();
      await page.evaluate(() => {
        window.dispatchEvent(
          new CustomEvent("lime:agent-runtime-sessions-changed", {
            detail: {
              reason: "external",
            },
          }),
        );
      });
    }
    await sleep(options.intervalMs);
  }
  throw new Error(
    `GUI 未显示 聊天夹具 会话: ${JSON.stringify(sanitizeJson(lastSnapshot))}`,
  );
}

export async function openFixtureSessionFromSidebar(page, options, requestLog) {
  const sessionId = options.sessionId?.trim();
  const threadId = options.threadId?.trim();
  assert(sessionId, "聊天夹具 缺少 canonical sessionId");
  assert(threadId, "聊天夹具 缺少 canonical threadId");
  return await openSessionFromSidebar(page, options, requestLog, {
    sessionId,
    threadId,
    title: SESSION_TITLE,
  });
}

export async function openSessionFromSidebar(
  page,
  options,
  requestLog,
  { sessionId, threadId = options.threadId, title },
) {
  assert(sessionId, `会话 ${title} 缺少 canonical sessionId`);
  assert(threadId, `会话 ${title} 缺少 canonical threadId`);
  const startedAt = Date.now();
  let lastSnapshot = null;
  let lastClick = null;
  while (Date.now() - startedAt < options.timeoutMs) {
    if (!lastClick?.clicked) {
      lastClick = await evaluatePageSnapshot(
        page,
        ({ sessionId }) => {
          const sidebarCandidates = Array.from(
            document.querySelectorAll(
              '[data-testid="app-sidebar-conversation-open"]',
            ),
          ).filter(
            (candidate) =>
              candidate.getAttribute("data-session-id") === sessionId,
          );
          const button =
            sidebarCandidates.length === 1 ? sidebarCandidates[0] : null;
          if (!button) {
            const moreButton = Array.from(
              document.querySelectorAll("button"),
            ).find((candidate) =>
              (candidate.textContent || "").includes("查看更多对话"),
            );
            moreButton?.click();
            return false;
          }
          button.click();
          return {
            clicked: true,
            title: button.getAttribute("title") || "",
            aria: button.getAttribute("aria-label") || "",
            text: button.textContent || "",
            testId: button.getAttribute("data-testid") || "",
          };
        },
        { sessionId },
      );
    }

    if (lastClick?.clicked) {
      const readModel = await invokeAppServerFromPage(
        page,
        APP_SERVER_METHOD_SESSION_READ,
        {
          threadId,
          includeTurns: true,
        },
        requestLog,
      ).catch((error) => ({
        error: error instanceof Error ? error.message : String(error),
      }));
      const inputReady = await evaluatePageSnapshot(
        page,
        ({ title, sessionId }) => {
          const editors = Array.from(
            document.querySelectorAll(
              '[data-testid="composer-editor"][role="textbox"]',
            ),
          ).filter((node) => node instanceof HTMLElement);
          const editor =
            editors.find((node) => node.dataset.sessionId === sessionId) ??
            editors[0] ??
            null;
          const rect = editor?.getBoundingClientRect();
          const style = editor ? window.getComputedStyle(editor) : null;
          const editorVisible = Boolean(
            editor &&
            rect &&
            rect.width > 16 &&
            rect.height > 16 &&
            style?.visibility !== "hidden" &&
            style?.display !== "none",
          );
          const menu = document.querySelector(
            '[data-testid="app-sidebar-conversation-menu"]',
          );
          const bodyText = document.body?.innerText || "";
          const mainText = document.querySelector("main")?.textContent || "";
          return {
            url: window.location.href,
            hasEditor: Boolean(editor),
            editorSessionId:
              editor instanceof HTMLElement
                ? editor.dataset.sessionId || null
                : null,
            editorCount: editors.length,
            editorVisible,
            hasConversationMenu: Boolean(menu),
            hasSessionTitleInMain: mainText.includes(title),
            hasRecentConversationsShell: mainText.includes("最近对话"),
            hasMessageList: Boolean(
              document.querySelector('[data-testid="message-list"]') ||
              document.querySelector('[data-testid="message-list-frame"]'),
            ),
            isRestoringSessionShell:
              mainText.includes("正在恢复生成会话") ||
              bodyText.includes("正在恢复生成会话"),
            hasInputbarCore: Boolean(
              document.querySelector('[data-testid="inputbar-core-container"]'),
            ),
            hasWorkspaceShell: Boolean(
              document.querySelector('[data-testid="agent-chat-workspace"]') ||
              document.querySelector('[data-testid="chat-workspace"]') ||
              document.querySelector(
                '[data-testid="theme-workbench-harness-toggle"]',
              ) ||
              document.querySelector('[data-testid="toggle-harness"]'),
            ),
            editorDisabled:
              editor instanceof HTMLElement
                ? editor.getAttribute("aria-disabled") === "true" ||
                  editor.getAttribute("contenteditable") !== "true"
                : null,
            bodyText,
            mainText,
          };
        },
        { title, sessionId },
      );
      lastSnapshot = {
        clicked: lastClick,
        inputReady: sanitizeJson(inputReady),
        readModel: sanitizeJson({
          hasThread: Boolean(readModel?.result?.thread),
          sessionId: readModel?.result?.thread?.sessionId ?? null,
          threadId: readModel?.result?.thread?.id ?? null,
          error: readModel?.error ?? null,
        }),
      };
      const readModelSessionId = readModel?.result?.thread?.sessionId ?? null;
      const readModelThreadId = readModel?.result?.thread?.id ?? null;
      const openedCurrentSession =
        readModelSessionId === sessionId &&
        readModelThreadId === threadId &&
        !inputReady?.hasConversationMenu &&
        !inputReady?.hasRecentConversationsShell &&
        !inputReady?.isRestoringSessionShell &&
        !isTaskCenterHomeText(inputReady?.mainText || "") &&
        !isTaskCenterHomeText(inputReady?.bodyText || "") &&
        (inputReady?.hasSessionTitleInMain || inputReady?.hasMessageList);
      const inputbarReady =
        inputReady?.hasEditor &&
        inputReady?.hasInputbarCore &&
        inputReady?.editorVisible &&
        inputReady?.editorDisabled === false &&
        (!sessionId || inputReady?.editorSessionId === sessionId);
      if (openedCurrentSession && inputbarReady) {
        return lastSnapshot;
      }
    }
    await sleep(options.intervalMs);
  }
  throw new Error(
    `侧栏未打开 聊天夹具 会话: ${title}; snapshot=${JSON.stringify(
      sanitizeJson(lastSnapshot),
    )}`,
  );
}

export function isTaskCenterHomeText(text) {
  return (
    text.includes("青柠一下，灵感即来") ||
    text.includes("你可以从这些任务开始") ||
    text.includes("向下滑，看看 Lime 可以帮你做什么")
  );
}
