import { strict as assert } from "node:assert";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { after, before, test } from "node:test";
import { pathToFileURL } from "node:url";
import {
  assertFirstSendReceipt,
  assertFirstSendResourceReceipt,
  captureFirstSendResources,
} from "./composer-first-send-evidence.mjs";

// Load the current independent fixture/oracle; do not reproduce lowering here.
const fromFormal = (name) =>
  import(
    pathToFileURL(path.join(process.cwd(), "scripts/agent-runtime", name))
  );
const { summarizeRichInputSubmission, richInputImageUrl } = await fromFormal(
  "claw-chat-current-fixture-rich-input-evidence.mjs",
);
const { composerMarksFixture } = await fromFormal(
  "claw-chat-current-fixture-composer-marks.mjs",
);
const { ensureUserVisibleCapabilityReportSkill } = await fromFormal(
  "claw-chat-current-fixture-skills-workspace.mjs",
);
const sha = (value) => createHash("sha256").update(value).digest("hex");
let fixtureRoot;
let skillIdentity;
let skillFileSha256;
before(() => {
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "first-send-resource-"));
  skillIdentity = ensureUserVisibleCapabilityReportSkill({
    env: { HOME: fixtureRoot },
  }).skillIdentity;
  skillFileSha256 = sha(fs.readFileSync(skillIdentity.path));
});
after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

function fixture() {
  const prompt = "首发资源完整保留。";
  const marker = "Home首发甲一号";
  const pasteText = "历史粘贴验证😀\n".repeat(180);
  const imageBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const literal = composerMarksFixture({ prompt, skillIdentity, pasteText });
  const expectedSubmission = {
    ...literal,
    text: literal.text + " " + marker,
    displayText: literal.displayText + " " + marker,
  };
  const expected = {
    prompt,
    marker,
    pasteText,
    imageBase64,
    path: path.join(fixtureRoot, "reference.md"),
    pathName: "reference.md",
    skillIdentity,
    skillFileSha256,
    expectedSubmission,
  };
  const skillToken = {
    type: "skill",
    id: skillIdentity.key,
    name: skillIdentity.name,
    path: skillIdentity.path,
    label: "$" + skillIdentity.name,
    editable: "false",
  };
  const pasteToken = {
    type: "paste",
    id: "paste-1",
    label: literal.textElements[0].placeholder,
    editable: "false",
  };
  const entry = {
    state: "draft",
    draftId: "native-draft-opaque",
    scopeVersion: "native-scope-opaque",
    draft: {
      document: {
        text: expectedSubmission.displayText,
        attachments: [{ mediaType: "image/png", data: imageBase64 }],
        pathReferences: [
          {
            id: "file:" + expected.path,
            path: expected.path,
            name: expected.pathName,
            isDir: false,
          },
        ],
        mentionBindings: [{ ...skillToken, kind: "skill" }],
        pendingPastes: [
          { text: pasteText, placeholder: literal.textElements[0].placeholder },
        ],
      },
    },
  };
  const input = [
    {
      type: "text",
      text: expectedSubmission.text,
      text_elements: structuredClone(expectedSubmission.textElements),
    },
    { type: "skill", name: skillIdentity.name, path: skillIdentity.path },
    { type: "mention", name: expected.pathName, path: expected.path },
    { type: "image", url: "data:image/png;base64," + imageBase64 },
  ];
  const request = {
    jsonrpc: "2.0",
    id: "start-first-send",
    method: "turn/start",
    params: {
      threadId: "thread-first-send",
      clientUserMessageId: "client-first-send",
      input,
    },
  };
  const thread = {
    id: request.params.threadId,
    sessionId: "session-first-send",
    turns: [
      {
        id: "turn-first-send",
        status: "inProgress",
        items: [
          {
            type: "userMessage",
            id: "item-first-send",
            clientId: request.params.clientUserMessageId,
            content: structuredClone(input),
          },
        ],
      },
    ],
  };
  const imageUrl = richInputImageUrl(imageBase64);
  thread.turns[0].items[0].content[3].url = imageUrl;
  const imageBytes = Buffer.from(imageBase64, "base64");
  const mediaRead = {
    ipcObservation: {
      electron: true,
      fallback: false,
      transport: "electron-ipc",
      command: "app_server_handle_json_lines",
      status: "success",
      method: "media/read",
      requestId: "read-first-send",
      responseId: "read-first-send",
      params: { threadId: thread.id, uri: imageUrl },
    },
    result: {
      threadId: thread.id,
      uri: imageUrl,
      mimeType: "image/png",
      offset: 0,
      bytes: imageBytes.length,
      totalBytes: imageBytes.length,
      length: imageBytes.length,
      hasMore: false,
      sha256: "sha256:" + sha(imageBytes),
      contentBase64: imageBase64,
    },
  };
  const source = {
    preexistingThreadIds: [],
    preexistingSessionIds: [],
    resources: captureFirstSendResources(entry, expected),
  };
  const receipt = assertFirstSendReceipt(thread, source, [prompt, marker]);
  return {
    entry,
    expected,
    source,
    receipt,
    request,
    oracle: {
      canonical: { thread },
      threadId: thread.id,
      turnId: thread.turns[0].id,
      prompt,
      editorText: expectedSubmission.displayText,
      expectedSubmission,
      skillIdentity,
      skillToken,
      pasteToken,
      pasteText,
      imageBase64,
      pathReference: { name: expected.pathName, path: expected.path },
      mediaRead,
    },
  };
}

function verify(value) {
  const trace = [
    {
      command: "app_server_handle_json_lines",
      transport: "electron-ipc",
      status: "success",
      args_preview: { request: { lines: [JSON.stringify(value.request)] } },
    },
  ];
  const richInput = summarizeRichInputSubmission({
    ...value.oracle,
    traceRaw: JSON.stringify(trace),
  });
  return assertFirstSendResourceReceipt(value.source, value.receipt, {
    richInput,
    mediaRead: value.oracle.mediaRead,
    expectedSubmission: value.oracle.expectedSubmission,
  });
}

test("binds canonical ordered resources and actual media bytes to the source", () => {
  const value = fixture();
  const result = verify(value);
  assert.equal(result.ok, true);
  assert.equal(result.completeCanonicalInputVerified, true);
  assert.equal(result.imageSha256, value.source.resources.image.sha256);
  const logged = JSON.stringify({ resources: value.source.resources, result });
  assert.equal(logged.includes(value.expected.imageBase64), false);
  assert.equal(logged.includes(value.expected.pasteText), false);
  assert.equal(logged.includes(value.oracle.expectedSubmission.text), false);
});

const sourceMutations = {
  "missing image": (doc) => (doc.attachments = []),
  "foreign source image bytes": (doc) =>
    (doc.attachments[0].data = Buffer.from("foreign").toString("base64")),
  "noncanonical source base64": (doc) => (doc.attachments[0].data += "\n"),
  "wrong image mime": (doc) => (doc.attachments[0].mediaType = "image/jpeg"),
  "missing path": (doc) => (doc.pathReferences = []),
  "foreign path": (doc) => (doc.pathReferences[0].path += ".other"),
  "foreign path name": (doc) => (doc.pathReferences[0].name = "other.md"),
  "directory in place of file": (doc) => (doc.pathReferences[0].isDir = true),
  "missing Skill": (doc) => (doc.mentionBindings = []),
  "foreign Skill": (doc) => (doc.mentionBindings[0].path += ".other"),
  "stale Skill route": (doc) =>
    (doc.inputCapabilityRoute = {
      kind: "installed_skill",
      skillKey: "other-skill",
    }),
  "missing hidden paste": (doc) => (doc.pendingPastes = []),
  "hidden paste drift": (doc) => (doc.pendingPastes[0].text += "drift"),
  "paste placeholder drift": (doc) =>
    (doc.pendingPastes[0].placeholder = "other-placeholder"),
  "native display drift": (doc) => (doc.text += "drift"),
};
for (const [name, mutate] of Object.entries(sourceMutations)) {
  test("rejects captured " + name, () => {
    const value = fixture();
    mutate(value.entry.draft.document);
    assert.throws(() => captureFirstSendResources(value.entry, value.expected));
  });
}

const receiptMutations = {
  "canonical image omission": (value) =>
    value.oracle.canonical.thread.turns[0].items[0].content.pop(),
  "canonical Skill omission": (value) =>
    value.oracle.canonical.thread.turns[0].items[0].content.splice(1, 1),
  "canonical path omission": (value) =>
    value.oracle.canonical.thread.turns[0].items[0].content.splice(2, 1),
  "foreign canonical Skill": (value) =>
    (value.oracle.canonical.thread.turns[0].items[0].content[1].path +=
      ".other"),
  "foreign canonical path": (value) =>
    (value.oracle.canonical.thread.turns[0].items[0].content[2].path +=
      ".other"),
  "foreign canonical Thread": (value) =>
    (value.oracle.canonical.thread.id = "foreign-thread"),
  "foreign canonical User Item": (value) =>
    (value.oracle.canonical.thread.turns[0].items[0].id = "foreign-item"),
  "missing observed media IPC": (value) =>
    delete value.oracle.mediaRead.ipcObservation,
  "foreign media read Thread": (value) =>
    (value.oracle.mediaRead.result.threadId = "foreign-thread"),
  "foreign actual media bytes": (value) =>
    (value.oracle.mediaRead.result.contentBase64 =
      Buffer.from("foreign").toString("base64")),
  "foreign response SHA": (value) =>
    (value.oracle.mediaRead.result.sha256 = "sha256:" + "0".repeat(64)),
  "noncanonical response base64": (value) =>
    (value.oracle.mediaRead.result.contentBase64 += "\n"),
  "partial image read": (value) =>
    (value.oracle.mediaRead.result.hasMore = true),
  "different source text SHA": (value) =>
    (value.source.resources.expandedText.sha256 = "0".repeat(64)),
  "different source text-element SHA": (value) =>
    (value.source.resources.expandedText.textElementsSha256 = "0".repeat(64)),
};
for (const [name, mutate] of Object.entries(receiptMutations)) {
  test("rejects receipt " + name, () => {
    const value = fixture();
    mutate(value);
    assert.throws(() => verify(value));
  });
}

for (const mode of [
  "hidden-paste",
  "code-space",
  "code-lf",
  "link-href",
  "link-title",
]) {
  test("rejects self-consistent wire/canonical " + mode + " drift", () => {
    const value = fixture();
    const text = value.request.params.input[0];
    if (mode === "hidden-paste")
      text.text = text.text.replace(value.expected.pasteText, "short paste");
    if (mode === "code-space")
      text.text = text.text.replace("  const value", "const value");
    if (mode === "code-lf")
      text.text = text.text.replace("````\n\n\n`````", "````\n`````");
    if (mode === "link-href")
      text.text = text.text.replace(
        "https://example.invalid/marks",
        "https://example.invalid/other",
      );
    if (mode === "link-title") text.text = text.text.replace(' "标题"', "");
    assert.notEqual(text.text, value.oracle.expectedSubmission.text);
    value.oracle.canonical.thread.turns[0].items[0].content[0] =
      structuredClone(text);
    assert.throws(() => verify(value));
  });
}
