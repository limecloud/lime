import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalSkillRow } from "./SkillsWorkspaceInstalledSkills";
import type { Skill } from "@/lib/api/skills";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const skill = {
  key: "writer",
  name: "writer",
  description: "write",
  directory: "writer",
  localDirectoryPath: "/skills/writer",
  installed: true,
  sourceKind: "local",
} as Skill;

describe("ProtocolSkillEnabledControl", () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
  });

  function renderRow(
    props: Partial<React.ComponentProps<typeof LocalSkillRow>> = {},
  ) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <LocalSkillRow
          installedSkillPresentationCopy={{}}
          onDetailOpen={vi.fn()}
          preferences={{}}
          skill={skill}
          {...props}
        />,
      );
    });
  }

  it("唯一协议路径启用时显示绿色勾选", () => {
    renderRow({
      protocolSkillEnabledStates: [
        {
          name: "writer",
          path: "/skills/writer/SKILL.md",
          enabled: true,
        },
      ],
    });

    const check = container.querySelector(
      '[data-testid="skills-installed-check"]',
    );
    expect(check).not.toBeNull();
    expect(check?.innerHTML).toContain("text-emerald-600");
  });

  it("唯一协议路径停用时勾选置灰", () => {
    renderRow({
      protocolSkillEnabledStates: [
        {
          name: "writer",
          path: "/skills/writer/SKILL.md",
          enabled: false,
        },
      ],
    });

    const check = container.querySelector(
      '[data-testid="skills-installed-check"]',
    );
    expect(check?.innerHTML).toContain("text-slate-300");
  });

  it("没有唯一匹配时保持默认勾选", () => {
    renderRow({
      skill: { ...skill, localDirectoryPath: "/skills" },
      protocolSkillEnabledStates: [
        {
          name: "writer",
          path: "/skills/writer/SKILL.md",
          enabled: true,
        },
        {
          name: "reviewer",
          path: "/skills/reviewer/SKILL.md",
          enabled: false,
        },
      ],
    });

    const check = container.querySelector(
      '[data-testid="skills-installed-check"]',
    );
    expect(check?.innerHTML).toContain("text-emerald-600");
  });
});
