import test from "node:test";
import assert from "node:assert/strict";
import {
  atomKey,
  assertAppServerRequestMethods,
  assertRestartLifecycle,
  assertConsumedDraft,
  assertRestoredDom,
  assertRestoredDraft,
  assertRichDraft,
  assertWorkspaceIndex,
  savedDraft,
  sha256,
} from "./composer-draft-fixture-evidence.mjs";
import { parseComposerDraftFixtureArgs } from "./composer-draft-fixture-driver.mjs";

const scope = { workspaceId: "workspace-a", kind: "local", id: "session-a" };

const nativeTrace = (lines) => [
  { transport: "electron-ipc", args_preview: { request: { lines } } },
];

test("native method proof accepts current Codex request and notification envelopes", () => {
  assert.deepEqual(
    assertAppServerRequestMethods(
      nativeTrace([
        '{"id":1,"method":"thread/list","params":{"limit":100}}',
        '{"method":"$/cancelRequest","params":{"id":2}}',
      ]),
    ),
    ["thread/list", "$/cancelRequest"],
  );
});

test("native method proof accepts explicit JSON-RPC 2.0 and rejects other versions", () => {
  assert.deepEqual(
    assertAppServerRequestMethods(
      nativeTrace(['{"jsonrpc":"2.0","id":1,"method":"thread/read"}']),
    ),
    ["thread/read"],
  );
  assert.throws(() =>
    assertAppServerRequestMethods(
      nativeTrace(['{"jsonrpc":"1.0","id":1,"method":"thread/read"}']),
    ),
  );
});

test("native method proof rejects missing, empty, malformed, response-only and non-native trace", () => {
  for (const lines of [
    undefined,
    [],
    [""],
    ["null"],
    ["[]"],
    ["{"],
    ['{"id":1,"result":{}}'],
    ['{"method":""}'],
    ['{"id":1,"method":"thread/list"}', "malformed"],
  ])
    assert.throws(() => assertAppServerRequestMethods(nativeTrace(lines)));
  const trace = nativeTrace(['{"id":1,"method":"thread/list"}']);
  trace[0].transport = "http";
  assert.throws(() => assertAppServerRequestMethods(trace));
});
const expected = {
  prompt: "请结合截图",
  marker: "GUI工作区一号",
  pasteText: "独立隐藏源\n".repeat(200),
  imageBase64: "aGVsbG8=",
  path: "/isolated/file.md",
  pathName: "file.md",
  skillIdentity: {
    key: "user:capability-report",
    name: "capability-report",
    path: "/isolated/skills/capability-report/SKILL.md",
  },
};

function fixture() {
  const text = `${expected.prompt} ${expected.marker}`;
  const document = {
    editorDocument: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "中😀",
              marks: [
                {
                  type: "link",
                  attrs: {
                    href: "https://example.invalid/marks",
                    title: "标题",
                  },
                },
              ],
            },
            {
              type: "paste",
              attrs: { id: "paste-1", text: expected.pasteText },
            },
          ],
        },
        {
          type: "code_block",
          attrs: { language: "typescript" },
          content: [
            { type: "text", text: "  const value = '中😀';\n````\n\n" },
          ],
        },
      ],
    },
    text,
    selectionStart: text.length - 3,
    selectionEnd: text.length,
    pendingPastes: [{ placeholder: "paste", text: expected.pasteText }],
    attachments: [{ mediaType: "image/png", data: expected.imageBase64 }],
    pathReferences: [
      { path: expected.path, name: expected.pathName, isDir: false },
    ],
    mentionBindings: [
      {
        id: expected.skillIdentity.key,
        kind: "skill",
        name: expected.skillIdentity.name,
        label: `$${expected.skillIdentity.name}`,
        path: expected.skillIdentity.path,
      },
    ],
  };
  return {
    outcome: "ready",
    key: atomKey,
    storeRevision: 7,
    persistence: { state: "saved", savedRevision: 7 },
    data: {
      queryKind: "scope",
      view: {
        scope,
        entry: {
          state: "draft",
          draftId: "draft-a",
          scopeVersion: "version-a",
          draft: {
            format: "composer-draft",
            version: 1,
            plainTextMode: false,
            document,
          },
        },
      },
    },
  };
}

const dom = {
  electron: true,
  preload: true,
  editorCount: 1,
  sessionId: "session-a",
  disabled: false,
  text: "rendered",
  documentProjection: [{ type: "p" }],
  marks: { links: ["fixture"] },
  tokens: [{ type: "paste", id: "1" }],
  images: [{ src: "data:image/png;base64,aGVsbG8=", decoded: true }],
  paths: [{ path: expected.path }],
};

test("accepts independently literal rich resources and exact native saved identity", () => {
  const result = fixture();
  assert.equal(savedDraft(result, scope).draftId, "draft-a");
  assert.match(
    assertRichDraft(result.data.view.entry, expected).payloadSha256,
    /^[a-f0-9]{64}$/,
  );
  assertRestoredDraft(result, scope, structuredClone(result.data.view.entry));
  assertRestoredDom(dom, structuredClone(dom), "session-a");
});

test("summarizes an exact restored plain draft without an optional capability route", () => {
  const result = fixture();
  delete result.data.view.entry.draft.document.inputCapabilityRoute;
  const original = structuredClone(result.data.view.entry);
  const restored = assertRestoredDraft(result, scope, original);
  assert.equal(restored.capabilitySha256, sha256(null));
  assert.equal(restored.payloadSha256, sha256(original.draft));
  assert.doesNotThrow(() => assertRichDraft(original, expected));
  result.data.view.entry.draft.document.inputCapabilityRoute = {
    kind: "installed_skill",
    skillKey: "other",
    skillName: "Other",
  };
  assert.throws(
    () => assertRestoredDraft(result, scope, original),
    /fixture failed/,
  );
});

test("disk consumption requires the exact accepted identity and no remaining binding", () => {
  const identity = { draftId: "draft-a", scopeVersion: "version-a" };
  const envelope = {
    storeRevision: 8,
    atoms: {
      [atomKey]: {
        bindings: {},
        entries: {
          "draft-a": {
            ...identity,
            state: "consumed",
            consumption: "accepted",
          },
        },
      },
    },
  };
  assert.deepEqual(assertConsumedDraft(envelope, identity), {
    ...identity,
    storeRevision: 8,
    consumption: "accepted",
    noRemainingBinding: true,
  });
  for (const change of [
    (value) => {
      value.atoms[atomKey].entries[identity.draftId].scopeVersion = "other";
    },
    (value) => {
      value.atoms[atomKey].entries[identity.draftId].state = "draft";
    },
    (value) => {
      value.atoms[atomKey].entries[identity.draftId].consumption = "clear";
    },
    (value) => {
      value.atoms[atomKey].bindings.scope = identity.draftId;
    },
  ]) {
    const changed = structuredClone(envelope);
    change(changed);
    assert.throws(
      () => assertConsumedDraft(changed, identity),
      /fixture failed/,
    );
  }
});

for (const [name, change] of [
  [
    "foreign scope",
    (result) => {
      result.data.view.scope = { ...scope, workspaceId: "other" };
    },
  ],
  [
    "applied memory without disk save",
    (result) => {
      result.persistence = { state: "pending", savedRevision: 6 };
    },
  ],
  [
    "stale saved revision",
    (result) => {
      result.persistence.savedRevision = 6;
    },
  ],
  [
    "consumed tombstone",
    (result) => {
      result.data.view.entry.state = "consumed";
    },
  ],
  [
    "foreign native atom",
    (result) => {
      result.key = "other";
    },
  ],
  [
    "numeric version",
    (result) => {
      result.data.view.entry.scopeVersion = 2;
    },
  ],
  [
    "empty opaque version",
    (result) => {
      result.data.view.entry.scopeVersion = "";
    },
  ],
])
  test(`rejects ${name} as GUI saved evidence`, () => {
    const result = fixture();
    change(result);
    assert.throws(() => savedDraft(result, scope), /fixture failed/);
  });

for (const [name, change] of [
  [
    "flattened link",
    (draft) => {
      delete draft.document.editorDocument.content[0].content[0].marks;
    },
  ],
  [
    "lost code language",
    (draft) => {
      draft.document.editorDocument.content[1].attrs.language = null;
    },
  ],
  [
    "lost hidden paste source",
    (draft) => {
      draft.document.pendingPastes[0].text = "placeholder only";
    },
  ],
  [
    "ephemeral blob preview",
    (draft) => {
      draft.document.attachments[0].previewUrl = "blob:dead";
    },
  ],
  [
    "altered durable image",
    (draft) => {
      draft.document.attachments[0].data = "other";
    },
  ],
  [
    "foreign path",
    (draft) => {
      draft.document.pathReferences[0].path = "/other";
    },
  ],
  [
    "stale capability route",
    (draft) => {
      draft.document.inputCapabilityRoute = {
        kind: "installed_skill",
        skillKey: "capability-report",
      };
    },
  ],
  [
    "foreign Skill identity",
    (draft) => {
      draft.document.mentionBindings[0].path = "/other/SKILL.md";
    },
  ],
  [
    "missing mention binding",
    (draft) => {
      draft.document.mentionBindings = [];
    },
  ],
  [
    "collapsed selection",
    (draft) => {
      draft.document.selectionStart = draft.document.selectionEnd;
    },
  ],
])
  test(`rejects ${name} despite identical visible plain text`, () => {
    const result = fixture();
    change(result.data.view.entry.draft);
    assert.throws(
      () => assertRichDraft(result.data.view.entry, expected),
      /fixture failed/,
    );
  });

test("cold restore rejects matching plaintext with changed identity or hidden resource", () => {
  const before = fixture().data.view.entry;
  for (const change of [
    (entry) => {
      entry.draftId = "new";
    },
    (entry) => {
      entry.scopeVersion = "version-b";
    },
    (entry) => {
      entry.draft.document.pendingPastes[0].text = "changed hidden source";
    },
  ]) {
    const after = fixture();
    change(after.data.view.entry);
    assert.throws(
      () => assertRestoredDraft(after, scope, before),
      /fixture failed/,
    );
  }
});

test("DOM gate rejects a hidden or foreign editor and undecoded image", () => {
  for (const change of [
    (snapshot) => {
      snapshot.editorCount = 2;
    },
    (snapshot) => {
      snapshot.sessionId = "other";
    },
    (snapshot) => {
      snapshot.disabled = true;
    },
    (snapshot) => {
      snapshot.electron = false;
    },
    (snapshot) => {
      snapshot.images[0].decoded = false;
    },
    (snapshot) => {
      snapshot.tokens[0].id = "foreign";
    },
  ]) {
    const snapshot = structuredClone(dom);
    change(snapshot);
    assert.throws(
      () => assertRestoredDom(snapshot, dom, "session-a"),
      /fixture failed/,
    );
  }
});

test("workspace index rejects foreign or duplicate scopes", () => {
  const entry = fixture().data.view.entry;
  const index = {
    key: atomKey,
    outcome: "ready",
    data: {
      queryKind: "workspace-index",
      workspaceId: scope.workspaceId,
      items: [
        {
          scope,
          identity: {
            draftId: entry.draftId,
            scopeVersion: entry.scopeVersion,
          },
        },
      ],
    },
  };
  assertWorkspaceIndex(index, scope.workspaceId, scope, entry);
  for (const change of [
    (result) => {
      result.data.items.push(structuredClone(result.data.items[0]));
    },
    (result) => {
      result.data.items[0].scope.workspaceId = "foreign";
    },
    (result) => {
      result.data.items[0].identity.scopeVersion = "version-b";
    },
  ]) {
    const result = structuredClone(index);
    change(result);
    assert.throws(
      () => assertWorkspaceIndex(result, scope.workspaceId, scope, entry),
      /fixture failed/,
    );
  }
});

test("normal restart proof rejects window-only closure, kill, duplicate PID or foreign profile", () => {
  const profile = "/isolated/profile";
  const generations = [1, 2, 3].map((pid) => ({
    pid,
    profile,
    mode: "normal",
    exitCode: 0,
    signal: null,
    exited: true,
  }));
  assertRestartLifecycle(generations, profile);
  for (const change of [
    (records) => {
      records[0].exited = false;
    },
    (records) => {
      records[0].signal = "SIGKILL";
    },
    (records) => {
      records[1].pid = records[0].pid;
    },
    (records) => {
      records[2].profile = "/foreign";
    },
    (records) => {
      records[2].mode = "window-closed";
    },
  ]) {
    const records = structuredClone(generations);
    change(records);
    assert.throws(
      () => assertRestartLifecycle(records, profile),
      /fixture failed/,
    );
  }
});

test("CLI refuses implicit evidence, unsafe run IDs and oversized waits", () => {
  assert.throws(() => parseComposerDraftFixtureArgs([]), /fixture failed/);
  const args = [
    "--evidence-dir",
    "evidence",
    "--verification-packet",
    "packet.json",
    "--run-id",
    "fixture",
  ];
  assert.equal(parseComposerDraftFixtureArgs(args, "/repo").repoRoot, "/repo");
  assert.throws(
    () => parseComposerDraftFixtureArgs([...args, "--run-id", "../reuse"]),
    /fixture failed/,
  );
  assert.throws(
    () => parseComposerDraftFixtureArgs([...args, "--timeout-ms", "60001"]),
    /fixture failed/,
  );
  assert.equal(parseComposerDraftFixtureArgs(["--help"]).help, true);
});
