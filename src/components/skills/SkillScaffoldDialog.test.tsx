import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SkillScaffoldDialog } from "./SkillScaffoldDialog";
import { changeLimeLocale } from "@/i18n/createI18n";
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

beforeEach(async () => {
  setupReactActEnvironment();
  await changeLimeLocale("zh-CN");
});

afterEach(async () => {
  cleanupMountedRoots(mountedRoots);
  await changeLimeLocale("zh-CN");
});

describe("SkillScaffoldDialog", () => {
  it("应通过 agent namespace 渲染英文脚手架表单并允许切换创建位置", async () => {
    await changeLimeLocale("en-US");
    renderDialog();

    expect(document.body.textContent).toContain("New Skill");
    expect(document.body.textContent).toContain(
      "current workspace `./.agents/skills` directory",
    );
    expect(document.body.textContent).not.toContain("新建 Skill");

    clickButtonByText(document.body, "User", { exact: true });
    expect(document.body.textContent).toContain("app-level Skills directory");
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

  it("专家注册预填应回填表单，不显示结果续用操作", () => {
    renderDialog({
      initialValues: {
        target: "project",
        directory: "project-report",
        name: "项目报告",
        description: "生成项目报告。",
      },
    });

    expect(
      findInputById(document.body, "skill-scaffold-directory")?.value,
    ).toBe("project-report");
    expect(findInputById(document.body, "skill-scaffold-name")?.value).toBe(
      "项目报告",
    );
    expect(document.body.textContent).not.toContain("来源结果");
    expect(findButtonByText(document.body, "带回创作输入")).toBeUndefined();
  });

  it("带结构化草稿时应保留隐藏骨架字段一并提交", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    renderDialog({
      onCreate,
      initialValues: {
        target: "project",
        directory: "project-report",
        name: "项目报告",
        description: "生成项目报告。",
        whenToUse: ["当你需要继续复用这类结果时使用。"],
        inputs: ["目标与主题：项目报告"],
        outputs: ["交付一份可直接使用的研究结果。"],
        steps: ["先确认目标，再复用结构。"],
        fallbackStrategy: ["信息不足时先补问关键约束。"],
      },
    });

    clickButtonByText(document.body, "创建 Skill", { exact: true });
    await flushEffects();

    expect(onCreate).toHaveBeenCalledWith({
      target: "project",
      directory: "project-report",
      name: "项目报告",
      description: "生成项目报告。",
      whenToUse: ["当你需要继续复用这类结果时使用。"],
      inputs: ["目标与主题：项目报告"],
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
    const errorBanner = Array.from(document.body.querySelectorAll("div")).find(
      (element) =>
        element.textContent?.includes("请输入目录名") &&
        element.className.includes("bg-red-50"),
    );
    expect(errorBanner).toBeTruthy();
    expect(errorBanner?.className).toContain("bg-red-50");
    expect(errorBanner?.className).not.toContain("dark:bg-red-950/30");
  });
});
