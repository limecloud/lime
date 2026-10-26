import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  canonicalSkillFilePath,
  canonicalSkillProjection,
  isExpectedSkillIdentity,
} from "./skill-identity.mjs";
import { ensureUserVisibleCapabilityReportSkill } from "./skills-workspace.mjs";

let root;
let skill;
let alias;
let foreign;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "composer-skill-identity-"));
  skill = ensureUserVisibleCapabilityReportSkill({ env: { HOME: root } });
  const aliasDirectory = path.join(root, "alias");
  fs.symlinkSync(skill.skillDirectory, aliasDirectory, "junction");
  alias = path.join(aliasDirectory, "SKILL.md");
  const foreignDirectory = path.join(root, "other", "capability-report");
  fs.mkdirSync(foreignDirectory, { recursive: true });
  foreign = path.join(foreignDirectory, "SKILL.md");
  fs.copyFileSync(skill.skillFilePath, foreign);
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("current fixture filesystem Skill identity", () => {
  it("separates directory machine name, current scope key and frontmatter display name", () => {
    expect(skill.skillIdentity).toEqual({
      name: "capability-report",
      key: "user:capability-report",
      displayName: "Capability Report",
      path: fs.realpathSync(skill.skillFilePath),
    });
    expect(fs.readFileSync(skill.skillFilePath, "utf8")).toContain(
      "name: Capability Report",
    );
  });

  it("accepts a filesystem alias only after resolving it to the expected file", () => {
    expect(alias).not.toBe(skill.skillIdentity.path);
    expect(canonicalSkillFilePath(alias)).toBe(skill.skillIdentity.path);
    expect(
      isExpectedSkillIdentity(
        { name: skill.skillIdentity.name, path: alias },
        skill.skillIdentity,
      ),
    ).toBe(true);
  });

  it("rejects a different file with the same basename and bytes", () => {
    expect(fs.readFileSync(foreign)).toEqual(
      fs.readFileSync(skill.skillFilePath),
    );
    expect(
      isExpectedSkillIdentity(
        { name: skill.skillIdentity.name, path: foreign },
        skill.skillIdentity,
      ),
    ).toBe(false);
  });

  it.each(["display-name", "missing", "relative", "uri", "directory"])(
    "fails closed for %s identity",
    (mode) => {
      const observed = { ...skill.skillIdentity };
      if (mode === "display-name") observed.name = "Capability Report";
      if (mode === "missing")
        observed.path = path.join(root, "missing", "SKILL.md");
      if (mode === "relative")
        observed.path = ".agents/skills/capability-report/SKILL.md";
      if (mode === "uri")
        observed.path = "skill://fixture/capability-report/SKILL.md";
      if (mode === "directory") {
        observed.path = path.join(root, "directory", "SKILL.md");
        fs.mkdirSync(observed.path, { recursive: true });
      }
      expect(isExpectedSkillIdentity(observed, skill.skillIdentity)).toBe(
        false,
      );
    },
  );

  it("requires the expected path itself to be canonical", () => {
    expect(
      isExpectedSkillIdentity(skill.skillIdentity, {
        ...skill.skillIdentity,
        path: alias,
      }),
    ).toBe(false);
  });

  it("normalizes alias paths while preserving every other projection field", () => {
    const token = {
      type: "skill",
      name: skill.skillIdentity.name,
      path: alias,
      id: skill.skillIdentity.key,
      label: `/${skill.skillIdentity.key}`,
      editable: "false",
    };
    const projection = [{ type: "p", content: [token] }];
    expect(canonicalSkillProjection(projection, skill.skillIdentity)).toEqual([
      { type: "p", content: [{ ...token, path: skill.skillIdentity.path }] },
    ]);
    expect(projection[0].content[0].path).toBe(alias);
    expect(() =>
      canonicalSkillProjection(
        [{ ...token, path: foreign }],
        skill.skillIdentity,
      ),
    ).toThrow("does not match");
  });
});
