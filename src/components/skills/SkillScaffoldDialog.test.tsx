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
