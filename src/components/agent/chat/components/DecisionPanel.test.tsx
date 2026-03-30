import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DecisionPanel } from "./DecisionPanel";
import type { ActionRequired, ConfirmResponse } from "../types";

interface RenderResult {
  container: HTMLDivElement;
  root: Root;
  onSubmit: ReturnType<
    typeof vi.fn<(response: ConfirmResponse) => void | Promise<void>>
  >;
}

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

function renderDecisionPanel(request: ActionRequired): RenderResult {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onSubmit = vi.fn<(response: ConfirmResponse) => void | Promise<void>>();

  act(() => {
    root.render(<DecisionPanel request={request} onSubmit={onSubmit} />);
  });

  mountedRoots.push({ root, container });
  return { container, root, onSubmit };
}

function findButtonByText(
  container: HTMLElement,
  text: string,
): HTMLButtonElement {
  const target = Array.from(container.querySelectorAll("button")).find((node) =>
    node.textContent?.includes(text),
  );
  if (!target) {
    throw new Error(`未找到按钮: ${text}`);
  }
  return target as HTMLButtonElement;
}

function findInputByPlaceholder(
  container: HTMLElement,
  placeholder: string,
): HTMLInputElement {
  const target = container.querySelector<HTMLInputElement>(
    `input[placeholder="${placeholder}"]`,
  );
  if (!target) {
    throw new Error(`未找到输入框: ${placeholder}`);
  }
  return target;
}

function clickButton(button: HTMLButtonElement) {
  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function createElicitationRequest(requestId: string): ActionRequired {
  return {
    requestId,
    actionType: "elicitation",
    prompt: "请选择部署环境",
    requestedSchema: {
      properties: {
        answer: {
          description: "请选择一个环境",
          enum: ["开发环境", "生产环境"],
        },
      },
    },
  };
}

function createAskUserRequest(requestId: string): ActionRequired {
  return {
    requestId,
    actionType: "ask_user",
    questions: [
      {
        question:
          '请选择执行模式："自动执行（Auto）"、"确认后执行（Ask）"、"只读模式"',
      },
    ],
  };
}

function createAskUserNumberedRequest(requestId: string): ActionRequired {
  return {
    requestId,
    actionType: "ask_user",
    questions: [
      {
        question:
          "请选择宣传画方向：\n1. 产品宣传海报\n2. 活动推广海报\n3. 品牌展示海报",
      },
    ],
  };
}

function createSubmittedAskUserRequest(requestId: string): ActionRequired {
  return {
    requestId,
    actionType: "ask_user",
    status: "submitted",
    prompt: "请选择执行模式",
    questions: [{ question: "你希望如何执行？" }],
    submittedResponse: "自动执行（Auto）",
    submittedUserData: { answer: "自动执行（Auto）" },
  };
}

function createBrowserPreflightRequest(
  requestId: string,
  phase: ActionRequired["browserPrepState"] = "failed",
): ActionRequired {
  return {
    requestId,
    actionType: "ask_user",
    uiKind: "browser_preflight",
    browserRequirement: "required_with_user_step",
    browserPrepState: phase,
    prompt:
      "该任务需要真实浏览器执行，不能仅靠网页检索完成。请先准备右侧浏览器会话。",
    detail: "请在右侧浏览器中完成登录、扫码或验证码，然后继续当前任务。",
  };
}

afterEach(() => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) break;
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  vi.clearAllMocks();
});

describe("DecisionPanel elicitation", () => {
  it("应支持从 enum 选项选择并提交 userData.answer", () => {
    const request = createElicitationRequest("req-elicitation-option");
    const { container, onSubmit } = renderDecisionPanel(request);

    const submitButton = findButtonByText(container, "提交");
    expect(submitButton.disabled).toBe(true);

    clickButton(findButtonByText(container, "生产环境"));
    const answerInput = findInputByPlaceholder(container, "请输入回答...");
    expect(answerInput.value).toBe("生产环境");

    clickButton(findButtonByText(container, "提交"));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      requestId: "req-elicitation-option",
      confirmed: true,
      response: JSON.stringify({ answer: "生产环境" }),
      actionType: "elicitation",
      userData: { answer: "生产环境" },
    });
  });

  it("取消时应返回拒绝响应", () => {
    const request = createElicitationRequest("req-elicitation-cancel");
    const { container, onSubmit } = renderDecisionPanel(request);

    clickButton(findButtonByText(container, "取消"));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.requestId).toBe("req-elicitation-cancel");
    expect(payload.confirmed).toBe(false);
    expect(payload.actionType).toBe("elicitation");
    expect(payload.response).toBe("用户拒绝了请求");
    expect(payload.userData).toBe("");
  });
});

describe("DecisionPanel ask_user", () => {
  it("缺少 options 时应从问题文本提取可点击选项，并在点击提交按钮后发送", () => {
    const request = createAskUserRequest("req-ask-user-fallback");
    const { container, onSubmit } = renderDecisionPanel(request);

    expect(container.textContent).toContain("助手的问题");
    expect(container.textContent).not.toContain("Claude");
    expect(container.textContent).toContain("自动执行（Auto）");
    expect(container.textContent).toContain("确认后执行（Ask）");
    expect(container.textContent).toContain("只读模式");

    clickButton(findButtonByText(container, "自动执行（Auto）"));
    clickButton(findButtonByText(container, "提交答案"));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      requestId: "req-ask-user-fallback",
      confirmed: true,
      response: JSON.stringify({ answer: "自动执行（Auto）" }),
      actionType: "ask_user",
      userData: { answer: "自动执行（Auto）" },
    });
  });

  it("编号列表文本应提取为可点击选项，并显式提交", () => {
    const request = createAskUserNumberedRequest("req-ask-user-numbered");
    const { container, onSubmit } = renderDecisionPanel(request);

    expect(container.textContent).toContain("产品宣传海报");
    expect(container.textContent).toContain("活动推广海报");
    expect(container.textContent).toContain("品牌展示海报");

    clickButton(findButtonByText(container, "活动推广海报"));
    clickButton(findButtonByText(container, "提交答案"));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      requestId: "req-ask-user-numbered",
      confirmed: true,
      response: JSON.stringify({ answer: "活动推广海报" }),
      actionType: "ask_user",
      userData: { answer: "活动推广海报" },
    });
  });

  it("questions.options 为字符串数组时应归一化，并显式提交", () => {
    const request: ActionRequired = {
      requestId: "req-ask-user-string-options",
      actionType: "ask_user",
      questions: [
        {
          question: "请选择执行模式",
          options: ["自动执行（Auto）", "确认后执行（Ask）"] as any,
        },
      ],
    };
    const { container, onSubmit } = renderDecisionPanel(request);

    clickButton(findButtonByText(container, "确认后执行（Ask）"));
    clickButton(findButtonByText(container, "提交答案"));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      requestId: "req-ask-user-string-options",
      confirmed: true,
      response: JSON.stringify({ answer: "确认后执行（Ask）" }),
      actionType: "ask_user",
      userData: { answer: "确认后执行（Ask）" },
    });
  });

  it("fallback ask 在 request_id 未就绪时应允许先记录答案", () => {
    const request: ActionRequired = {
      requestId: "fallback:tool-1",
      actionType: "ask_user",
      isFallback: true,
      questions: [
        {
          question: "请选择执行模式",
          options: [{ label: "自动执行（Auto）" }],
        },
      ],
    };
    const { container, onSubmit } = renderDecisionPanel(request);

    expect(container.textContent).toContain("会先被记录");
    const waitingSubmitButton = findButtonByText(container, "记录答案");
    expect(waitingSubmitButton.disabled).toBe(true);
    const optionButton = findButtonByText(container, "自动执行（Auto）");
    expect(optionButton.disabled).toBe(false);
    clickButton(optionButton);
    expect(waitingSubmitButton.disabled).toBe(false);
    clickButton(waitingSubmitButton);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      requestId: "fallback:tool-1",
      confirmed: true,
      response: JSON.stringify({ answer: "自动执行（Auto）" }),
      actionType: "ask_user",
      userData: { answer: "自动执行（Auto）" },
    });
  });

  it("提交后应显示只读回显，不应再次出现可提交按钮", () => {
    const request = createSubmittedAskUserRequest("req-ask-user-submitted");
    const { container } = renderDecisionPanel(request);

    expect(container.textContent).toContain("已提交你的回答");
    expect(container.textContent).toContain("你的回答");
    expect(container.textContent).toContain("自动执行（Auto）");
    expect(container.textContent).toContain("已提交，等待助手继续执行");
    expect(container.textContent).not.toContain("提交答案");
    expect(container.textContent).not.toContain("取消");
  });

  it("显式提交答案等待回调完成时，应展示提交中并禁用交互", async () => {
    const request = createAskUserRequest("req-ask-user-loading");
    let resolveSubmit: (() => void) | null = null;
    const { container, onSubmit } = renderDecisionPanel(request);
    onSubmit.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSubmit = resolve;
        }),
    );

    const optionButton = findButtonByText(container, "自动执行（Auto）");

    await act(async () => {
      optionButton.click();
      await Promise.resolve();
    });

    const submitButton = findButtonByText(container, "提交答案");

    await act(async () => {
      submitButton.click();
      await Promise.resolve();
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(optionButton.disabled).toBe(true);
    expect(submitButton.disabled).toBe(true);
    expect(container.querySelector("svg.animate-spin")).not.toBeNull();

    await act(async () => {
      resolveSubmit?.();
      await Promise.resolve();
    });
  });
});

describe("DecisionPanel copywriting", () => {
  it("tool_confirmation 文案应为中性助手，不应出现 Claude", () => {
    const request: ActionRequired = {
      requestId: "req-tool-confirm",
      actionType: "tool_confirmation",
      toolName: "exec_command",
      arguments: { cmd: "ls" },
    };
    const { container } = renderDecisionPanel(request);

    expect(container.textContent).toContain("助手想要使用");
    expect(container.textContent).not.toContain("Claude");
  });

  it("tool_confirmation 提交中时，应展示处理中并禁用按钮", async () => {
    const request: ActionRequired = {
      requestId: "req-tool-confirm-loading",
      actionType: "tool_confirmation",
      toolName: "exec_command",
      arguments: { cmd: "ls" },
    };
    let resolveSubmit: (() => void) | null = null;
    const { container, onSubmit } = renderDecisionPanel(request);
    onSubmit.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSubmit = resolve;
        }),
    );

    const allowButton = findButtonByText(container, "允许");
    const denyButton = findButtonByText(container, "拒绝");

    await act(async () => {
      allowButton.click();
      await Promise.resolve();
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(allowButton.textContent).toContain("处理中");
    expect(allowButton.disabled).toBe(true);
    expect(denyButton.disabled).toBe(true);

    await act(async () => {
      resolveSubmit?.();
      await Promise.resolve();
    });
  });
});

describe("DecisionPanel browser preflight", () => {
  it("浏览器未就绪时应支持重试打开浏览器", () => {
    const request = createBrowserPreflightRequest("req-browser-preflight");
    const { container, onSubmit } = renderDecisionPanel(request);

    expect(container.textContent).toContain("浏览器未就绪");
    expect(container.textContent).toContain("必须浏览器执行");

    clickButton(findButtonByText(container, "重试打开浏览器"));

    expect(onSubmit).toHaveBeenCalledWith({
      requestId: "req-browser-preflight",
      confirmed: true,
      response: "重新打开浏览器",
      actionType: "ask_user",
      userData: {
        answer: "重新打开浏览器",
        browserAction: "launch",
      },
    });
  });

  it("等待用户完成登录时不应再提供继续执行确认", () => {
    const request = createBrowserPreflightRequest(
      "req-browser-awaiting",
      "awaiting_user",
    );
    const { container, onSubmit } = renderDecisionPanel(request);

    expect(container.textContent).toContain("请先完成浏览器准备");
    expect(container.textContent).not.toContain("我已完成登录，继续执行");

    clickButton(findButtonByText(container, "重新打开浏览器"));

    expect(onSubmit).toHaveBeenCalledWith({
      requestId: "req-browser-awaiting",
      confirmed: true,
      response: "重新打开浏览器",
      actionType: "ask_user",
      userData: {
        answer: "重新打开浏览器",
        browserAction: "launch",
      },
    });
  });
});
