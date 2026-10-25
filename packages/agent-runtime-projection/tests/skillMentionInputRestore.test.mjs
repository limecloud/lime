import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSkillMentionInputRestoreProjectionEvent,
  extractSkillMentionInputRestoreSnapshot,
} from "../dist/index.js";

const repoSkillPath = "/tmp/repo/figma/SKILL.md";
const userSkillPath = "/tmp/user/figma/SKILL.md";

test("skill mention submission preserves the selected duplicate skill path", () => {
  const event = buildSkillMentionInputRestoreProjectionEvent(
    {
      stage: "submit",
      draft: {
        text: "please use $figma now",
        mentionBindings: [
          {
            sigil: "$",
            mention: "figma",
            path: userSkillPath,
          },
        ],
      },
      availableSkills: [
        {
          name: "figma",
          path: repoSkillPath,
        },
        {
          name: "figma",
          path: userSkillPath,
        },
      ],
      submittedItems: [
        {
          type: "text",
          text: "please use $figma now",
        },
        {
          type: "skill",
          name: "figma",
          path: userSkillPath,
        },
      ],
    },
    {
      sequence: 71,
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
      sourceType: "skill_mention_input_restore_projection",
      sequence: 71,
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
  assert.deepEqual(event.payload.duplicateSkillNames, ["figma"]);
  assert.equal(event.payload.bindingCount, 1);
  assert.equal(event.payload.structuredMentionCount, 1);
  assert.deepEqual(event.payload.validationIssues, []);
});

test("blocked image restore preserves mention bindings, text elements and local images", () => {
  const snapshot = extractSkillMentionInputRestoreSnapshot({
    stage: "blocked_image_restore",
    draft: {
      text: "[Image #1] check $file",
      textElements: [{ token: "[Image #1]" }, { token: "$file" }],
      localImages: [{ path: "/tmp/blocked.png" }],
      mentionBindings: [
        {
          sigil: "$",
          mention: "file",
          path: "/tmp/skills/file/SKILL.md",
        },
      ],
    },
    restoredDraft: {
      text: "[Image #1] check $file",
      textElements: [{ token: "[Image #1]" }, { token: "$file" }],
      localImages: [{ path: "/tmp/blocked.png" }],
      mentionBindings: [
        {
          sigil: "$",
          mention: "file",
          path: "/tmp/skills/file/SKILL.md",
        },
      ],
    },
  });

  assert.equal(snapshot.stage, "blocked_image_restore");
  assert.equal(snapshot.bindingsStable, true);
  assert.equal(snapshot.structuredMentionsStable, true);
  assert.deepEqual(snapshot.draft.localImagePaths, ["/tmp/blocked.png"]);
  assert.deepEqual(
    snapshot.restoredDraft.mentionBindings.map((item) => item.path),
    ["/tmp/skills/file/SKILL.md"],
  );
  assert.deepEqual(snapshot.validationIssues, []);
});

test("plugin mention bindings submit structured Mention items", () => {
  const snapshot = extractSkillMentionInputRestoreSnapshot({
    stage: "submit",
    draft: {
      text: "$sample",
      mentionBindings: [
        {
          sigil: "$",
          mention: "sample",
          path: "plugin://sample@test",
        },
      ],
    },
    pluginMentions: [
      {
        configName: "sample@test",
        displayName: "Sample Plugin",
      },
    ],
    submittedItems: [
      {
        type: "text",
        text: "$sample",
      },
      {
        type: "mention",
        name: "Sample Plugin",
        path: "plugin://sample@test",
      },
    ],
  });

  assert.equal(snapshot.structuredMentionCount, 1);
  assert.deepEqual(
    snapshot.submittedItems.map((item) => [item.type, item.name, item.path]),
    [
      ["text", undefined, undefined],
      ["mention", "Sample Plugin", "plugin://sample@test"],
    ],
  );
  assert.deepEqual(snapshot.validationIssues, []);
});

test("skill mention submission fails closed when binding degrades to plain text", () => {
  const snapshot = extractSkillMentionInputRestoreSnapshot({
    stage: "submit",
    draft: {
      text: "please use $figma now",
      mentionBindings: [
        {
          sigil: "$",
          mention: "figma",
          path: userSkillPath,
        },
      ],
    },
    availableSkills: [
      {
        name: "figma",
        path: repoSkillPath,
      },
      {
        name: "figma",
        path: userSkillPath,
      },
    ],
    submittedItems: [
      {
        type: "text",
        text: "please use $figma now",
      },
    ],
  });

  assert.equal(snapshot.structuredMentionsStable, false);
  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    [
      "duplicate_skill_path_not_preserved",
      "mention_binding_degraded_to_plain_text",
    ],
  );
});

test("blocked image restore fails closed when mention binding path or image is lost", () => {
  const event = buildSkillMentionInputRestoreProjectionEvent({
    stage: "blocked_image_restore",
    draft: {
      text: "[Image #1] check $file",
      textElements: [{ token: "[Image #1]" }, { token: "$file" }],
      localImages: [{ path: "/tmp/blocked.png" }],
      mentionBindings: [
        {
          sigil: "$",
          mention: "file",
          path: "/tmp/skills/file/SKILL.md",
        },
      ],
    },
    restoredDraft: {
      text: "[Image #1] check $file",
      textElements: [{ token: "[Image #1]" }],
      localImages: [],
      mentionBindings: [
        {
          sigil: "$",
          mention: "file",
          path: "/tmp/skills/other/SKILL.md",
        },
      ],
    },
  });

  assert.equal(event.phase, "failed");
  assert.equal(event.runtimeStatus, "failed");
  assert.deepEqual(
    event.payload.validationIssues.map((item) => item.code),
    [
      "restored_binding_path_changed",
      "restored_text_element_missing_binding",
      "restored_local_image_lost",
    ],
  );
});

test("plugin mention binding fails closed without structured Mention item", () => {
  const snapshot = extractSkillMentionInputRestoreSnapshot({
    stage: "submit",
    draft: {
      text: "$sample",
      mentionBindings: [
        {
          sigil: "$",
          mention: "sample",
          path: "plugin://sample@test",
        },
      ],
    },
    submittedItems: [
      {
        type: "text",
        text: "$sample",
      },
    ],
  });

  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    ["plugin_binding_not_structured", "mention_binding_degraded_to_plain_text"],
  );
});
