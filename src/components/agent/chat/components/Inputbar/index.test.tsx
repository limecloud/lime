import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Inputbar } from "./index";
import type { Character } from "@/lib/api/memory";
import type { Skill } from "@/lib/api/skills";
import type { ServiceSkillHomeItem } from "@/components/agent/chat/service-skills/types";
import type {
  BuiltinInputCommand,
  RuntimeSceneSlashCommand,
} from "../../skill-selection/builtinCommands";
import type { InputCapabilitySelection } from "../../skill-selection/inputCapabilitySelection";
import {
  buildCuratedTaskLaunchPrompt,
  findCuratedTaskTemplateById,
  resolveCuratedTaskTemplateLaunchPrefill,
} from "../../utils/curatedTaskTemplates";

const mockCharacterMention = vi.fn<
  (props: {
    characters?: Character[];
    skills?: Skill[];
    serviceSkills?: ServiceSkillHomeItem[];
    onSelectInputCapability?: (
      capability: InputCapabilitySelection,
      options?: { replayText?: string },
    ) => void;
    onSelectServiceSkill?: (skill: ServiceSkillHomeItem) => void;
    defaultCuratedTaskReferenceMemoryIds?: string[];
    defaultCuratedTaskReferenceEntries?: Array<{
      id: string;
      title: string;
      summary: string;
      category: string;
      categoryLabel: string;
      tags: string[];
    }>;
    inputCompletionEnabled?: boolean;
  }) => React.ReactNode
>();
const mockInputbarCore = vi.fn(
  (props: {
    onToolClick?: (tool: string) => void;
    activeTools?: Record<string, boolean>;
    onSend?: () => void;
    leftExtra?: React.ReactNode;
    topExtra?: React.ReactNode;
    placeholder?: string;
    toolMode?: "default" | "attach-only";
    showMetaTools?: boolean;
  }) => (
    <div data-testid="inputbar-core">
      {props.showMetaTools ? (
        <>
          <button
            type="button"
            data-testid="toggle-web-search"
            onClick={() => props.onToolClick?.("web_search")}
          >
            切换联网
          </button>
          <span data-testid="web-search-state">
            {props.activeTools?.web_search ? "on" : "off"}
          </span>
          <button
            type="button"
            data-testid="toggle-subagent-mode"
            onClick={() => props.onToolClick?.("subagent_mode")}
          >
            切换任务拆分
          </button>
          <span data-testid="subagent-state">
            {props.activeTools?.subagent_mode ? "on" : "off"}
          </span>
        </>
      ) : null}
      <button
        type="button"
        data-testid="send-btn"
        onClick={() => props.onSend?.()}
      >
        发送
      </button>
      <div data-testid="left-extra">{props.leftExtra}</div>
      <div data-testid="top-extra">{props.topExtra}</div>
    </div>
  ),
);

vi.mock("./components/InputbarCore", () => ({
  InputbarCore: (props: {
    onToolClick?: (tool: string) => void;
    activeTools?: Record<string, boolean>;
    onSend?: () => void;
    leftExtra?: React.ReactNode;
    topExtra?: React.ReactNode;
    placeholder?: string;
    toolMode?: "default" | "attach-only";
    showMetaTools?: boolean;
  }) => mockInputbarCore(props),
}));

vi.mock("../../skill-selection/CharacterMention", () => ({
  CharacterMention: (props: {
    characters?: Character[];
    skills?: Skill[];
    serviceSkills?: ServiceSkillHomeItem[];
    onSelectInputCapability?: (
      capability: InputCapabilitySelection,
      options?: { replayText?: string },
    ) => void;
    onSelectServiceSkill?: (skill: ServiceSkillHomeItem) => void;
    defaultCuratedTaskReferenceMemoryIds?: string[];
    defaultCuratedTaskReferenceEntries?: Array<{
      id: string;
      title: string;
      summary: string;
      category: string;
      categoryLabel: string;
      tags: string[];
    }>;
    inputCompletionEnabled?: boolean;
  }) => {
    mockCharacterMention(props);
    return <div data-testid="character-mention-stub" />;
  },
}));

vi.mock("../TaskFiles", () => ({
  TaskFileList: () => <div data-testid="task-file-list" />,
}));

vi.mock("../../skill-selection/SkillBadge", () => ({
  SkillBadge: () => <div data-testid="skill-badge" />,
}));

vi.mock("../../skill-selection/CuratedTaskBadge", () => ({
  CuratedTaskBadge: (props: {
    task?: {
      id?: string;
      title?: string;
      followUpActions?: string[];
    };
    projectId?: string | null;
    sessionId?: string | null;
    referenceEntries?: Array<{
      id: string;
      sourceKind?: string;
    }>;
    onEdit?: () => void;
    onApplyReviewSuggestion?: (task: {
      id: string;
      title: string;
      prompt: string;
      requiredInputFields: Array<{
        key: string;
        label: string;
        placeholder: string;
        type: "text" | "textarea";
      }>;
      outputContract: string[];
      followUpActions: string[];
    }) => void;
    onClear?: () => void;
  }) => (
    <div
      data-testid="curated-task-badge"
      data-task-id={props.task?.id ?? ""}
      data-project-id={props.projectId ?? ""}
      data-session-id={props.sessionId ?? ""}
      data-reference-count={String(props.referenceEntries?.length ?? 0)}
      data-first-source-kind={props.referenceEntries?.[0]?.sourceKind ?? ""}
    >
      <span>{props.task?.title}</span>
      <span>{props.task?.followUpActions?.join("、")}</span>
      <button
        type="button"
        data-testid="curated-task-badge-edit"
        onClick={props.onEdit}
      >
        编辑
      </button>
      <button
        type="button"
        data-testid="curated-task-badge-review-action"
        onClick={() => {
          const suggestedTask = findCuratedTaskTemplateById(
            "account-project-review",
          );
          if (suggestedTask) {
            props.onApplyReviewSuggestion?.(suggestedTask);
          }
        }}
      >
        改用复盘
      </button>
      <button
        type="button"
        data-testid="curated-task-badge-clear"
        onClick={props.onClear}
      >
        清除
      </button>
    </div>
  ),
}));

vi.mock("../CuratedTaskLauncherDialog", () => ({
  CuratedTaskLauncherDialog: (props: {
    open: boolean;
    task: {
      id: string;
      requiredInputFields: Array<{
        key: string;
        label: string;
      }>;
    } | null;
    projectId?: string | null;
    sessionId?: string | null;
    initialInputValues?: Record<string, string> | null;
    initialReferenceMemoryIds?: string[] | null;
    initialReferenceEntries?: Array<{
      id: string;
      title: string;
      summary: string;
      category: string;
      categoryLabel: string;
      tags: string[];
    }> | null;
    prefillHint?: string | null;
    onOpenChange?: (open: boolean) => void;
    onApplyReviewSuggestion?: (
      task: {
        id: string;
        requiredInputFields: Array<{
          key: string;
          label: string;
        }>;
        prompt: string;
        outputContract: string[];
        followUpActions: string[];
      },
      options: {
        inputValues: Record<string, string>;
        referenceSelection: {
          referenceMemoryIds: string[];
          referenceEntries: Array<{
            id: string;
            title: string;
            summary: string;
            category: string;
            categoryLabel: string;
            tags: string[];
          }>;
        };
      },
    ) => void;
    onConfirm?: (
      task: {
        id: string;
        requiredInputFields: Array<{
          key: string;
          label: string;
        }>;
      },
      inputValues: Record<string, string>,
      referenceSelection: {
        referenceMemoryIds: string[];
        referenceEntries: Array<{
          id: string;
          title: string;
          summary: string;
          category: string;
          categoryLabel: string;
          tags: string[];
        }>;
      },
    ) => void;
  }) => {
    const [inputValues, setInputValues] = React.useState<
      Record<string, string>
    >({});
    const [referenceMemoryIds, setReferenceMemoryIds] = React.useState<
      string[]
    >([]);

    React.useEffect(() => {
      if (!props.open || !props.task) {
        setInputValues({});
        setReferenceMemoryIds([]);
        return;
      }

      setInputValues(
        Object.fromEntries(
          props.task.requiredInputFields.map((field) => [
            field.key,
            String(props.initialInputValues?.[field.key] ?? ""),
          ]),
        ),
      );
      setReferenceMemoryIds(props.initialReferenceMemoryIds ?? []);
    }, [
      props.initialInputValues,
      props.initialReferenceMemoryIds,
      props.open,
      props.task,
    ]);

    if (!props.open || !props.task) {
      return null;
    }

    return (
      <div
        data-testid="curated-task-launcher-dialog"
        data-task-id={props.task.id}
        data-project-id={props.projectId ?? ""}
        data-session-id={props.sessionId ?? ""}
        data-reference-memory-count={String(referenceMemoryIds.length)}
      >
        {props.prefillHint ? (
          <div data-testid="curated-task-launcher-prefill-hint">
            {props.prefillHint}
          </div>
        ) : null}
        {props.task.requiredInputFields.map((field) => (
          <label key={field.key}>
            {field.label}
            <input
              data-testid={`curated-task-dialog-field-${field.key}`}
              value={inputValues[field.key] ?? ""}
              onChange={(event) =>
                setInputValues((current) => ({
                  ...current,
                  [field.key]: event.target.value,
                }))
              }
            />
          </label>
        ))}
        <button
          type="button"
          data-testid="curated-task-dialog-reference-toggle"
          onClick={() =>
            setReferenceMemoryIds((current) =>
              current.includes("memory-1") ? [] : ["memory-1"],
            )
          }
        >
          切换引用
        </button>
        <button
          type="button"
          data-testid="curated-task-dialog-review-action"
          onClick={() => {
            const suggestedTask = findCuratedTaskTemplateById(
              "account-project-review",
            );
            if (!suggestedTask) {
              return;
            }

            props.onApplyReviewSuggestion?.(suggestedTask, {
              inputValues,
              referenceSelection: {
                referenceMemoryIds,
                referenceEntries: referenceMemoryIds.includes("memory-1")
                  ? [
                      {
                        id: "memory-1",
                        title: "品牌风格样本",
                        summary: "保留轻盈但专业的表达。",
                        category: "context",
                        categoryLabel: "参考",
                        tags: ["品牌", "语气"],
                      },
                    ]
                  : [],
              },
            });
          }}
        >
          改用复盘
        </button>
        <button
          type="button"
          data-testid="curated-task-dialog-confirm"
          onClick={() =>
            props.onConfirm?.(props.task!, inputValues, {
              referenceMemoryIds,
              referenceEntries: referenceMemoryIds.includes("memory-1")
                ? [
                    {
                      id: "memory-1",
                      title: "品牌风格样本",
                      summary: "保留轻盈但专业的表达。",
                      category: "context",
                      categoryLabel: "参考",
                      tags: ["品牌", "语气"],
                    },
                  ]
                : [],
            })
          }
        >
          确认
        </button>
        <button
          type="button"
          data-testid="curated-task-dialog-close"
          onClick={() => props.onOpenChange?.(false)}
        >
          关闭
        </button>
      </div>
    );
  },
}));

vi.mock("./components/RuntimeSceneBadge", () => ({
  RuntimeSceneBadge: () => <div data-testid="runtime-scene-badge" />,
}));

vi.mock("./components/TeamSelector", () => ({
  TeamSelector: (props: { autoOpenToken?: number | null }) => (
    <div
      data-testid="team-selector-stub"
      data-auto-open-token={String(props.autoOpenToken ?? "")}
    />
  ),
}));

vi.mock("../ChatModelSelector", () => ({
  ChatModelSelector: () => <div data-testid="model-selector" />,
}));

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(async () => []),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectItem: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));

vi.mock("@/components/input-kit", () => ({
  createAgentInputAdapter: (options: {
    text: string;
    setText: (value: string) => void;
    isSending: boolean;
    disabled?: boolean;
    attachments?: unknown[];
    providerType: string;
    model: string;
    setProviderType: (providerType: string) => void;
    setModel: (model: string) => void;
    stop?: () => void;
  }) => ({
    state: {
      text: options.text,
      isSending: options.isSending,
      disabled: options.disabled,
      attachments: options.attachments,
    },
    model: {
      providerType: options.providerType,
      model: options.model,
    },
    actions: {
      setText: options.setText,
      send: vi.fn(),
      stop: options.stop,
      setProviderType: options.setProviderType,
      setModel: options.setModel,
    },
    ui: {
      showModelSelector: true,
      showToolBar: true,
    },
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
});

afterEach(() => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) break;
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  vi.useRealTimers();
  vi.clearAllMocks();
});

function renderInputbar(
  props?: Partial<React.ComponentProps<typeof Inputbar>>,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const defaultProps: React.ComponentProps<typeof Inputbar> = {
    input: "",
    setInput: vi.fn(),
    onSend: vi.fn(),
    isLoading: false,
    characters: [],
    skills: [],
  };

  const render = (
    nextProps?: Partial<React.ComponentProps<typeof Inputbar>>,
  ) => {
    act(() => {
      root.render(<Inputbar {...defaultProps} {...props} {...nextProps} />);
    });
  };

  render();

  mountedRoots.push({ root, container });
  return {
    container,
    rerender: render,
  };
}

function expandAdvancedControls(container: HTMLDivElement) {
  const toggleButton = container.querySelector(
    '[data-testid="inputbar-advanced-toggle"]',
  ) as HTMLButtonElement | null;

  expect(toggleButton).toBeTruthy();

  act(() => {
    toggleButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  return toggleButton;
}

function updateFieldValue(
  element: HTMLInputElement | HTMLTextAreaElement | null,
  value: string,
) {
  expect(element).toBeTruthy();
  if (!element) {
    return;
  }

  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("Inputbar", () => {
  it("即使角色和技能为空，也应挂载 CharacterMention", async () => {
    const { container } = renderInputbar();
    await act(async () => {
      await Promise.resolve();
    });

    const mention = container.querySelector(
      '[data-testid="character-mention-stub"]',
    );
    expect(mention).toBeTruthy();
    expect(mockCharacterMention.mock.calls.length).toBeGreaterThan(0);
    const latestCall =
      mockCharacterMention.mock.calls[
        mockCharacterMention.mock.calls.length - 1
      ][0];
    expect(latestCall.characters).toEqual([]);
    expect(latestCall.skills).toEqual([]);
  });

  it("应把输入自动补全开关透传给现有 CharacterMention 主链", async () => {
    renderInputbar({
      inputCompletionEnabled: false,
    });

    await act(async () => {
      await Promise.resolve();
    });

    const latestCall =
      mockCharacterMention.mock.calls[
        mockCharacterMention.mock.calls.length - 1
      ][0];

    expect(latestCall.inputCompletionEnabled).toBe(false);
  });

  it("应把当前带入的灵感引用默认值透传给 CharacterMention", async () => {
    renderInputbar({
      defaultCuratedTaskReferenceMemoryIds: ["memory-1"],
      defaultCuratedTaskReferenceEntries: [
        {
          id: "memory-1",
          title: "品牌风格样本",
          summary: "保留轻盈但专业的表达。",
          category: "context",
          categoryLabel: "参考",
          tags: ["品牌", "语气"],
        },
      ],
    });

    await act(async () => {
      await Promise.resolve();
    });

    const latestCall =
      mockCharacterMention.mock.calls[
        mockCharacterMention.mock.calls.length - 1
      ][0];

    expect(latestCall.defaultCuratedTaskReferenceMemoryIds).toEqual([
      "memory-1",
    ]);
    expect(latestCall.defaultCuratedTaskReferenceEntries).toEqual([
      expect.objectContaining({
        id: "memory-1",
        title: "品牌风格样本",
      }),
    ]);
  });

  it("应将服务型技能目录透传给 CharacterMention，并经统一 capability 触发启动", async () => {
    const serviceSkills = [
      {
        id: "daily-trend-briefing",
        title: "每日趋势摘要",
      },
    ] as ServiceSkillHomeItem[];
    const onSelectServiceSkill = vi.fn();

    renderInputbar({
      serviceSkills,
      onSelectServiceSkill,
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockCharacterMention.mock.calls.length).toBeGreaterThan(0);
    const latestCall =
      mockCharacterMention.mock.calls[
        mockCharacterMention.mock.calls.length - 1
      ][0];

    expect(latestCall.serviceSkills).toBe(serviceSkills);
    expect(latestCall.onSelectInputCapability).toBeTypeOf("function");

    await act(async () => {
      latestCall.onSelectInputCapability?.({
        kind: "service_skill",
        skill: serviceSkills[0] as ServiceSkillHomeItem,
      });
      await Promise.resolve();
    });

    expect(onSelectServiceSkill).toHaveBeenCalledWith(serviceSkills[0]);
  });

  it("先选内建命令再选技能时，应以后一次 capability 为准发送", async () => {
    const onSend = vi.fn();
    const skill = {
      key: "writer",
      name: "写作助手",
      description: "用于写作",
      directory: "writer",
      installed: true,
      sourceKind: "builtin",
    } as Skill;
    renderInputbar({
      input: "整理最近发布计划",
      onSend,
      activeTheme: "general",
      skills: [skill],
    });

    await act(async () => {
      await Promise.resolve();
    });

    const builtinCommand: BuiltinInputCommand = {
      key: "research",
      label: "搜索",
      mentionLabel: "搜索",
      commandPrefix: "@搜索",
      description: "搜索资料",
      aliases: [],
    };
    const firstCall =
      mockCharacterMention.mock.calls[
        mockCharacterMention.mock.calls.length - 1
      ]?.[0];
    expect(firstCall?.onSelectInputCapability).toBeTypeOf("function");

    await act(async () => {
      firstCall?.onSelectInputCapability?.({
        kind: "builtin_command",
        command: builtinCommand,
      });
      await Promise.resolve();
    });

    const secondCall =
      mockCharacterMention.mock.calls[
        mockCharacterMention.mock.calls.length - 1
      ]?.[0];

    await act(async () => {
      secondCall?.onSelectInputCapability?.({
        kind: "installed_skill",
        skill,
      });
      await Promise.resolve();
    });

    const sendButton = document.querySelector(
      '[data-testid="send-btn"]',
    ) as HTMLButtonElement | null;
    expect(sendButton).toBeTruthy();

    await act(async () => {
      sendButton?.click();
      await Promise.resolve();
    });

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith(
      undefined,
      false,
      false,
      undefined,
      "react",
      undefined,
      {
        capabilityRoute: {
          kind: "installed_skill",
          skillKey: "writer",
          skillName: "写作助手",
        },
        displayContent: "整理最近发布计划",
      },
    );
  });

  it("带着初始已安装技能进入时，应恢复 capability badge 并继续按 route 发送", async () => {
    const onSend = vi.fn();
    const skill = {
      key: "writer",
      name: "写作助手",
      description: "用于写作",
      directory: "writer",
      installed: true,
      sourceKind: "builtin",
    } as Skill;
    renderInputbar({
      input: "整理最近发布计划",
      onSend,
      activeTheme: "general",
      skills: [skill],
      initialInputCapability: {
        capabilityRoute: {
          kind: "installed_skill",
          skillKey: "writer",
          skillName: "写作助手",
        },
        requestKey: 20260418,
      },
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(document.querySelector('[data-testid="skill-badge"]')).toBeTruthy();

    const sendButton = document.querySelector(
      '[data-testid="send-btn"]',
    ) as HTMLButtonElement | null;
    expect(sendButton).toBeTruthy();

    await act(async () => {
      sendButton?.click();
      await Promise.resolve();
    });

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith(
      undefined,
      false,
      false,
      undefined,
      "react",
      undefined,
      {
        capabilityRoute: {
          kind: "installed_skill",
          skillKey: "writer",
          skillName: "写作助手",
        },
        displayContent: "整理最近发布计划",
      },
    );
  });

  it("选择结果模板发送时，应透传 curated_task capability route", async () => {
    const onSend = vi.fn();
    renderInputbar({
      input:
        "请先帮我起草一版内容首稿：明确目标受众、标题方向、正文结构、核心观点和可继续扩写的角度，并给我一版适合继续打磨的正文。",
      onSend,
      activeTheme: "general",
    });

    await act(async () => {
      await Promise.resolve();
    });

    const latestCall =
      mockCharacterMention.mock.calls[
        mockCharacterMention.mock.calls.length - 1
      ]?.[0];

    await act(async () => {
      latestCall?.onSelectInputCapability?.({
        kind: "curated_task",
        task: {
          id: "social-post-starter",
          title: "内容主稿生成",
          summary: "生成一版可继续打磨的内容首稿。",
          outputHint: "内容首稿 + 结构提纲",
          resultDestination:
            "首版主稿会先进入当前内容，方便继续改写、拆成多平台版本。",
          categoryLabel: "内容起稿",
          prompt:
            "请先帮我起草一版内容首稿：明确目标受众、标题方向、正文结构、核心观点和可继续扩写的角度，并给我一版适合继续打磨的正文。",
          requiredInputs: ["主题或产品信息", "目标受众"],
          requiredInputFields: [
            {
              key: "subject_or_product",
              label: "主题或产品信息",
              placeholder: "输入主题、产品、活动或你已经掌握的关键信息",
              type: "textarea",
            },
            {
              key: "target_audience",
              label: "目标受众",
              placeholder:
                "例如 25-35 岁新消费品牌运营，或 正在找 AI 剪辑工具的创作者",
              type: "text",
            },
          ],
          optionalReferences: ["品牌语气", "参考案例或灵感图片"],
          outputContract: ["内容首稿", "结构提纲", "可继续扩写角度"],
          followUpActions: ["改成多平台版本", "转成口播/字幕稿"],
          badge: "结果模板",
          actionLabel: "进入生成",
          statusLabel: "可直接开始",
          statusTone: "emerald",
          recentUsedAt: null,
          isRecent: false,
        },
      });
      await Promise.resolve();
    });

    expect(
      document.querySelector('[data-testid="curated-task-badge"]'),
    ).toBeTruthy();

    const sendButton = document.querySelector(
      '[data-testid="send-btn"]',
    ) as HTMLButtonElement | null;
    expect(sendButton).toBeTruthy();

    await act(async () => {
      sendButton?.click();
      await Promise.resolve();
    });

    expect(onSend).toHaveBeenCalledWith(
      undefined,
      false,
      false,
      undefined,
      "react",
      undefined,
      expect.objectContaining({
        capabilityRoute: {
          kind: "curated_task",
          taskId: "social-post-starter",
          taskTitle: "内容主稿生成",
          prompt:
            "请先帮我起草一版内容首稿：明确目标受众、标题方向、正文结构、核心观点和可继续扩写的角度，并给我一版适合继续打磨的正文。",
        },
        displayContent:
          "请先帮我起草一版内容首稿：明确目标受众、标题方向、正文结构、核心观点和可继续扩写的角度，并给我一版适合继续打磨的正文。",
        requestMetadata: {
          harness: {
            curated_task: expect.objectContaining({
              task_id: "social-post-starter",
              task_title: "内容主稿生成",
            }),
          },
        },
      }),
    );
  });

  it("Generate 内发送 curated_task 后，应把最新启动事实写回 recent usage", async () => {
    const template = findCuratedTaskTemplateById("daily-trend-briefing");
    expect(template).toBeTruthy();

    const launchInputValues = {
      theme_target: "AI 内容创作",
      platform_region: "X 与 TikTok 北美区",
    };
    const referenceEntries = [
      {
        id: "memory-1",
        sourceKind: "memory" as const,
        title: "品牌风格样本",
        summary: "轻盈但专业的品牌语气参考。",
        category: "context" as const,
        categoryLabel: "参考",
        tags: ["品牌", "语气"],
      },
    ];
    const prompt = buildCuratedTaskLaunchPrompt({
      task: template!,
      inputValues: launchInputValues,
      referenceEntries,
    });
    const onSend = vi.fn().mockResolvedValue(true);

    renderInputbar({
      input: prompt,
      onSend,
      activeTheme: "general",
      initialInputCapability: {
        capabilityRoute: {
          kind: "curated_task",
          taskId: "daily-trend-briefing",
          taskTitle: "每日趋势摘要",
          prompt,
          launchInputValues,
          referenceMemoryIds: ["memory-1"],
          referenceEntries,
        },
        requestKey: 2026042101,
      },
    });

    await act(async () => {
      await Promise.resolve();
    });

    const sendButton = document.querySelector(
      '[data-testid="send-btn"]',
    ) as HTMLButtonElement | null;
    expect(sendButton).toBeTruthy();

    await act(async () => {
      sendButton?.click();
      await Promise.resolve();
    });

    expect(resolveCuratedTaskTemplateLaunchPrefill(template!)).toEqual(
      expect.objectContaining({
        inputValues: launchInputValues,
        referenceMemoryIds: ["memory-1"],
        hint: expect.stringContaining("已根据你上次启动"),
        referenceEntries: [
          expect.objectContaining({
            id: "memory-1",
            sourceKind: "memory",
            title: "品牌风格样本",
            summary: "轻盈但专业的品牌语气参考。",
          }),
        ],
      }),
    );
  });

  it("发送被上层拦截时，不应写入 curated task recent usage", async () => {
    const template = findCuratedTaskTemplateById("daily-trend-briefing");
    expect(template).toBeTruthy();

    const prompt = buildCuratedTaskLaunchPrompt({
      task: template!,
      inputValues: {
        theme_target: "AI 内容创作",
      },
    });
    const onSend = vi.fn().mockResolvedValue(false);

    renderInputbar({
      input: prompt,
      onSend,
      activeTheme: "general",
      initialInputCapability: {
        capabilityRoute: {
          kind: "curated_task",
          taskId: "daily-trend-briefing",
          taskTitle: "每日趋势摘要",
          prompt,
          launchInputValues: {
            theme_target: "AI 内容创作",
          },
        },
        requestKey: 2026042102,
      },
    });

    await act(async () => {
      await Promise.resolve();
    });

    const sendButton = document.querySelector(
      '[data-testid="send-btn"]',
    ) as HTMLButtonElement | null;
    expect(sendButton).toBeTruthy();

    await act(async () => {
      sendButton?.click();
      await Promise.resolve();
    });

    expect(resolveCuratedTaskTemplateLaunchPrefill(template!)).toBeNull();
  });

  it("带着缺少启动槽位的初始结果模板进入时，应先打开 launcher 而不是直接预填 prompt", async () => {
    const setInput = vi.fn();
    renderInputbar({
      input: "",
      setInput,
      onSend: vi.fn(),
      activeTheme: "general",
      initialInputCapability: {
        capabilityRoute: {
          kind: "curated_task",
          taskId: "daily-trend-briefing",
          taskTitle: "每日趋势摘要",
          prompt:
            "请先给我做一版每日趋势摘要：围绕当前主题梳理最近值得关注的趋势、热点内容方向、代表案例、用户正在关心的问题，以及最值得立即开工的 3 个选题。",
        },
        requestKey: 20260418,
      },
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(setInput).not.toHaveBeenCalled();
    expect(
      document.querySelector(
        '[data-testid="curated-task-dialog-field-theme_target"]',
      ),
    ).toBeTruthy();
    expect(
      document.querySelector(
        '[data-testid="curated-task-dialog-field-platform_region"]',
      ),
    ).toBeTruthy();

    const confirmButton = document.querySelector(
      '[data-testid="curated-task-dialog-confirm"]',
    );
    expect(confirmButton).toBeTruthy();

    const curatedTaskBadge = document.querySelector(
      '[data-testid="curated-task-badge"]',
    ) as HTMLElement | null;
    expect(curatedTaskBadge).toBeTruthy();
    expect(curatedTaskBadge?.textContent).toContain("每日趋势摘要");
    expect(curatedTaskBadge?.textContent).toContain(
      "继续展开其中一个选题、生成首条内容主稿",
    );
  });

  it("带着已确认启动信息的初始结果模板进入时，应恢复 capability badge 并在输入为空时预填 prompt", async () => {
    const onSend = vi.fn();
    const setInput = vi.fn();
    const initialLaunchInputValues = {
      theme_target: "AI 内容创作",
      platform_region: "X 与 TikTok 北美区",
    };
    const initialPrompt = buildCuratedTaskLaunchPrompt({
      task: {
        prompt:
          "请先给我做一版每日趋势摘要：围绕当前主题梳理最近值得关注的趋势、热点内容方向、代表案例、用户正在关心的问题，以及最值得立即开工的 3 个选题。",
        requiredInputFields: [
          {
            key: "theme_target",
            label: "主题或赛道",
            placeholder: "",
            type: "text",
          },
          {
            key: "platform_region",
            label: "希望关注的平台/地域",
            placeholder: "",
            type: "text",
          },
        ],
        outputContract: ["趋势摘要", "3 个优先选题", "代表案例线索"],
      },
      inputValues: initialLaunchInputValues,
    });
    const rendered = renderInputbar({
      input: "",
      setInput,
      onSend,
      activeTheme: "general",
      initialInputCapability: {
        capabilityRoute: {
          kind: "curated_task",
          taskId: "daily-trend-briefing",
          taskTitle: "每日趋势摘要",
          prompt: initialPrompt,
          launchInputValues: initialLaunchInputValues,
        },
        requestKey: 20260418,
      },
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(setInput).toHaveBeenCalledWith(initialPrompt);
    expect(
      document.querySelector(
        '[data-testid="curated-task-dialog-field-theme_target"]',
      ),
    ).toBeFalsy();

    rendered.rerender({
      input: initialPrompt,
      setInput,
      onSend,
      activeTheme: "general",
      initialInputCapability: {
        capabilityRoute: {
          kind: "curated_task",
          taskId: "daily-trend-briefing",
          taskTitle: "每日趋势摘要",
          prompt: initialPrompt,
          launchInputValues: initialLaunchInputValues,
        },
        requestKey: 20260418,
      },
    });

    const sendButton = document.querySelector(
      '[data-testid="send-btn"]',
    ) as HTMLButtonElement | null;
    expect(sendButton).toBeTruthy();

    await act(async () => {
      sendButton?.click();
      await Promise.resolve();
    });

    expect(onSend).toHaveBeenCalledWith(
      undefined,
      false,
      false,
      undefined,
      "react",
      undefined,
      expect.objectContaining({
        capabilityRoute: {
          kind: "curated_task",
          taskId: "daily-trend-briefing",
          taskTitle: "每日趋势摘要",
          prompt: initialPrompt,
          launchInputValues: initialLaunchInputValues,
        },
        displayContent: initialPrompt,
        requestMetadata: {
          harness: {
            curated_task: expect.objectContaining({
              task_id: "daily-trend-briefing",
              task_title: "每日趋势摘要",
              launch_input_values: initialLaunchInputValues,
            }),
          },
        },
      }),
    );
  });

  it("输入条已激活结果模板时，应把 projectId/sessionId 透传给 badge 和编辑态 launcher", async () => {
    const initialLaunchInputValues = {
      theme_target: "AI 内容创作",
      platform_region: "X 与 TikTok 北美区",
    };
    const initialPrompt = buildCuratedTaskLaunchPrompt({
      task: {
        prompt:
          "请先给我做一版每日趋势摘要：围绕当前主题梳理最近值得关注的趋势、热点内容方向、代表案例、用户正在关心的问题，以及最值得立即开工的 3 个选题。",
        requiredInputFields: [
          {
            key: "theme_target",
            label: "主题或赛道",
            placeholder: "",
            type: "text",
          },
          {
            key: "platform_region",
            label: "希望关注的平台/地域",
            placeholder: "",
            type: "text",
          },
        ],
        outputContract: ["趋势摘要", "3 个优先选题", "代表案例线索"],
      },
      inputValues: initialLaunchInputValues,
    });

    renderInputbar({
      input: initialPrompt,
      activeTheme: "general",
      projectId: "project-review-chain",
      sessionId: "session-review-chain",
      initialInputCapability: {
        capabilityRoute: {
          kind: "curated_task",
          taskId: "daily-trend-briefing",
          taskTitle: "每日趋势摘要",
          prompt: initialPrompt,
          launchInputValues: initialLaunchInputValues,
        },
        requestKey: 2026042201,
      },
    });

    await act(async () => {
      await Promise.resolve();
    });

    const curatedTaskBadge = document.querySelector(
      '[data-testid="curated-task-badge"]',
    ) as HTMLDivElement | null;
    expect(curatedTaskBadge?.dataset.projectId).toBe("project-review-chain");
    expect(curatedTaskBadge?.dataset.sessionId).toBe("session-review-chain");

    const editButton = document.querySelector(
      '[data-testid="curated-task-badge-edit"]',
    ) as HTMLButtonElement | null;
    expect(editButton).toBeTruthy();

    await act(async () => {
      editButton?.click();
      await Promise.resolve();
    });

    const launcherDialog = document.querySelector(
      '[data-testid="curated-task-launcher-dialog"]',
    ) as HTMLDivElement | null;
    expect(launcherDialog?.dataset.projectId).toBe("project-review-chain");
    expect(launcherDialog?.dataset.sessionId).toBe("session-review-chain");
  });

  it("输入条已激活结果模板时，应支持从 badge 直接切到最近判断推荐模板", async () => {
    const setInput = vi.fn();
    const onSend = vi.fn();
    const initialLaunchInputValues = {
      theme_target: "AI 内容创作",
      platform_region: "X 与 TikTok 北美区",
    };
    const initialPrompt = buildCuratedTaskLaunchPrompt({
      task: {
        prompt:
          "请先给我做一版每日趋势摘要：围绕当前主题梳理最近值得关注的趋势、热点内容方向、代表案例、用户正在关心的问题，以及最值得立即开工的 3 个选题。",
        requiredInputFields: [
          {
            key: "theme_target",
            label: "主题或赛道",
            placeholder: "",
            type: "text",
          },
          {
            key: "platform_region",
            label: "希望关注的平台/地域",
            placeholder: "",
            type: "text",
          },
        ],
        outputContract: ["趋势摘要", "3 个优先选题", "代表案例线索"],
      },
      inputValues: initialLaunchInputValues,
    });
    const suggestedTask = findCuratedTaskTemplateById("account-project-review");
    expect(suggestedTask).toBeTruthy();
    const expectedPrompt = buildCuratedTaskLaunchPrompt({
      task: suggestedTask!,
      inputValues: initialLaunchInputValues,
    });
    const rendered = renderInputbar({
      input: initialPrompt,
      setInput,
      onSend,
      activeTheme: "general",
      initialInputCapability: {
        capabilityRoute: {
          kind: "curated_task",
          taskId: "daily-trend-briefing",
          taskTitle: "每日趋势摘要",
          prompt: initialPrompt,
          launchInputValues: initialLaunchInputValues,
        },
        requestKey: 2026042401,
      },
    });

    await act(async () => {
      await Promise.resolve();
    });

    const reviewAction = document.querySelector(
      '[data-testid="curated-task-badge-review-action"]',
    ) as HTMLButtonElement | null;
    expect(reviewAction).toBeTruthy();

    await act(async () => {
      reviewAction?.click();
      await Promise.resolve();
    });

    expect(setInput).toHaveBeenLastCalledWith(expectedPrompt);

    const curatedTaskBadge = document.querySelector(
      '[data-testid="curated-task-badge"]',
    ) as HTMLDivElement | null;
    expect(curatedTaskBadge?.dataset.taskId).toBe("account-project-review");

    rendered.rerender({
      input: expectedPrompt,
      setInput,
      onSend,
      activeTheme: "general",
      initialInputCapability: {
        capabilityRoute: {
          kind: "curated_task",
          taskId: "daily-trend-briefing",
          taskTitle: "每日趋势摘要",
          prompt: initialPrompt,
          launchInputValues: initialLaunchInputValues,
        },
        requestKey: 2026042401,
      },
    });

    const sendButton = document.querySelector(
      '[data-testid="send-btn"]',
    ) as HTMLButtonElement | null;
    expect(sendButton).toBeTruthy();

    await act(async () => {
      sendButton?.click();
      await Promise.resolve();
    });

    expect(onSend).toHaveBeenCalledWith(
      undefined,
      false,
      false,
      undefined,
      "react",
      undefined,
      expect.objectContaining({
        capabilityRoute: expect.objectContaining({
          kind: "curated_task",
          taskId: "account-project-review",
          prompt: expectedPrompt,
          launchInputValues: initialLaunchInputValues,
        }),
        displayContent: expectedPrompt,
      }),
    );
  });

  it("输入条编辑态 launcher 按最近判断切模板时，应保留参考选择并显示提示", async () => {
    const initialLaunchInputValues = {
      theme_target: "AI 内容创作",
      platform_region: "X 与 TikTok 北美区",
    };
    const initialPrompt = buildCuratedTaskLaunchPrompt({
      task: {
        prompt:
          "请先给我做一版每日趋势摘要：围绕当前主题梳理最近值得关注的趋势、热点内容方向、代表案例、用户正在关心的问题，以及最值得立即开工的 3 个选题。",
        requiredInputFields: [
          {
            key: "theme_target",
            label: "主题或赛道",
            placeholder: "",
            type: "text",
          },
          {
            key: "platform_region",
            label: "希望关注的平台/地域",
            placeholder: "",
            type: "text",
          },
        ],
        outputContract: ["趋势摘要", "3 个优先选题", "代表案例线索"],
      },
      inputValues: initialLaunchInputValues,
    });

    renderInputbar({
      input: initialPrompt,
      activeTheme: "general",
      initialInputCapability: {
        capabilityRoute: {
          kind: "curated_task",
          taskId: "daily-trend-briefing",
          taskTitle: "每日趋势摘要",
          prompt: initialPrompt,
          launchInputValues: initialLaunchInputValues,
        },
        requestKey: 2026042402,
      },
    });

    await act(async () => {
      await Promise.resolve();
    });

    const editButton = document.querySelector(
      '[data-testid="curated-task-badge-edit"]',
    ) as HTMLButtonElement | null;
    expect(editButton).toBeTruthy();

    await act(async () => {
      editButton?.click();
      await Promise.resolve();
    });

    const referenceToggle = document.querySelector(
      '[data-testid="curated-task-dialog-reference-toggle"]',
    ) as HTMLButtonElement | null;
    expect(referenceToggle).toBeTruthy();

    await act(async () => {
      referenceToggle?.click();
      await Promise.resolve();
    });

    const reviewAction = document.querySelector(
      '[data-testid="curated-task-dialog-review-action"]',
    ) as HTMLButtonElement | null;
    expect(reviewAction).toBeTruthy();

    await act(async () => {
      reviewAction?.click();
      await Promise.resolve();
    });

    const launcherDialog = document.querySelector(
      '[data-testid="curated-task-launcher-dialog"]',
    ) as HTMLDivElement | null;
    expect(launcherDialog?.dataset.taskId).toBe("account-project-review");
    expect(launcherDialog?.dataset.referenceMemoryCount).toBe("1");

    const prefillHint = document.querySelector(
      '[data-testid="curated-task-launcher-prefill-hint"]',
    );
    expect(prefillHint?.textContent).toContain(
      "已按最近判断切到更适合的结果模板",
    );
  });

  it("输入条已激活复盘模板时，应把 sceneapp 项目结果引用透传给 badge", async () => {
    renderInputbar({
      input: "请帮我判断这个账号或项目当前该怎么推进",
      activeTheme: "general",
      initialInputCapability: {
        capabilityRoute: {
          kind: "curated_task",
          taskId: "account-project-review",
          taskTitle: "复盘这个账号/项目",
          prompt: "请帮我判断这个账号或项目当前该怎么推进",
          launchInputValues: {
            project_goal: "AI 内容周报",
            existing_results: "当前已有一轮项目结果，可直接作为复盘基线。",
          },
          referenceEntries: [
            {
              id: "sceneapp:content-pack:run:1",
              sourceKind: "sceneapp_execution_summary",
              title: "AI 内容周报",
              summary: "当前已有一轮项目结果，可直接作为复盘基线。",
              category: "experience",
              categoryLabel: "成果",
              tags: ["复盘"],
            },
          ],
        },
        requestKey: 2026042301,
      },
    });

    await act(async () => {
      await Promise.resolve();
    });

    const curatedTaskBadge = document.querySelector(
      '[data-testid="curated-task-badge"]',
    ) as HTMLDivElement | null;
    expect(curatedTaskBadge?.dataset.referenceCount).toBe("1");
    expect(curatedTaskBadge?.dataset.firstSourceKind).toBe(
      "sceneapp_execution_summary",
    );
  });

  it("结果模板带着灵感引用发送时，应附带结构化 request metadata", async () => {
    const onSend = vi.fn();
    renderInputbar({
      input: "请先给我做一版每日趋势摘要",
      onSend,
      activeTheme: "general",
    });

    await act(async () => {
      await Promise.resolve();
    });

    const latestCall =
      mockCharacterMention.mock.calls[
        mockCharacterMention.mock.calls.length - 1
      ]?.[0];

    await act(async () => {
      latestCall?.onSelectInputCapability?.({
        kind: "curated_task",
        task: {
          id: "daily-trend-briefing",
          title: "每日趋势摘要",
          summary: "先收一版趋势摘要。",
          outputHint: "趋势摘要 + 选题方向",
          resultDestination:
            "趋势摘要会先写回当前内容，方便继续展开选题和主稿。",
          categoryLabel: "趋势与选题",
          prompt: "请先给我做一版每日趋势摘要",
          requiredInputs: ["主题或赛道", "希望关注的平台/地域"],
          requiredInputFields: [],
          optionalReferences: ["已有账号方向", "过去爆款链接"],
          outputContract: ["趋势摘要", "3 个优先选题"],
          followUpActions: ["继续展开其中一个选题"],
          badge: "结果模板",
          actionLabel: "进入生成",
          statusLabel: "可直接开始",
          statusTone: "emerald",
          recentUsedAt: null,
          isRecent: false,
        },
        referenceMemoryIds: ["memory-1"],
        referenceEntries: [
          {
            id: "memory-1",
            title: "品牌风格样本",
            summary: "保留轻盈但专业的表达。",
            category: "context",
            categoryLabel: "参考",
            tags: ["品牌", "语气"],
          },
        ],
      });
      await Promise.resolve();
    });

    const sendButton = document.querySelector(
      '[data-testid="send-btn"]',
    ) as HTMLButtonElement | null;
    expect(sendButton).toBeTruthy();

    await act(async () => {
      sendButton?.click();
      await Promise.resolve();
    });

    expect(onSend).toHaveBeenCalledWith(
      undefined,
      false,
      false,
      undefined,
      "react",
      undefined,
      expect.objectContaining({
        capabilityRoute: expect.objectContaining({
          kind: "curated_task",
          taskId: "daily-trend-briefing",
          referenceMemoryIds: ["memory-1"],
        }),
        requestMetadata: {
          harness: {
            creation_replay: expect.objectContaining({
              kind: "memory_entry",
            }),
            curated_task: expect.objectContaining({
              task_id: "daily-trend-briefing",
              reference_memory_ids: ["memory-1"],
              reference_entries: [
                expect.objectContaining({
                  id: "memory-1",
                }),
              ],
            }),
          },
        },
      }),
    );
  });

  it("已激活结果模板后重新编辑启动信息时，应更新输入与 curated_task route", async () => {
    const setInput = vi.fn();
    const onSend = vi.fn();
    const initialLaunchInputValues = {
      theme_target: "AI 内容创作",
      platform_region: "X 与 TikTok 北美区",
    };
    const editedLaunchInputValues = {
      theme_target: "品牌内容中台",
      platform_region: "LinkedIn 与 X（海外）",
    };
    const taskDefinition = {
      prompt:
        "请先给我做一版每日趋势摘要：围绕当前主题梳理最近值得关注的趋势、热点内容方向、代表案例、用户正在关心的问题，以及最值得立即开工的 3 个选题。",
      requiredInputFields: [
        {
          key: "theme_target",
          label: "主题或赛道",
          placeholder: "",
          type: "text" as const,
        },
        {
          key: "platform_region",
          label: "希望关注的平台/地域",
          placeholder: "",
          type: "text" as const,
        },
      ],
      outputContract: ["趋势摘要", "3 个优先选题", "代表案例线索"],
    };
    const initialPrompt = buildCuratedTaskLaunchPrompt({
      task: taskDefinition,
      inputValues: initialLaunchInputValues,
    });
    const editedPrompt = buildCuratedTaskLaunchPrompt({
      task: taskDefinition,
      inputValues: editedLaunchInputValues,
    });
    const rendered = renderInputbar({
      input: initialPrompt,
      setInput,
      onSend,
      activeTheme: "general",
      initialInputCapability: {
        capabilityRoute: {
          kind: "curated_task",
          taskId: "daily-trend-briefing",
          taskTitle: "每日趋势摘要",
          prompt: initialPrompt,
          launchInputValues: initialLaunchInputValues,
        },
        requestKey: 20260419,
      },
    });

    await act(async () => {
      await Promise.resolve();
    });

    const editButton = document.querySelector(
      '[data-testid="curated-task-badge-edit"]',
    ) as HTMLButtonElement | null;
    expect(editButton).toBeTruthy();

    await act(async () => {
      editButton?.click();
      await Promise.resolve();
    });

    const themeInput = document.querySelector(
      '[data-testid="curated-task-dialog-field-theme_target"]',
    ) as HTMLInputElement | null;
    const platformInput = document.querySelector(
      '[data-testid="curated-task-dialog-field-platform_region"]',
    ) as HTMLInputElement | null;

    expect(themeInput?.value).toBe("AI 内容创作");
    expect(platformInput?.value).toBe("X 与 TikTok 北美区");

    await act(async () => {
      updateFieldValue(themeInput, editedLaunchInputValues.theme_target);
      updateFieldValue(platformInput, editedLaunchInputValues.platform_region);
      await Promise.resolve();
    });

    const confirmButton = document.querySelector(
      '[data-testid="curated-task-dialog-confirm"]',
    ) as HTMLButtonElement | null;
    expect(confirmButton).toBeTruthy();

    await act(async () => {
      confirmButton?.click();
      await Promise.resolve();
    });

    expect(setInput).toHaveBeenLastCalledWith(editedPrompt);

    rendered.rerender({
      input: editedPrompt,
      setInput,
      onSend,
      activeTheme: "general",
      initialInputCapability: {
        capabilityRoute: {
          kind: "curated_task",
          taskId: "daily-trend-briefing",
          taskTitle: "每日趋势摘要",
          prompt: initialPrompt,
          launchInputValues: initialLaunchInputValues,
        },
        requestKey: 20260419,
      },
    });

    const sendButton = document.querySelector(
      '[data-testid="send-btn"]',
    ) as HTMLButtonElement | null;
    expect(sendButton).toBeTruthy();

    await act(async () => {
      sendButton?.click();
      await Promise.resolve();
    });

    expect(onSend).toHaveBeenCalledWith(
      undefined,
      false,
      false,
      undefined,
      "react",
      undefined,
      expect.objectContaining({
        capabilityRoute: {
          kind: "curated_task",
          taskId: "daily-trend-briefing",
          taskTitle: "每日趋势摘要",
          prompt: editedPrompt,
          launchInputValues: editedLaunchInputValues,
        },
        displayContent: editedPrompt,
        requestMetadata: {
          harness: {
            curated_task: expect.objectContaining({
              task_id: "daily-trend-briefing",
              launch_input_values: editedLaunchInputValues,
            }),
          },
        },
      }),
    );
  });

  it("选择内建命令发送时，应透传 capability route 与原始显示文案", async () => {
    const onSend = vi.fn();
    renderInputbar({
      input: "整理最近发布计划",
      onSend,
      activeTheme: "general",
    });

    await act(async () => {
      await Promise.resolve();
    });

    const builtinCommand: BuiltinInputCommand = {
      key: "research",
      label: "搜索",
      mentionLabel: "搜索",
      commandPrefix: "@搜索",
      description: "搜索资料",
      aliases: [],
    };
    const latestCall =
      mockCharacterMention.mock.calls[
        mockCharacterMention.mock.calls.length - 1
      ]?.[0];

    await act(async () => {
      latestCall?.onSelectInputCapability?.({
        kind: "builtin_command",
        command: builtinCommand,
      });
      await Promise.resolve();
    });

    const sendButton = document.querySelector(
      '[data-testid="send-btn"]',
    ) as HTMLButtonElement | null;
    expect(sendButton).toBeTruthy();

    await act(async () => {
      sendButton?.click();
      await Promise.resolve();
    });

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith(
      undefined,
      false,
      false,
      undefined,
      "react",
      undefined,
      {
        capabilityRoute: {
          kind: "builtin_command",
          commandKey: "research",
          commandPrefix: "@搜索",
        },
        displayContent: "整理最近发布计划",
      },
    );
  });

  it("选择运行时场景发送时，应透传 runtime scene route 与原始显示文案", async () => {
    const onSend = vi.fn();
    renderInputbar({
      input: "帮我做一版新品活动启动方案",
      onSend,
      activeTheme: "general",
    });

    await act(async () => {
      await Promise.resolve();
    });

    const runtimeScene: RuntimeSceneSlashCommand = {
      key: "campaign-launch",
      label: "活动启动场景",
      commandPrefix: "/campaign-launch",
      description: "围绕活动目标生成启动方案",
      aliases: [],
    };
    const latestCall =
      mockCharacterMention.mock.calls[
        mockCharacterMention.mock.calls.length - 1
      ]?.[0];

    await act(async () => {
      latestCall?.onSelectInputCapability?.({
        kind: "runtime_scene",
        command: runtimeScene,
      });
      await Promise.resolve();
    });

    expect(
      document.querySelector('[data-testid="runtime-scene-badge"]'),
    ).toBeTruthy();

    const sendButton = document.querySelector(
      '[data-testid="send-btn"]',
    ) as HTMLButtonElement | null;
    expect(sendButton).toBeTruthy();

    await act(async () => {
      sendButton?.click();
      await Promise.resolve();
    });

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith(
      undefined,
      false,
      false,
      undefined,
      "react",
      undefined,
      {
        capabilityRoute: {
          kind: "runtime_scene",
          sceneKey: "campaign-launch",
          commandPrefix: "/campaign-launch",
        },
        displayContent: "帮我做一版新品活动启动方案",
      },
    );
  });

  it("先选内建命令再切到运行时场景时，不应继续残留旧命令 route", async () => {
    const onSend = vi.fn();
    renderInputbar({
      input: "帮我做一版新品活动启动方案",
      onSend,
      activeTheme: "general",
    });

    await act(async () => {
      await Promise.resolve();
    });

    const builtinCommand: BuiltinInputCommand = {
      key: "research",
      label: "搜索",
      mentionLabel: "搜索",
      commandPrefix: "@搜索",
      description: "搜索资料",
      aliases: [],
    };
    const runtimeScene: RuntimeSceneSlashCommand = {
      key: "campaign-launch",
      label: "活动启动场景",
      commandPrefix: "/campaign-launch",
      description: "围绕活动目标生成启动方案",
      aliases: [],
    };
    const firstCall =
      mockCharacterMention.mock.calls[
        mockCharacterMention.mock.calls.length - 1
      ]?.[0];

    await act(async () => {
      firstCall?.onSelectInputCapability?.({
        kind: "builtin_command",
        command: builtinCommand,
      });
      await Promise.resolve();
    });

    const secondCall =
      mockCharacterMention.mock.calls[
        mockCharacterMention.mock.calls.length - 1
      ]?.[0];

    await act(async () => {
      secondCall?.onSelectInputCapability?.({
        kind: "runtime_scene",
        command: runtimeScene,
      });
      await Promise.resolve();
    });

    const sendButton = document.querySelector(
      '[data-testid="send-btn"]',
    ) as HTMLButtonElement | null;
    expect(sendButton).toBeTruthy();

    await act(async () => {
      sendButton?.click();
      await Promise.resolve();
    });

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith(
      undefined,
      false,
      false,
      undefined,
      "react",
      undefined,
      {
        capabilityRoute: {
          kind: "runtime_scene",
          sceneKey: "campaign-launch",
          commandPrefix: "/campaign-launch",
        },
        displayContent: "帮我做一版新品活动启动方案",
      },
    );
  });

  it("先选内建命令再切到服务技能入口时，不应继续残留旧命令前缀", async () => {
    const onSend = vi.fn();
    const onSelectServiceSkill = vi.fn();
    const serviceSkill = {
      id: "daily-trend-briefing",
      title: "每日趋势摘要",
    } as ServiceSkillHomeItem;
    renderInputbar({
      input: "整理最近发布计划",
      onSend,
      onSelectServiceSkill,
      serviceSkills: [serviceSkill],
    });

    await act(async () => {
      await Promise.resolve();
    });

    const builtinCommand: BuiltinInputCommand = {
      key: "research",
      label: "搜索",
      mentionLabel: "搜索",
      commandPrefix: "@搜索",
      description: "搜索资料",
      aliases: [],
    };
    const firstCall =
      mockCharacterMention.mock.calls[
        mockCharacterMention.mock.calls.length - 1
      ]?.[0];

    expect(firstCall?.onSelectInputCapability).toBeTypeOf("function");

    await act(async () => {
      firstCall?.onSelectInputCapability?.({
        kind: "builtin_command",
        command: builtinCommand,
      });
      await Promise.resolve();
    });

    const secondCall =
      mockCharacterMention.mock.calls[
        mockCharacterMention.mock.calls.length - 1
      ]?.[0];

    await act(async () => {
      secondCall?.onSelectInputCapability?.({
        kind: "service_skill",
        skill: serviceSkill,
      });
      await Promise.resolve();
    });

    expect(onSelectServiceSkill).toHaveBeenCalledWith(serviceSkill);

    const sendButton = document.querySelector(
      '[data-testid="send-btn"]',
    ) as HTMLButtonElement | null;
    expect(sendButton).toBeTruthy();

    await act(async () => {
      sendButton?.click();
      await Promise.resolve();
    });

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith(
      undefined,
      false,
      false,
      undefined,
      "react",
      undefined,
      undefined,
    );
  });

  it("应把任务文件与额外浮层控件放进同一条输入栏 overlay row", async () => {
    const { container } = renderInputbar({
      taskFiles: [
        {
          id: "file-1",
          name: "notes.md",
          type: "document",
          version: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      overlayAccessory: (
        <button type="button" data-testid="team-inline-toggle">
          查看任务进展 · 2
        </button>
      ),
    });

    await act(async () => {
      await Promise.resolve();
    });

    const row = container.querySelector<HTMLElement>(
      '[data-testid="inputbar-secondary-controls"]',
    );
    expect(row).toBeTruthy();
    expect(getComputedStyle(row as HTMLElement).position).toBe("absolute");
    expect(getComputedStyle(row as HTMLElement).pointerEvents).toBe("none");
    expect(getComputedStyle(row as HTMLElement).zIndex).toBe("80");
    expect(
      row?.querySelector('[data-testid="task-files-panel-area"]'),
    ).toBeTruthy();
    expect(
      row?.querySelector('[data-testid="team-inline-toggle"]'),
    ).toBeTruthy();

    const fileInput = container.querySelector(
      'input[type="file"][accept="image/*"]',
    ) as HTMLInputElement | null;
    expect(fileInput).toBeTruthy();
    expect(fileInput?.multiple).toBe(true);
  });

  it("没有任务文件和额外控件时不应渲染 overlay row", async () => {
    const { container } = renderInputbar({
      taskFiles: [],
      overlayAccessory: null,
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="inputbar-secondary-controls"]'),
    ).toBeNull();
  });

  it("主线程任务状态不应再在输入区单独渲染 task strip", async () => {
    const { container } = renderInputbar({
      input: "分析 claudecode 项目结构并继续执行",
      activeTheme: "general",
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="agent-task-strip"]'),
    ).toBeNull();
  });

  it("工作区输入区默认隐藏技能入口，展开高级设置后与 @ 面板共用同一技能数据源", async () => {
    const { container } = renderInputbar({
      activeTheme: "general",
      skills: [
        {
          key: "writer",
          name: "写作助手",
          description: "用于写作",
          directory: "writer",
          installed: true,
          sourceKind: "builtin",
        },
      ],
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="skill-selector-trigger"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="inputbar-advanced-toggle"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="character-mention-stub"]'),
    ).toBeTruthy();

    expandAdvancedControls(container);

    expect(
      container.querySelector('[data-testid="skill-selector-trigger"]'),
    ).toBeTruthy();
  });

  it("存在 executionRuntime 时折叠态应保留当前模型提示，展开后再显示模型选择器", async () => {
    const { container } = renderInputbar({
      providerType: "openai",
      setProviderType: vi.fn(),
      model: "gpt-5.4-mini",
      setModel: vi.fn(),
      executionRuntime: {
        session_id: "session-1",
        provider_selector: "openai",
        provider_name: "openai",
        model_name: "gpt-5.4",
        source: "turn_context",
        output_schema_runtime: {
          source: "turn",
          strategy: "native",
          providerName: "openai",
          modelName: "gpt-5.4",
        },
      },
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain("当前模型");
    expect(container.textContent).toContain("gpt-5.4-mini");
    expect(container.textContent).not.toContain("最近执行模型");
    expect(
      container.querySelector('[data-testid="model-selector"]'),
    ).toBeNull();

    expandAdvancedControls(container);

    expect(
      container.querySelector('[data-testid="model-selector"]'),
    ).toBeTruthy();
    expect(container.textContent).not.toContain("结构化输出");
    expect(container.textContent).not.toContain("Native schema");
  });

  it("应在高级设置中渲染 Plan 开关与权限模式，并透传对应回调", async () => {
    const setExecutionStrategy = vi.fn();
    const setAccessMode = vi.fn();
    const { container } = renderInputbar({
      executionStrategy: "react",
      setExecutionStrategy,
      accessMode: "current",
      setAccessMode,
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="inputbar-plan-toggle"]'),
    ).toBeNull();
    expect(container.querySelector('select[aria-label="权限模式"]')).toBeNull();

    expandAdvancedControls(container);

    const planToggle = container.querySelector(
      '[data-testid="inputbar-plan-toggle"]',
    ) as HTMLButtonElement | null;
    const accessSelect = container.querySelector(
      'select[aria-label="权限模式"]',
    ) as HTMLSelectElement | null;

    expect(planToggle).toBeTruthy();
    expect(accessSelect).toBeTruthy();
    expect(container.querySelector('select[aria-label="执行模式"]')).toBeNull();

    act(() => {
      planToggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      accessSelect!.value = "full-access";
      accessSelect?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(setExecutionStrategy).toHaveBeenCalledWith("code_orchestrated");
    expect(setAccessMode).toHaveBeenCalledWith("full-access");
  });

  it("受控模式下点击联网搜索应透传状态变更", async () => {
    const onToolStatesChange = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <Inputbar
          input=""
          setInput={vi.fn()}
          onSend={vi.fn()}
          isLoading={false}
          characters={[]}
          skills={[]}
          toolStates={{ webSearch: false, thinking: false }}
          onToolStatesChange={onToolStatesChange}
        />,
      );
    });

    mountedRoots.push({ root, container });
    await act(async () => {
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="toggle-web-search"]'),
    ).toBeNull();

    expandAdvancedControls(container);

    const toggleButton = container.querySelector(
      '[data-testid="toggle-web-search"]',
    ) as HTMLButtonElement | null;
    expect(toggleButton).toBeTruthy();

    act(() => {
      toggleButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onToolStatesChange).toHaveBeenCalledWith({
      webSearch: true,
      thinking: false,
      subagent: false,
    });
  });

  it("通用聊天态复杂任务应显示任务分工建议并支持开启多代理", async () => {
    const onToolStatesChange = vi.fn();
    const { container } = renderInputbar({
      input:
        "请拆分这个多代理调试任务，分别分析、实现、验证，再由主线程汇总结论。",
      activeTheme: "general",
      toolStates: {
        webSearch: false,
        thinking: false,
        subagent: false,
      },
      onToolStatesChange,
    });

    await act(async () => {
      await Promise.resolve();
    });

    const suggestionBar = container.querySelector(
      '[data-testid="team-suggestion-bar"]',
    );
    expect(suggestionBar).toBeTruthy();
    expect(suggestionBar?.textContent).toContain("分工建议");

    const enableTeamButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("启用任务分工"));

    expect(enableTeamButton).toBeTruthy();

    act(() => {
      enableTeamButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(onToolStatesChange).toHaveBeenCalledWith({
      webSearch: false,
      thinking: false,
      subagent: true,
    });
  });

  it("仅在 Team mode 开启时显示 TeamSelector", async () => {
    const { container } = renderInputbar({
      activeTheme: "general",
      toolStates: {
        webSearch: false,
        thinking: false,
        subagent: false,
      },
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="team-selector-stub"]'),
    ).toBeNull();

    const { container: enabledContainer } = renderInputbar({
      activeTheme: "general",
      toolStates: {
        webSearch: false,
        thinking: false,
        subagent: true,
      },
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(
      enabledContainer.querySelector('[data-testid="team-selector-stub"]'),
    ).toBeNull();

    expandAdvancedControls(enabledContainer);

    expect(
      enabledContainer.querySelector('[data-testid="team-selector-stub"]'),
    ).toBeTruthy();
  });

  it("未开启 Team mode 时默认不暴露多代理开关，展开高级设置后可启用", async () => {
    const onToolStatesChange = vi.fn();
    const { container } = renderInputbar({
      activeTheme: "general",
      toolStates: {
        webSearch: false,
        thinking: false,
        subagent: false,
      },
      onToolStatesChange,
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="team-mode-enable-button"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="toggle-subagent-mode"]'),
    ).toBeNull();

    expandAdvancedControls(container);

    const enableButton = container.querySelector(
      '[data-testid="toggle-subagent-mode"]',
    ) as HTMLButtonElement | null;

    expect(enableButton).toBeTruthy();

    act(() => {
      enableButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onToolStatesChange).toHaveBeenCalledWith({
      webSearch: false,
      thinking: false,
      subagent: true,
    });
  });

  it("点击多代理图标后应自动透传 Team 配置面板打开令牌", async () => {
    const { container } = renderInputbar({
      activeTheme: "general",
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expandAdvancedControls(container);

    const enableButton = container.querySelector(
      '[data-testid="toggle-subagent-mode"]',
    ) as HTMLButtonElement | null;

    expect(enableButton).toBeTruthy();

    act(() => {
      enableButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const teamSelector = container.querySelector(
      '[data-testid="team-selector-stub"]',
    ) as HTMLDivElement | null;

    expect(teamSelector).toBeTruthy();
    expect(teamSelector?.getAttribute("data-auto-open-token")).toBe("1");
  });

  it("复杂任务但未开启 Team 时，保留推荐提示但不再渲染重复入口", async () => {
    const { container } = renderInputbar({
      activeTheme: "general",
      input: "请把这个跨模块问题拆分成分析、实现、验证三个并行子任务再汇总",
      toolStates: {
        webSearch: false,
        thinking: false,
        subagent: false,
      },
    });

    await act(async () => {
      await Promise.resolve();
    });

    const recommendationButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("启用任务分工"));

    expect(
      container.querySelector('[data-testid="team-mode-enable-button"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="toggle-subagent-mode"]'),
    ).toBeNull();
    expect(recommendationButton).toBeTruthy();
    const suggestionBar = container.querySelector(
      '[data-testid="team-suggestion-bar"]',
    );
    expect(suggestionBar).toBeTruthy();
    expect(suggestionBar?.textContent).toContain("分工建议");
  });

  it("内容主题默认发送时不应再注入旧 skill 前缀", async () => {
    const onSend = vi.fn();
    const { container } = renderInputbar({
      activeTheme: "general",
      input: "写一篇春季上新种草文案",
      onSend,
    });

    await act(async () => {
      await Promise.resolve();
    });

    const sendButton = container.querySelector(
      '[data-testid="send-btn"]',
    ) as HTMLButtonElement | null;
    expect(sendButton).toBeTruthy();

    await act(async () => {
      sendButton?.click();
      await Promise.resolve();
    });

    expect(onSend).toHaveBeenCalledWith(
      undefined,
      false,
      false,
      undefined,
      "react",
      undefined,
      undefined,
    );
  });

  it("社媒主题输入 slash 命令时不应重复注入默认 skill", async () => {
    const onSend = vi.fn();
    const { container } = renderInputbar({
      activeTheme: "general",
      input: "/custom_skill 写一篇品牌故事",
      onSend,
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const sendButton = container.querySelector(
      '[data-testid="send-btn"]',
    ) as HTMLButtonElement | null;
    expect(sendButton).toBeTruthy();

    await act(async () => {
      sendButton?.click();
      await Promise.resolve();
    });

    expect(onSend).toHaveBeenCalledWith(
      undefined,
      false,
      false,
      undefined,
      "react",
      undefined,
      undefined,
    );
  });

  it("工作区工作流模式应启用 PRD 浮层输入配置", async () => {
    renderInputbar({
      variant: "workspace",
      providerType: "openai",
      setProviderType: vi.fn(),
      model: "gpt-4.1",
      setModel: vi.fn(),
      executionStrategy: "auto",
      setExecutionStrategy: vi.fn(),
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const latestCall =
      mockInputbarCore.mock.calls[mockInputbarCore.mock.calls.length - 1]?.[0];
    expect(latestCall).toBeTruthy();
    expect(latestCall.toolMode).toBe("attach-only");
    expect(
      Object.prototype.hasOwnProperty.call(latestCall, "showTranslate"),
    ).toBe(false);
    expect(latestCall.placeholder).toContain("试着输入任何指令");
    expect(latestCall.leftExtra).toBeDefined();
  });

  it("已选择 Provider 时不应再将 prompt cache 提示组件常驻挂到输入区顶部", async () => {
    const { container } = renderInputbar({
      providerType: "custom-provider-id",
      setProviderType: vi.fn(),
      model: "glm-5.1",
      setModel: vi.fn(),
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="inputbar-prompt-cache-warning"]'),
    ).toBeNull();
  });

  it("生成工作区应使用继续推进型输入提示", async () => {
    renderInputbar({
      variant: "workspace",
      contextVariant: "task-center",
      providerType: "openai",
      setProviderType: vi.fn(),
      model: "gpt-4.1",
      setModel: vi.fn(),
      executionStrategy: "auto",
      setExecutionStrategy: vi.fn(),
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const latestCall =
      mockInputbarCore.mock.calls[mockInputbarCore.mock.calls.length - 1]?.[0];
    expect(latestCall).toBeTruthy();
    expect(latestCall.placeholder).toContain(
      "继续补充这轮生成，或回到左侧继续旧历史",
    );
  });

  it("工作区工作流在待启动状态下不应显示闸门条", async () => {
    const { container } = renderInputbar({
      variant: "workspace",
      workflowGate: {
        key: "draft_start",
        title: "编排待启动",
        status: "idle",
        description: "输入目标后将自动进入编排执行。",
      },
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("编排待启动");
    expect(container.textContent).not.toContain("待启动");
  });

  it("工作区工作流闸门快捷操作应能快速填充输入", async () => {
    const setInput = vi.fn();
    const { container } = renderInputbar({
      variant: "workspace",
      setInput,
      workflowGate: {
        key: "topic_select",
        title: "选题闸门",
        status: "waiting",
        description: "请选择优先推进的选题方向。",
      },
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("选题闸门");
    expect(container.textContent).not.toContain("当前闸门");
    expect(container.textContent).not.toContain("请选择优先推进的选题方向。");

    const quickActionButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("生成 3 个选题"));
    expect(quickActionButton).toBeTruthy();

    act(() => {
      quickActionButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(setInput).toHaveBeenCalledWith(
      "请给我 3 个可执行选题方向，并说明目标读者与传播价值。",
    );
  });

  it("工作区工作流生成中应展示任务面板并支持停止", async () => {
    const onStop = vi.fn();
    const { container } = renderInputbar({
      variant: "workspace",
      isLoading: true,
      onStop,
      workflowSteps: [
        { id: "research", title: "检索项目资料", status: "active" },
        { id: "write", title: "编写正文草稿", status: "pending" },
      ],
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("当前进展");
    expect(container.textContent).toContain("检索项目资料");
    expect(container.textContent).toContain("任务队列");
    expect(container.querySelector('[data-testid="inputbar-core"]')).toBeNull();

    const stopButton = container.querySelector(
      '[data-testid="workflow-stop"]',
    ) as HTMLButtonElement | null;
    expect(stopButton).toBeTruthy();
    act(() => {
      stopButton?.click();
    });
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("工作区工作流生成中应支持折叠与展开待办列表", async () => {
    const { container } = renderInputbar({
      variant: "workspace",
      isLoading: true,
      workflowSteps: [
        { id: "research", title: "检索项目资料", status: "active" },
        { id: "write", title: "编写正文草稿", status: "pending" },
      ],
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("检索项目资料");

    const collapseButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.getAttribute("aria-label") === "折叠任务队列");
    expect(collapseButton).toBeTruthy();

    act(() => {
      collapseButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(
      container.querySelectorAll('[data-testid="workflow-queue-item"]'),
    ).toHaveLength(0);

    const expandButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.getAttribute("aria-label") === "展开任务队列",
    );
    expect(expandButton).toBeTruthy();

    act(() => {
      expandButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(
      container.querySelectorAll('[data-testid="workflow-queue-item"]'),
    ).toHaveLength(2);
  });

  it("工作区任务队列应展示统一进度计数并按优先级排序", async () => {
    const { container } = renderInputbar({
      variant: "workspace",
      isLoading: true,
      workflowSteps: [
        { id: "done", title: "完成选题", status: "completed" },
        { id: "pending", title: "等待补充案例", status: "pending" },
        { id: "active", title: "撰写主稿", status: "active" },
        { id: "error", title: "封面生成失败", status: "error" },
      ],
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("已完成 1/4");

    const queueItems = Array.from(
      container.querySelectorAll('[data-testid="workflow-queue-item"]'),
    );
    expect(queueItems.map((item) => item.getAttribute("data-status"))).toEqual([
      "active",
      "error",
      "pending",
    ]);
  });

  it("工作区工作流在 auto_running 状态下应展示生成面板（不依赖 isLoading）", async () => {
    const { container } = renderInputbar({
      variant: "workspace",
      isLoading: false,
      workflowRunState: "auto_running",
      workflowSteps: [
        { id: "research", title: "检索项目资料", status: "active" },
        { id: "write", title: "编写正文草稿", status: "pending" },
      ],
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("当前进展");
    expect(container.textContent).toContain("检索项目资料");
    expect(container.querySelector('[data-testid="inputbar-core"]')).toBeNull();
  });

  it("工作区工作流在 await_user_decision 状态下应显示输入框", async () => {
    const { container } = renderInputbar({
      variant: "workspace",
      isLoading: true,
      workflowRunState: "await_user_decision",
      workflowGate: {
        key: "topic_select",
        title: "等待用户确认选题",
        status: "waiting",
        description: "等待你确认后继续推进下一步。",
      },
      workflowSteps: [
        { id: "topic", title: "等待用户确认选题", status: "pending" },
      ],
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="inputbar-core"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("当前进展");
    expect(container.textContent).toContain("等待用户确认选题");
    expect(container.textContent).not.toContain("正在生成中");
  });
});
