import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  clickMenuItem,
  findButton,
  findLocalSkillRow,
  openLocalSkillMenu,
  mocks,
  renderPage,
  useSkillsWorkspacePageTestLifecycle,
} from "./SkillsWorkspacePage.testFixtures";

describe("SkillsWorkspacePage local actions", () => {
  useSkillsWorkspacePageTestLifecycle();

  it("用户安装页点击卸载只卸载技能，不跳转会话", async () => {
    let resolveUninstall: (() => void) | undefined;
    mocks.uninstallLocalSkill.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveUninstall = resolve;
      }),
    );
    const { container, onNavigate } = renderPage();

    act(() => {
      findButton(container, "个人")?.click();
    });
    openLocalSkillMenu(container);
    await act(async () => {
      clickMenuItem(container, "卸载");
    });

    expect(findLocalSkillRow(container, "writer")).toBeUndefined();

    await act(async () => {
      resolveUninstall?.();
      await Promise.resolve();
    });

    expect(mocks.uninstallLocalSkill).toHaveBeenCalledWith("writer");
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("用户安装页不展示项目保存技能，用户技能菜单保留卸载", () => {
    mocks.localSkills = [
      ...mocks.localSkills,
      {
        key: "project:article-image-plan",
        name: "article-image-plan",
        description: "项目保存技能",
        directory: "article-image-plan",
        installed: true,
        sourceKind: "other",
        catalogSource: "project",
      },
    ];
    const { container } = renderPage();

    act(() => {
      findButton(container, "个人")?.click();
    });

    expect(
      findLocalSkillRow(container, "article-image-plan"),
    ).toBeUndefined();
    openLocalSkillMenu(container, "writer");
    expect(container.textContent).toContain("卸载");
  });

  it("用户安装页点击导出应打包为 .skills 安装包", async () => {
    mocks.saveDialog.mockResolvedValue("/Users/demo/writer");
    const { container } = renderPage();

    act(() => {
      findButton(container, "个人")?.click();
    });
    openLocalSkillMenu(container);
    await act(async () => {
      clickMenuItem(container, "导出");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.saveDialog).toHaveBeenCalledWith({
      title: "导出 Skill 安装包",
      defaultPath: "writer.skills",
      filters: [
        {
          name: "Skill 安装包",
          extensions: ["skills", "skill"],
        },
      ],
    });
    expect(mocks.exportLocalSkillPackage).toHaveBeenCalledWith(
      "writer",
      "/Users/demo/writer.skills",
      "lime",
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith("已导出「写作助手」安装包");
  });

  it("用户安装页三点菜单应支持重命名、替换和显示文件夹", async () => {
    const promptSpy = vi
      .spyOn(window, "prompt")
      .mockReturnValue("writer-renamed");
    mocks.openDialog.mockResolvedValue("/Users/demo/writer.skills");
    const { container, onNavigate } = renderPage();

    act(() => {
      findButton(container, "个人")?.click();
    });

    openLocalSkillMenu(container);
    await act(async () => {
      clickMenuItem(container, "重命名");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(promptSpy).toHaveBeenCalledWith(
      "输入「写作助手」的新目录名",
      "writer",
    );
    expect(mocks.renameLocalSkill).toHaveBeenCalledWith(
      "writer",
      "writer-renamed",
      "lime",
    );
    expect(mocks.refreshLocalSkills).toHaveBeenCalled();

    openLocalSkillMenu(container);
    await act(async () => {
      clickMenuItem(container, "替换");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.openDialog).toHaveBeenLastCalledWith({
      directory: false,
      multiple: false,
      title: "选择用于替换「写作助手」的 .skill 或 .skills 安装包",
      filters: [
        {
          name: "Skill 安装包",
          extensions: ["skills", "skill"],
        },
      ],
    });
    expect(mocks.replaceLocalSkillPackage).toHaveBeenCalledWith(
      "writer",
      "/Users/demo/writer.skills",
      "lime",
    );

    openLocalSkillMenu(container);
    await act(async () => {
      clickMenuItem(container, "在文件夹中显示");
      await Promise.resolve();
    });

    expect(mocks.revealLocalSkill).toHaveBeenCalledWith("writer", "lime");
    expect(onNavigate).not.toHaveBeenCalled();
    promptSpy.mockRestore();
  });

  it("顶部安装技能应选择 .skill/.skills 安装包并打开预览", async () => {
    mocks.openDialog.mockResolvedValue(
      "/Users/demo/article-typesetting-master.skills",
    );
    const { container } = renderPage();

    await act(async () => {
      findButton(container, "添加")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.openDialog).toHaveBeenCalledWith({
      directory: false,
      multiple: false,
      title: "选择 .skill 或 .skills 安装包",
      filters: [
        {
          name: "Skill 安装包",
          extensions: ["skills", "skill"],
        },
      ],
    });
    expect(mocks.importLocalSkill).not.toHaveBeenCalled();
    expect(mocks.inspectLocalSkillPackage).toHaveBeenCalledWith(
      "/Users/demo/article-typesetting-master.skills",
      "lime",
    );
    expect(container.textContent).toContain(
      "把「article-typesetting-master」添加到你的技能库？",
    );
    expect(container.textContent).toContain("article-typesetting-master.skills");
  });

  it("顶部管理菜单应支持浏览、创建和上传技能", async () => {
    mocks.openDialog.mockResolvedValue(
      "/Users/demo/article-typesetting-master.skill",
    );
    const { container } = renderPage({ initialView: "installed" });

    expect(
      container.querySelector('[data-testid="skills-installed-view"]'),
    ).toBeTruthy();

    act(() => {
      findButton(container, "管理")?.click();
    });
    expect(container.textContent).toContain("浏览技能");
    expect(container.textContent).toContain("创建技能");
    expect(container.textContent).toContain("通过 Lime 创建");
    expect(container.textContent).toContain("编写技能说明");
    expect(container.textContent).toContain("上传技能");

    act(() => {
      clickMenuItem(container, "浏览技能");
    });
    expect(
      container.querySelector('[data-testid="skills-store-view"]'),
    ).toBeTruthy();

    act(() => {
      findButton(container, "管理")?.click();
    });
    await act(async () => {
      clickMenuItem(container, "上传技能");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.openDialog).toHaveBeenCalledWith({
      directory: false,
      multiple: false,
      title: "选择 .skill 或 .skills 安装包",
      filters: [
        {
          name: "Skill 安装包",
          extensions: ["skills", "skill"],
        },
      ],
    });
    expect(mocks.inspectLocalSkillPackage).toHaveBeenCalledWith(
      "/Users/demo/article-typesetting-master.skill",
      "lime",
    );
  });

  it("收到 .skill 安装包页面参数时应打开安装预览并在安装后刷新本地 Skills", async () => {
    const { container } = renderPage({
      initialView: "installed",
      initialSkillPackagePath: "/Users/demo/article-typesetting-master.skill",
      initialSkillPackageName: "article-typesetting-master.skill",
      initialSkillPackageRequestKey: 42,
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.inspectLocalSkillPackage).toHaveBeenCalledWith(
      "/Users/demo/article-typesetting-master.skill",
      "lime",
    );
    expect(container.textContent).toContain(
      "把「article-typesetting-master」添加到你的技能库？",
    );
    expect(container.textContent).toContain("安装包内容");
    expect(container.textContent).toContain("SKILL.md");
    expect(container.textContent).toContain("Article Typesetting");
    expect(
      container.querySelector('[data-testid="skills-markdown-preview"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="skills-installed-view"]'),
    ).toBeTruthy();

    await act(async () => {
      findButton(container, "添加到技能库")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.installLocalSkillPackage).toHaveBeenCalledWith(
      "/Users/demo/article-typesetting-master.skill",
      "lime",
    );
    expect(mocks.refreshLocalSkills).toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "已安装 Skill：article-typesetting-master",
    );
  });
});
