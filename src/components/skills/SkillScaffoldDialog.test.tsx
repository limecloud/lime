import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SkillScaffoldDialog } from "./SkillScaffoldDialog";
import {
  cleanupMountedRoots,
  clickButtonByText,
  fillTextInput,
  findButtonByText,
  findInputById,
  flushEffects,
  mountHarness,
  setupReactActEnvironment,
  type MountedRoot,
} from "@/components/workspace/hooks/testUtils";

const mountedRoots: MountedRoot[] = [];

type SkillScaffoldDialogProps = ComponentProps<typeof SkillScaffoldDialog>;

function createDialogProps(
  overrides: Partial<SkillScaffoldDialogProps> = {},
): SkillScaffoldDialogProps {
  return {
    open: true,
    creating: false,
    allowProjectTarget: true,
    onOpenChange: () => {},
    onCreate: async () => {},
    initialValues: null,
    sourceHint: null,
    ...overrides,
  };
}

function renderDialog(overrides: Partial<SkillScaffoldDialogProps> = {}) {
  return mountHarness(
    SkillScaffoldDialog,
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

describe("SkillScaffoldDialog", () => {
  it("展示标准脚手架表单并允许切换创建位置", () => {
    renderDialog();

    expect(document.body.textContent).toContain("新建 Skill");
    expect(document.body.textContent).toContain(
      "当前工作区的 `./.agents/skills`",
    );

    clickButtonByText(document.body, "用户级", { exact: true });
    expect(document.body.textContent).toContain("应用级 Skills 目录");
  });

  it("提交时应回传标准脚手架请求", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    renderDialog({ onCreate, onOpenChange });

    fillTextInput(
      findInputById(document.body, "skill-scaffold-directory"),
      "social-post-outline",
    );
    fillTextInput(
      findInputById(document.body, "skill-scaffold-name"),
      "内容发布提纲",
    );
    fillTextInput(
      findInputById(document.body, "skill-scaffold-description"),
      "帮助用户快速整理发帖思路。",
    );

    clickButtonByText(document.body, "创建 Skill", { exact: true });
    await flushEffects();

    expect(onCreate).toHaveBeenCalledWith({
      target: "project",
      directory: "social-post-outline",
      name: "内容发布提纲",
      description: "帮助用户快速整理发帖思路。",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("带预填草稿时应展示来源说明并回填表单", () => {
    renderDialog({
      initialValues: {
        target: "project",
        directory: "saved-skill-demo",
        name: "研究结果复用",
        description: "沉淀自一次成功结果",
      },
      sourceHint: "研究结果摘要",
    });

    expect(
      findInputById(document.body, "skill-scaffold-directory")?.value,
    ).toBe("saved-skill-demo");
    expect(findInputById(document.body, "skill-scaffold-name")?.value).toBe(
      "研究结果复用",
    );
    expect(document.body.textContent).toContain(
      "已根据刚才的结果预填一版技能草稿，并补好适用场景、输入输出与执行步骤。",
    );
    expect(document.body.textContent).toContain("来源结果：研究结果摘要");
  });

  it("来源草稿应支持带回创作输入", () => {
    const onBringBackToCreation = vi.fn();
    const onOpenChange = vi.fn();
    renderDialog({
      onOpenChange,
      onBringBackToCreation,
      initialValues: {
        target: "project",
        directory: "saved-skill-demo",
        name: "研究结果复用",
        description: "沉淀自一次成功结果",
        whenToUse: ["当你需要继续复用这类结果时使用。"],
        inputs: ["目标与主题：研究结果复用"],
        outputs: ["交付一份可直接使用的研究结果。"],
        steps: ["先确认目标，再复用结构。"],
        fallbackStrategy: ["信息不足时先补问关键约束。"],
        sourceExcerpt: "研究结果摘要",
        sourceMessageId: "msg-1",
      },
      sourceHint: "研究结果摘要",
    });

    fillTextInput(
      findInputById(document.body, "skill-scaffold-name"),
      "研究结果复用升级版",
    );
    clickButtonByText(document.body, "带回创作输入", { exact: true });

    expect(onBringBackToCreation).toHaveBeenCalledWith({
      target: "project",
      directory: "saved-skill-demo",
      name: "研究结果复用升级版",
      description: "沉淀自一次成功结果",
      whenToUse: ["当你需要继续复用这类结果时使用。"],
      inputs: ["目标与主题：研究结果复用"],
      outputs: ["交付一份可直接使用的研究结果。"],
      steps: ["先确认目标，再复用结构。"],
      fallbackStrategy: ["信息不足时先补问关键约束。"],
      sourceExcerpt: "研究结果摘要",
      sourceMessageId: "msg-1",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("带结构化草稿时应保留隐藏骨架字段一并提交", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    renderDialog({
      onCreate,
      initialValues: {
        target: "project",
        directory: "saved-skill-demo",
        name: "研究结果复用",
        description: "沉淀自一次成功结果",
        whenToUse: ["当你需要继续复用这类结果时使用。"],
        inputs: ["目标与主题：研究结果复用"],
        outputs: ["交付一份可直接使用的研究结果。"],
        steps: ["先确认目标，再复用结构。"],
        fallbackStrategy: ["信息不足时先补问关键约束。"],
      },
    });

    clickButtonByText(document.body, "创建 Skill", { exact: true });
    await flushEffects();

    expect(onCreate).toHaveBeenCalledWith({
      target: "project",
      directory: "saved-skill-demo",
      name: "研究结果复用",
      description: "沉淀自一次成功结果",
      whenToUse: ["当你需要继续复用这类结果时使用。"],
      inputs: ["目标与主题：研究结果复用"],
      outputs: ["交付一份可直接使用的研究结果。"],
      steps: ["先确认目标，再复用结构。"],
      fallbackStrategy: ["信息不足时先补问关键约束。"],
    });
  });

  it("缺少必填项时应显示校验错误", async () => {
    const onCreate = vi.fn();
    renderDialog({ onCreate, allowProjectTarget: false });

    const createButton = findButtonByText(document.body, "创建 Skill", {
      exact: true,
    });
    expect(createButton).toBeDefined();

    clickButtonByText(document.body, "创建 Skill", { exact: true });
    await flushEffects();

    expect(onCreate).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("请输入目录名");
  });
});
