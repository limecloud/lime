import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSkillsCatalogScopeProjectionEvent,
  extractSkillsCatalogScopeSnapshot,
} from "../dist/index.js";

const cwd = "/workspaces/current";
const otherCwd = "/workspaces/other";
const homeSkill = {
  name: "home-skill",
  path: "/home/lime/skills/home-skill/SKILL.md",
  scope: "User",
  source: "user",
  root: "/home/lime/skills",
  enabled: true,
};

test("Skills catalog scope skips cwd roots when environment is disabled", () => {
  const snapshot = extractSkillsCatalogScopeSnapshot({
    workspaceId: "workspace-current",
    params: {
      cwds: [cwd],
      forceReload: true,
    },
    environmentEnabled: false,
    cacheGeneration: "home-only:v1",
    effectiveCwdRoots: ["/home/lime/skills"],
    runtimeRequestRoots: ["/home/lime/skills"],
    response: {
      data: [
        {
          cwd,
          skills: [homeSkill],
          errors: [],
        },
      ],
    },
  });

  assert.equal(snapshot.environmentEnabled, false);
  assert.equal(snapshot.forceReload, true);
  assert.deepEqual(snapshot.requestedCwdRoots, [cwd]);
  assert.deepEqual(snapshot.catalogCwdRoots, [cwd]);
  assert.deepEqual(snapshot.effectiveCwdRoots, ["/home/lime/skills"]);
  assert.deepEqual(snapshot.runtimeRequestRoots, ["/home/lime/skills"]);
  assert.deepEqual(
    snapshot.skills.map((skill) => skill.name),
    ["home-skill"],
  );
  assert.deepEqual(snapshot.validationIssues, []);
});

test("Skills catalog scope fails closed if disabled environment still loads cwd skill roots", () => {
  const event = buildSkillsCatalogScopeProjectionEvent({
    workspaceId: "workspace-current",
    params: { cwds: [cwd] },
    environmentEnabled: false,
    cacheGeneration: "leaked:v1",
    effectiveCwdRoots: [`${cwd}/.lime/skills`],
    runtimeRequestRoots: [`${cwd}/.lime/skills`],
    response: {
      data: [
        {
          cwd,
          skills: [
            {
              name: "repo-skill",
              path: `${cwd}/.lime/skills/repo-skill/SKILL.md`,
              scope: "Repo",
              source: "repo",
              root: `${cwd}/.lime/skills`,
              enabled: true,
            },
          ],
          errors: [],
        },
      ],
    },
  });

  assert.equal(event.phase, "failed");
  assert.equal(event.runtimeStatus, "failed");
  assert.deepEqual(
    event.payload.validationIssues.map((item) => item.code),
    [
      "environment_disabled_cwd_root_loaded",
      "environment_disabled_cwd_skill_loaded",
    ],
  );
});

test("Skills catalog scope preserves requested cwd order", () => {
  const event = buildSkillsCatalogScopeProjectionEvent(
    {
      workspaceId: "workspace-current",
      params: {
        cwds: [cwd, otherCwd],
      },
      cacheGeneration: "ordered:v1",
      effectiveCwdRoots: [],
      runtimeRequestRoots: [],
      response: {
        data: [
          { cwd, skills: [], errors: [] },
          { cwd: otherCwd, skills: [], errors: [] },
        ],
      },
    },
    {
      sequence: 61,
      sessionId: "session-skills",
      threadId: "thread-skills",
      timestamp: "2026-07-09T00:00:00.000Z",
    },
  );

  assert.deepEqual(
    {
      type: event.type,
      sourceType: event.sourceType,
      sequence: event.sequence,
      sessionId: event.sessionId,
      threadId: event.threadId,
      owner: event.owner,
      scope: event.scope,
      surface: event.surface,
      persistence: event.persistence,
      control: event.control,
      runtimeStatus: event.runtimeStatus,
    },
    {
      type: "context.changed",
      sourceType: "skills_catalog_scope_projection",
      sequence: 61,
      sessionId: "session-skills",
      threadId: "thread-skills",
      owner: "context",
      scope: "thread",
      surface: "timeline_evidence",
      persistence: "snapshot",
      control: "open_detail",
      runtimeStatus: "completed",
    },
  );
  assert.deepEqual(event.payload.requestedCwdRoots, [cwd, otherCwd]);
  assert.deepEqual(event.payload.catalogCwdRoots, [cwd, otherCwd]);
  assert.deepEqual(event.payload.validationIssues, []);
});

test("Skills catalog scope fails closed when response reorders requested cwds", () => {
  const snapshot = extractSkillsCatalogScopeSnapshot({
    workspaceId: "workspace-current",
    params: {
      cwds: [cwd, otherCwd],
    },
    cacheGeneration: "reordered:v1",
    response: {
      data: [
        { cwd: otherCwd, skills: [], errors: [] },
        { cwd, skills: [], errors: [] },
      ],
    },
  });

  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    ["requested_cwd_order_changed"],
  );
});

test("Skills extra roots update catalog and runtime request roots together", () => {
  const extraRoot = "/tmp/runtime-skill-root/skills";
  const snapshot = extractSkillsCatalogScopeSnapshot({
    workspaceId: "workspace-current",
    params: { cwds: [cwd] },
    extraRoots: [extraRoot],
    cacheGeneration: "extra-root:v2",
    effectiveCwdRoots: [extraRoot],
    runtimeRequestRoots: [extraRoot],
    response: {
      data: [
        {
          cwd,
          skills: [
            {
              name: "runtime-skill",
              path: `${extraRoot}/runtime-skill/SKILL.md`,
              scope: "User",
              source: "runtime_extra_root",
              root: extraRoot,
              enabled: true,
            },
          ],
          errors: [],
        },
      ],
    },
  });

  assert.deepEqual(snapshot.extraRoots, [extraRoot]);
  assert.deepEqual(snapshot.effectiveCwdRoots, [extraRoot]);
  assert.deepEqual(snapshot.runtimeRequestRoots, [extraRoot]);
  assert.deepEqual(
    snapshot.skills.map((skill) => skill.name),
    ["runtime-skill"],
  );
  assert.deepEqual(snapshot.validationIssues, []);
});

test("Skills catalog scope fails closed when runtime request roots drift from catalog roots", () => {
  const extraRoot = "/tmp/runtime-skill-root/skills";
  const snapshot = extractSkillsCatalogScopeSnapshot({
    workspaceId: "workspace-current",
    params: { cwds: [cwd] },
    extraRoots: [extraRoot],
    cacheGeneration: "drift:v1",
    effectiveCwdRoots: [extraRoot],
    runtimeRequestRoots: ["/tmp/old-root/skills"],
    response: {
      data: [
        {
          cwd,
          skills: [
            {
              name: "runtime-skill",
              path: `${extraRoot}/runtime-skill/SKILL.md`,
              scope: "User",
              source: "runtime_extra_root",
              root: extraRoot,
              enabled: true,
            },
          ],
          errors: [],
        },
      ],
    },
  });

  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    ["runtime_roots_mismatch"],
  );
});

test("Skills catalog scope rejects workspace skills from legacy global cache", () => {
  const snapshot = extractSkillsCatalogScopeSnapshot({
    workspaceId: "workspace-current",
    params: { cwds: [cwd] },
    cacheGeneration: "global-cache:v1",
    runtimeRequestRoots: [`${cwd}/.lime/skills`],
    response: {
      data: [
        {
          cwd,
          skills: [
            {
              name: "repo-skill",
              path: `${cwd}/.lime/skills/repo-skill/SKILL.md`,
              scope: "Repo",
              source: "global_cache",
              root: `${cwd}/.lime/skills`,
              cacheScope: "global",
              enabled: true,
            },
          ],
          errors: [],
        },
      ],
    },
  });

  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    ["workspace_skill_uses_global_cache"],
  );
});

test("Skills catalog scope requires skill provenance and cache generation", () => {
  const snapshot = extractSkillsCatalogScopeSnapshot({
    workspaceId: "workspace-current",
    params: { cwds: [cwd] },
    response: {
      data: [
        {
          cwd,
          skills: [
            {
              name: "anonymous-skill",
              enabled: true,
            },
          ],
          errors: [],
        },
      ],
    },
  });

  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    ["missing_cache_generation", "skill_missing_provenance"],
  );
});
