import {
  APP_SERVER_METHOD_SESSION_READ,
  APP_SERVER_METHOD_SESSION_START,
  EXPERT_SKILLS_RUNTIME_SESSION_TITLE,
  FIXTURE_MODEL,
  FIXTURE_PROVIDER,
  NEWS_PROMPT,
  SESSION_TITLE,
  buildExpertSkillsRuntimeCatalog,
  buildExpertSkillsRuntimeMetadata,
} from "./claw-chat-current-fixture-constants.mjs";
import { sendPromptFromGui } from "./claw-chat-current-fixture-gui-actions.mjs";
import { EXPERT_SKILLS_RUNTIME_TENANT_ID } from "./skills-runtime-fixture-scenario.mjs";
import {
  evaluatePageSnapshot,
  invokeAppServerFromPage,
} from "./claw-chat-current-fixture-rpc.mjs";
import {
  assert,
  sanitizeJson,
  sleep,
} from "./claw-chat-current-fixture-utils.mjs";

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

export async function createExpertSkillsRuntimeSession(
  page,
  workspace,
  requestLog,
) {
  const { workspaceId, rootPath } = workspace;
  assert(rootPath, "expert skills fixture 缺少 workspace rootPath");
  const expertMetadata = buildExpertSkillsRuntimeMetadata();
  const session = await invokeAppServerFromPage(
    page,
    APP_SERVER_METHOD_SESSION_START,
    {
      cwd: rootPath,
      historyMode: "paginated",
      model: FIXTURE_MODEL,
      modelProvider: FIXTURE_PROVIDER,
      runtimeWorkspaceRoots: [rootPath],
      serviceName: EXPERT_SKILLS_RUNTIME_SESSION_TITLE,
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
    {
      sessionId: identity.sessionId,
      workspaceId,
    },
  );

  return {
    identity,
    session: session.result,
    update: null,
    expertMetadata,
  };
}

export async function injectExpertSkillsRuntimeCatalog(page, options = {}) {
  const runtimeTenantId = await page
    .evaluate(
      () =>
        window.__LIME_OEM_CLOUD__?.tenantId ||
        window.__LIME_OEM_CLOUD__?.tenant?.id ||
        null,
    )
    .catch(() => null);
  const tenantId =
    typeof runtimeTenantId === "string" && runtimeTenantId.trim()
      ? runtimeTenantId.trim()
      : EXPERT_SKILLS_RUNTIME_TENANT_ID;
  const catalog = buildExpertSkillsRuntimeCatalog({ ...options, tenantId });
  const workspaceSkillCatalog = options.workspaceSkill
    ? buildExpertPanelWorkspaceSkillCatalog(options.workspaceSkill, {
        tenantId,
      })
    : null;
  return await page.evaluate(
    ({ catalog, workspaceSkillCatalog }) => {
      const expertStorageKey = "lime:expert-catalog-cache:v1";
      const skillCatalogStorageKey = "lime:skill-catalog:v1";
      window.localStorage.setItem(expertStorageKey, JSON.stringify(catalog));
      if (workspaceSkillCatalog) {
        window.localStorage.setItem(
          skillCatalogStorageKey,
          JSON.stringify(workspaceSkillCatalog),
        );
        window.dispatchEvent(
          new CustomEvent("lime:skill-catalog-changed", {
            detail: {
              source: "manual_override",
              timestamp: Date.now(),
            },
          }),
        );
      }
      return {
        storageKey: expertStorageKey,
        expertStorageKey,
        skillCatalogStorageKey: workspaceSkillCatalog
          ? skillCatalogStorageKey
          : null,
        version: catalog.version,
        tenantId: catalog.tenantId,
        itemCount: catalog.items.length,
        expertId: catalog.items[0]?.id ?? null,
        skillRefs: catalog.items[0]?.release?.skillRefs ?? [],
        promptStarter: catalog.items[0]?.promptStarters?.[0] ?? null,
        workspaceSkillCatalog: workspaceSkillCatalog
          ? {
              version: workspaceSkillCatalog.version,
              tenantId: workspaceSkillCatalog.tenantId,
              itemCount: workspaceSkillCatalog.items.length,
              entryCount: workspaceSkillCatalog.entries.length,
              skillId: workspaceSkillCatalog.entries[0]?.skillId ?? null,
              skillFilePath:
                workspaceSkillCatalog.entries[0]?.skillLocator?.skillFilePath ??
                null,
            }
          : null,
      };
    },
    { catalog, workspaceSkillCatalog },
  );
}
export function buildExpertPanelWorkspaceSkillCatalog(
  workspaceSkill,
  options = {},
) {
  const skillFilePath = workspaceSkill?.skillFilePath;
  assert(
    skillFilePath,
    "Expert Panel Skills Runtime fixture 缺少 workspace skillFilePath",
  );
  const syncedAt = "2026-06-21T00:00:00.000Z";
  const title = "Capability Report";
  const summary =
    "Fixture skill for ExpertInfoPanel Skills runtime override evidence.";
  return {
    version: "fixture-skill-catalog-2026-06-21",
    tenantId: options.tenantId ?? EXPERT_SKILLS_RUNTIME_TENANT_ID,
    syncedAt,
    groups: [
      {
        key: "engineering",
        title: "工程技能",
        summary: "用于专家面板技能选择 fixture 的工程技能。",
        entryHint: "从专家信息面板加入后，在下一轮请求中继承 skillRefs。",
        themeTarget: "general",
        sort: 30,
        itemCount: 1,
      },
    ],
    items: [
      {
        id: "capability-report",
        skillKey: "project:capability-report",
        skillType: "service",
        title,
        summary,
        entryHint: "用于验证 ExpertInfoPanel 技能选择后的下一轮继承。",
        aliases: ["capability-report", "project:capability-report"],
        category: "engineering",
        outputHint: "输出专家技能继承证据摘要。",
        triggerHints: ["capability-report"],
        source: "local_custom",
        runnerType: "instant",
        defaultExecutorBinding: "native_skill",
        executionLocation: "client_default",
        defaultArtifactKind: "report",
        readinessRequirements: { requiresModel: true, requiresProject: true },
        usageGuidelines: [
          "只用于 ExpertInfoPanel fixture 验证，不代表生产 fallback。",
        ],
        setupRequirements: [],
        examples: ["使用 capability-report 生成专家技能继承证据。"],
        outputDestination: "agent_chat",
        slotSchema: [],
        surfaceScopes: ["mention", "workspace"],
        promptTemplateKey: "generic",
        themeTarget: "general",
        skillBundle: {
          name: "project:capability-report",
          description: summary,
          resourceSummary: {
            hasScripts: false,
            hasReferences: false,
            hasAssets: false,
          },
          standardCompliance: {
            isStandard: true,
            deprecatedFields: [],
          },
        },
        version: "1.0.0",
        groupKey: "engineering",
        execution: { kind: "native_skill" },
      },
    ],
    entries: [
      {
        id: "skill:capability-report",
        kind: "skill",
        title,
        summary,
        skillId: "capability-report",
        groupKey: "engineering",
        aliases: ["capability-report", "project:capability-report"],
        surfaceScopes: ["mention", "workspace"],
        skillLocator: {
          source: "project",
          name: "project:capability-report",
          directory: "capability-report",
          skillFilePath,
        },
        execution: { kind: "native_skill" },
      },
    ],
  };
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
    `GUI 未显示 Claw fixture 会话: ${JSON.stringify(
      sanitizeJson(lastSnapshot),
    )}`,
  );
}

export async function openFixtureSessionFromSidebar(page, options, requestLog) {
  const sessionId = options.sessionId?.trim();
  const threadId = options.threadId?.trim();
  assert(sessionId, "Claw fixture 缺少 canonical sessionId");
  assert(threadId, "Claw fixture 缺少 canonical threadId");
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
  { sessionId, threadId = options.threadId, title, allowPlanDecision = false },
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
          const planDecisionPanel = document.querySelector(
            '[data-testid="plan-composer-decision-panel"]',
          );
          const planDecisionText = planDecisionPanel?.textContent || "";
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
            hasPlanDecisionPanel: Boolean(planDecisionPanel),
            hasPlanDecisionTitle: planDecisionText.includes("实施此计划"),
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
      const planDecisionReady =
        allowPlanDecision === true &&
        inputReady?.hasMessageList === true &&
        inputReady?.hasPlanDecisionPanel === true &&
        inputReady?.hasPlanDecisionTitle === true;
      if (openedCurrentSession && (inputbarReady || planDecisionReady)) {
        return lastSnapshot;
      }
    }
    await sleep(options.intervalMs);
  }
  throw new Error(
    `侧栏未打开 Claw fixture 会话: ${title}; snapshot=${JSON.stringify(
      sanitizeJson(lastSnapshot),
    )}`,
  );
}

export async function sendNewsPromptFromGui(page, options) {
  return await sendPromptFromGui(page, options, NEWS_PROMPT);
}

export function isTaskCenterHomeText(text) {
  return (
    text.includes("青柠一下，灵感即来") ||
    text.includes("你可以从这些任务开始") ||
    text.includes("向下滑，看看 Lime 可以帮你做什么")
  );
}
