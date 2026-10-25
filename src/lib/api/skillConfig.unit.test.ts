import { describe, expect, it, vi } from "vitest";
import {
  listProtocolSkillEnabledStates,
  matchProtocolSkillEnabledState,
  writeProtocolSkillEnabled,
} from "./skillConfig";

describe("skillConfig", () => {
  it("按绝对路径匹配协议技能，重名时不回退到名称", () => {
    const states = [
      {
        name: "writer",
        path: "/Users/lime/.lime/skills/writer/SKILL.md",
        enabled: true,
      },
      {
        name: "writer",
        path: "/workspace/lime/.agents/skills/writer/SKILL.md",
        enabled: false,
      },
    ];

    expect(
      matchProtocolSkillEnabledState(
        {
          name: "writer",
          localDirectoryPath: "/Users/lime/.lime/skills/writer",
        },
        states,
      )?.path,
    ).toBe("/Users/lime/.lime/skills/writer/SKILL.md");
    expect(
      matchProtocolSkillEnabledState(
        { name: "writer", localDirectoryPath: "/missing" },
        states,
      ),
    ).toBeNull();
    expect(
      matchProtocolSkillEnabledState({ name: "writer" }, states),
    ).toBeNull();
  });

  it("没有目录时只接受唯一名称", () => {
    expect(
      matchProtocolSkillEnabledState({ name: "reviewer" }, [
        {
          name: "reviewer",
          path: "/skills/reviewer/SKILL.md",
          enabled: false,
        },
      ]),
    ).toMatchObject({ enabled: false });
  });

  it("skills/config/write 只提交绝对路径", async () => {
    const client = {
      listSkills: vi.fn().mockResolvedValue({
        result: {
          data: [
            {
              cwd: "/workspace/lime",
              errors: [],
              skills: [
                {
                  name: "writer",
                  path: "relative/SKILL.md",
                  enabled: true,
                  description: "",
                  scope: "user",
                },
                {
                  name: "reviewer",
                  path: "/skills/reviewer/SKILL.md",
                  enabled: false,
                  description: "",
                  scope: "user",
                },
              ],
            },
          ],
        },
      }),
      writeSkillsConfig: vi.fn().mockResolvedValue({
        result: { effectiveEnabled: false },
      }),
    };

    await expect(listProtocolSkillEnabledStates(client)).resolves.toEqual([
      {
        name: "reviewer",
        path: "/skills/reviewer/SKILL.md",
        enabled: false,
      },
    ]);
    await expect(
      writeProtocolSkillEnabled(
        { path: "/skills/reviewer/SKILL.md", enabled: false },
        client,
      ),
    ).resolves.toBe(false);
    expect(client.writeSkillsConfig).toHaveBeenCalledWith({
      path: "/skills/reviewer/SKILL.md",
      enabled: false,
    });
    await expect(
      writeProtocolSkillEnabled({ path: "relative/SKILL.md", enabled: true }, client),
    ).rejects.toThrow("absolute path");
  });
});
