import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkbenchCreateContentDialog } from "./WorkbenchCreateContentDialog";
import {
  clickButtonByText,
  findButtonByText,
  cleanupMountedRoots,
  findInputById,
  fillTextInput,
  mountHarness,
  setupReactActEnvironment,
  type MountedRoot,
} from "../hooks/testUtils";

const mountedRoots: MountedRoot[] = [];

type ContentDialogProps = ComponentProps<typeof WorkbenchCreateContentDialog>;

function createDialogProps(
  overrides: Partial<ContentDialogProps> = {},
): ContentDialogProps {
  return {
    open: true,
    creatingContent: false,
    step: "mode",
    selectedProjectId: "project-1",
    creationModeOptions: [
      { value: "guided", label: "引导模式", description: "分步骤提问" },
      { value: "fast", label: "快速模式", description: "快速起稿" },
    ],
    selectedCreationMode: "guided",
    onCreationModeChange: () => {},
    currentCreationIntentFields: [
      {
        key: "topic",
        label: "主题方向",
        placeholder: "请输入主题",
      },
    ],
    creationIntentValues: {
      topic: "",
      targetAudience: "",
      goal: "",
      constraints: "",
      contentType: "",
      length: "",
      corePoints: "",
      tone: "",
      outline: "",
      mustInclude: "",
      extraRequirements: "",
    },
    onCreationIntentValueChange: () => {},
    currentIntentLength: 0,
    minCreationIntentLength: 10,
    creationIntentError: "",
    onOpenChange: () => {},
    onBackOrCancel: () => {},
    onGoToIntentStep: () => {},
    onCreateContent: () => {},
    ...overrides,
  };
}

function renderDialog(
  overrides: Partial<ContentDialogProps> = {},
) {
  return mountHarness(
    WorkbenchCreateContentDialog,
    createDialogProps(overrides),
    mountedRoots,
  );
}

beforeEach(() => {
  setupReactActEnvironment();
});

afterEach(() => {
  cleanupMountedRoots(mountedRoots);
});

describe("WorkbenchCreateContentDialog", () => {
  it("模式步骤支持切换创作模式并进入下一步", () => {
    const onCreationModeChange = vi.fn();
    const onGoToIntentStep = vi.fn();
    renderDialog({ onCreationModeChange, onGoToIntentStep });

    expect(document.body.textContent).toContain("步骤 1/2");
    expect(document.body.textContent).toContain("引导模式");

    const fastModeButton = findButtonByText(document.body, "快速模式");
    const nextButton = findButtonByText(document.body, "下一步", { exact: true });
    expect(fastModeButton).toBeDefined();
    expect(nextButton).toBeDefined();

    clickButtonByText(document.body, "快速模式");
    clickButtonByText(document.body, "下一步", { exact: true });

    expect(onCreationModeChange).toHaveBeenCalledWith("fast");
    expect(onGoToIntentStep).toHaveBeenCalledTimes(1);
  });

  it("意图步骤长度不足时禁用创建按钮", () => {
    renderDialog({
      step: "intent",
      currentIntentLength: 6,
      minCreationIntentLength: 10,
      creationIntentError: "创作意图至少需要 10 个字",
    });

    expect(document.body.textContent).toContain("步骤 2/2");
    expect(document.body.textContent).toContain("创作意图字数：6/10");
    expect(document.body.textContent).toContain("创作意图至少需要 10 个字");

    const createButton = findButtonByText(document.body, "创建并进入作业", {
      exact: true,
    });
    expect(createButton).toBeDefined();
    expect(createButton).toHaveProperty("disabled", true);
  });

  it("意图步骤支持编辑输入并触发上一步与创建", () => {
    const onCreationIntentValueChange = vi.fn();
    const onBackOrCancel = vi.fn();
    const onCreateContent = vi.fn();
    renderDialog({
      step: "intent",
      currentIntentLength: 16,
      onCreationIntentValueChange,
      onBackOrCancel,
      onCreateContent,
    });

    const topicInput = findInputById(
      document.body,
      "creation-intent-topic",
    ) as HTMLInputElement | null;
    expect(topicInput).not.toBeNull();
    fillTextInput(topicInput, "新的主题");

    const backButton = findButtonByText(document.body, "上一步", { exact: true });
    const createButton = findButtonByText(document.body, "创建并进入作业", {
      exact: true,
    });
    expect(backButton).toBeDefined();
    expect(createButton).toBeDefined();

    clickButtonByText(document.body, "上一步", { exact: true });
    clickButtonByText(document.body, "创建并进入作业", { exact: true });

    expect(onCreationIntentValueChange).toHaveBeenCalledWith("topic", "新的主题");
    expect(onBackOrCancel).toHaveBeenCalledTimes(1);
    expect(onCreateContent).toHaveBeenCalledTimes(1);
  });

  it("意图字段配置异常时应回退到最小可用输入", () => {
    renderDialog({
      step: "intent",
      currentCreationIntentFields: [] as ContentDialogProps["currentCreationIntentFields"],
    });

    const fallbackTopicInput = findInputById(
      document.body,
      "creation-intent-topic",
    ) as HTMLInputElement | null;
    expect(fallbackTopicInput).not.toBeNull();
  });
});
