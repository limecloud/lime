import { Buffer } from "node:buffer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureUserVisibleCapabilityReportSkill } from "./skills-workspace.mjs";
import {
  richInputImageUrl,
  summarizeRichInputSubmission,
} from "./rich-input-evidence.mjs";
import { composerMarksFixture } from "./composer-marks.mjs";
let root;
let skillIdentity;
let alias;
let foreign;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "composer-rich-identity-"));
  const skill = ensureUserVisibleCapabilityReportSkill({ env: { HOME: root } });
  skillIdentity = skill.skillIdentity;
  const aliasDirectory = path.join(root, "alias");
  fs.symlinkSync(skill.skillDirectory, aliasDirectory, "junction");
  alias = path.join(aliasDirectory, "SKILL.md");
  const foreignDirectory = path.join(root, "other", "capability-report");
  fs.mkdirSync(foreignDirectory, { recursive: true });
  foreign = path.join(foreignDirectory, "SKILL.md");
  fs.copyFileSync(skillIdentity.path, foreign);
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

function fixture() {
  const prompt = "保留正文和图像。";
  const label = `$${skillIdentity.name}`;
  const prefix = `${prompt} `;
  const wirePrefix = prefix;
  const skillLink = `[${label}](${skillIdentity.path.replaceAll("\\", "\\\\").replaceAll(")", "\\)")})`;
  const imageBase64 = Buffer.from("fixture-image").toString("base64");
  const input = [
    {
      type: "text",
      text: `${wirePrefix}${skillLink}`,
      text_elements: [],
    },
    {
      type: "skill",
      name: skillIdentity.name,
      path: skillIdentity.path,
    },
    { type: "mention", name: "reference.ts", path: "/fixture/reference.ts" },
    { type: "image", url: `data:image/png;base64,${imageBase64}` },
  ];
  const request = {
    jsonrpc: "2.0",
    id: "rich-start",
    method: "turn/start",
    params: {
      threadId: "thread-rich",
      clientUserMessageId: "client-rich",
      input,
    },
  };
  const trace = [
    {
      command: "app_server_handle_json_lines",
      transport: "electron-ipc",
      status: "success",
      args_preview: { request: { lines: [JSON.stringify(request)] } },
    },
  ];
  const canonical = {
    thread: {
      id: "thread-rich",
      turns: [
        {
          id: "turn-rich",
          items: [
            {
              type: "userMessage",
              id: "item-rich",
              clientId: "client-rich",
              content: structuredClone(input),
            },
          ],
        },
      ],
    },
  };
  const imageUrl = richInputImageUrl(imageBase64);
  canonical.thread.turns[0].items[0].content[3].url = imageUrl;
  return {
    request,
    trace,
    evidence: {
      canonical,
      threadId: request.params.threadId,
      turnId: "turn-rich",
      expectedSubmission: {
        text: `${wirePrefix}${skillLink}`,
        displayText: `${prefix}${label}`,
        textElements: [],
      },
      prompt,
      editorText: `${prefix}${label}`,
      skillIdentity: { ...skillIdentity },
      skillToken: {
        id: skillIdentity.key,
        name: input[1].name,
        path: input[1].path,
        label,
        editable: "false",
      },
      imageBase64,
      pathReference: { name: input[2].name, path: input[2].path },
      mediaRead: {
        ipcObservation: {
          electron: true,
          fallback: false,
          transport: "electron-ipc",
          command: "app_server_handle_json_lines",
          status: "success",
          method: "media/read",
          requestId: "rich-image-read",
          responseId: "rich-image-read",
          params: { threadId: request.params.threadId, uri: imageUrl },
        },
        result: {
          threadId: request.params.threadId,
          uri: imageUrl,
          mimeType: "image/png",
          offset: 0,
          bytes: 13,
          totalBytes: 13,
          length: 13,
          hasMore: false,
          contentBase64: imageBase64,
        },
      },
    },
  };
}

function summarize({ request, trace, evidence }) {
  trace[0].args_preview.request.lines = [JSON.stringify(request)];
  return summarizeRichInputSubmission({
    ...evidence,
    traceRaw: JSON.stringify(trace),
  });
}

function marksFixture() {
  const input = fixture();
  const pasteText = "历史粘贴验证😀\n".repeat(180);
  const expected = composerMarksFixture({
    prompt: input.evidence.prompt,
    skillIdentity,
    pasteText,
  });
  input.evidence.expectedSubmission = expected;
  input.evidence.editorText = expected.displayText;
  input.evidence.pasteText = pasteText;
  input.evidence.pasteToken = {
    id: "paste-1",
    label: "[Pasted text 1: 1620 characters]",
    editable: "false",
  };
  input.request.params.input[0] = {
    type: "text",
    text: expected.text,
    text_elements: structuredClone(expected.textElements),
  };
  input.evidence.canonical.thread.turns[0].items[0].content[0] =
    structuredClone(input.request.params.input[0]);
  return input;
}

describe("rich Composer submission evidence", () => {
  it("preserves independent Unicode paste ranges and Skill resource links through canonical readback", () => {
    expect(summarize(marksFixture())).toMatchObject({
      ok: true,
      textElementsPreserved: true,
      pasteRangePreserved: true,
      skillResourceLinkPreserved: true,
      canonicalTurnIdentityPreserved: true,
      singleInputRequest: true,
    });
  });

  it.each(["display", "href", "title", "fence", "code-space", "code-lf"])(
    "rejects self-consistent wire/canonical %s drift from literal Markdown",
    (mode) => {
      const input = marksFixture();
      const part = input.request.params.input[0];
      const before = part.text;
      if (mode === "display")
        part.text = `/capability-report ${input.evidence.editorText}`;
      if (mode === "href")
        part.text = part.text.replace(
          "https://example.invalid/marks",
          "https://example.invalid/wrong",
        );
      if (mode === "title") part.text = part.text.replace(' "标题"', "");
      if (mode === "fence") part.text = part.text.replaceAll("`````", "```");
      if (mode === "code-space")
        part.text = part.text.replace("  const value", "const value");
      if (mode === "code-lf")
        part.text = part.text.replace("````\n\n\n`````", "````\n`````");
      expect(part.text).not.toBe(before);
      input.evidence.canonical.thread.turns[0].items[0].content[0] =
        structuredClone(part);
      expect(summarize(input).ok).toBe(false);
    },
  );

  it.each([
    "paste-missing",
    "paste-start",
    "paste-end",
    "paste-utf16",
    "placeholder",
    "extra",
  ])("rejects mutually consistent wire/canonical %s range drift", (mode) => {
    const input = marksFixture();
    const part = input.request.params.input[0];
    if (mode === "paste-missing") part.text_elements.shift();
    if (mode === "paste-start") part.text_elements[0].byteRange.start += 1;
    if (mode === "paste-end") part.text_elements[0].byteRange.end -= 1;
    if (mode === "paste-utf16")
      part.text_elements[0].byteRange.start = part.text.indexOf(
        input.evidence.pasteText,
      );
    if (mode === "placeholder") part.text_elements[0].placeholder = "wrong";
    if (mode === "extra")
      part.text_elements.push(structuredClone(part.text_elements[0]));
    input.evidence.canonical.thread.turns[0].items[0].content[0] =
      structuredClone(part);
    expect(summarize(input).textElementsPreserved).toBe(false);
    expect(summarize(input).ok).toBe(false);
  });

  it("rejects a foreign canonical turn despite matching item/client/full content", () => {
    const input = marksFixture();
    input.evidence.canonical.thread.turns[0].id = "foreign-turn";
    expect(summarize(input).canonicalTurnIdentityPreserved).toBe(false);
    expect(summarize(input).ok).toBe(false);
  });

  it("rejects jointly reordered wire/canonical input from the fixed current rich contract", () => {
    const input = marksFixture();
    input.request.params.input.reverse();
    input.evidence.canonical.thread.turns[0].items[0].content.reverse();
    expect(summarize(input).inputOrderPreserved).toBe(false);
    expect(summarize(input).ok).toBe(false);
  });

  it.each([
    "turn/start",
    "turn/steer",
    "thread/queue/add",
    "thread/queue/update",
    "thread/queue/start",
  ])("rejects additional %s after the intended marks Send", (method) => {
    const input = marksFixture();
    input.trace.push({
      command: "app_server_handle_json_lines",
      transport: "electron-ipc",
      status: "success",
      args_preview: {
        request: {
          lines: [
            JSON.stringify({
              id: "extra",
              method,
              params: {
                threadId: "thread-rich",
                input: [{ type: "text", text: "extra" }],
              },
            }),
          ],
        },
      },
    });
    expect(summarize(input).singleInputRequest).toBe(false);
  });
  it("requires an independent submission oracle even if DOM/wire/canonical agree", () => {
    const input = fixture();
    delete input.evidence.expectedSubmission;
    expect(summarize(input).ok).toBe(false);
  });

  it("uses independent Markdown rather than link labels and code display text", () => {
    const input = fixture();
    const display = `${input.evidence.prompt}\n中😀\n  中😀\n\`\`\`\`\n\n\n $${skillIdentity.name}`;
    const resource = input.request.params.input[0].text.slice(
      input.evidence.prompt.length + 1,
    );
    const markdown = `${input.evidence.prompt}\n[中😀](https://example.invalid/marks "标题")\n\`\`\`\`\`ts\n  中😀\n\`\`\`\`\n\n\n\`\`\`\`\`\n ${resource}`;
    input.evidence.editorText = display;
    const part = input.request.params.input[0];
    part.text = markdown;
    part.text_elements = [];
    input.evidence.expectedSubmission = {
      text: markdown,
      displayText: display,
      textElements: structuredClone(part.text_elements),
    };
    input.evidence.canonical.thread.turns[0].items[0].content[0] =
      structuredClone(part);
    expect(summarize(input).ok).toBe(true);
  });
  it.each([
    "missing-body",
    "wrong-prefix",
    "double-prefix",
    "suffix",
    "truncated",
  ])(
    "rejects matching wire/canonical %s rather than accepting arbitrary routing",
    (mode) => {
      const input = fixture();
      const body = input.request.params.input[0];
      const expected = body.text;
      body.text = {
        "missing-body": `$${skillIdentity.name}`,
        "wrong-prefix": `/foreign ${input.evidence.editorText}`,
        "double-prefix": `/capability-report ${expected}`,
        suffix: `${expected} extra`,
        truncated: expected.slice(0, -1),
      }[mode];
      input.evidence.canonical.thread.turns[0].items[0].content[0] =
        structuredClone(body);
      expect(summarize(input).textPreserved).toBe(false);
      expect(summarize(input).ok).toBe(false);
    },
  );

  it("requires the real transport, UTF8 atom range and the same canonical User Item", () => {
    expect(summarize(fixture())).toMatchObject({
      ok: true,
      itemId: "item-rich",
      clientUserMessageId: "client-rich",
    });
  });

  it("accepts aliases to the fixture file across DOM, wire and canonical readback", () => {
    const input = fixture();
    input.evidence.skillToken.path = alias;
    input.request.params.input[1].path = alias;
    const body = input.request.params.input[0];
    body.text = body.text.replace(skillIdentity.path, alias);
    input.evidence.expectedSubmission.text = body.text;
    input.evidence.canonical.thread.turns[0].items[0].content[0] =
      structuredClone(body);
    expect(summarize(input).ok).toBe(true);
  });

  it.each(["name", "path", "missing"])(
    "rejects mutually consistent DOM, wire and canonical %s drift from the fixture",
    (mode) => {
      const input = fixture();
      const tokens = [
        input.evidence.skillToken,
        input.request.params.input[1],
        input.evidence.canonical.thread.turns[0].items[0].content[1],
      ];
      for (const token of tokens) {
        if (mode === "name") token.name = "Capability Report";
        else
          token.path =
            mode === "path" ? foreign : path.join(root, "missing", "SKILL.md");
      }
      expect(summarize(input).skillIdentityPreserved).toBe(false);
      expect(summarize(input).ok).toBe(false);
    },
  );

  it.each(["transport", "status", "command"])(
    "does not accept foreign %s evidence",
    (field) => {
      const input = fixture();
      input.trace[0][field] = "foreign";
      expect(summarize(input).ok).toBe(false);
    },
  );

  it.each(["name", "path", "id", "label", "editable"])(
    "rejects an incorrect token %s",
    (field) => {
      const input = fixture();
      input.evidence.skillToken[field] = "foreign";
      expect(summarize(input).ok).toBe(false);
    },
  );

  it.each(["missing", "utf16", "out-of-bounds", "placeholder"])(
    "rejects %s text element evidence",
    (mode) => {
      const input = marksFixture();
      const part = input.request.params.input[0];
      if (mode === "missing") delete part.text_elements;
      if (mode === "utf16")
        part.text_elements[0].byteRange.start =
          input.evidence.prompt.length + 1;
      if (mode === "out-of-bounds") part.text_elements[0].byteRange.end += 1;
      if (mode === "placeholder") part.text_elements[0].placeholder = "wrong";
      expect(summarize(input).ok).toBe(false);
    },
  );

  it.each([
    "client",
    "thread",
    "text",
    "range",
    "skill",
    "duplicate",
    "path",
    "image",
    "missing-image",
    "reorder",
  ])("rejects canonical %s drift", (mode) => {
    const input = fixture();
    const user = input.evidence.canonical.thread.turns[0].items[0];
    if (mode === "client") user.clientId = "different-client";
    if (mode === "thread")
      input.evidence.canonical.thread.id = "different-thread";
    if (mode === "text") user.content[0].text = "lost";
    if (mode === "range") delete user.content[0].text_elements;
    if (mode === "skill") user.content[1].path = "/different/SKILL.md";
    if (mode === "path") user.content[2].path = "/different/reference.ts";
    if (mode === "image") user.content[3].url = "sidecar://media/foreign.png";
    if (mode === "missing-image") user.content.pop();
    if (mode === "reorder") user.content.reverse();
    if (mode === "duplicate")
      input.evidence.canonical.thread.turns[0].items.push(
        structuredClone(user),
      );
    expect(summarize(input).ok).toBe(false);
  });

  it.each([
    "missing",
    "thread",
    "uri",
    "fallback",
    "response",
    "bytes",
    "partial",
    "payload",
  ])("rejects %s image read evidence", (mode) => {
    const input = fixture();
    const read = input.evidence.mediaRead;
    if (mode === "missing") delete input.evidence.mediaRead;
    if (mode === "thread") read.ipcObservation.params.threadId = "foreign";
    if (mode === "uri") read.result.uri = "sidecar://media/foreign.png";
    if (mode === "fallback") read.ipcObservation.fallback = true;
    if (mode === "response") read.ipcObservation.responseId = "foreign";
    if (mode === "bytes") read.result.bytes += 1;
    if (mode === "partial") read.result.hasMore = true;
    if (mode === "payload")
      read.result.contentBase64 = Buffer.from("different").toString("base64");
    expect(summarize(input).ok).toBe(false);
  });

  it.each(["image", "path", "extra"])("rejects %s wire drift", (mode) => {
    const input = fixture();
    if (mode === "image")
      input.request.params.input[3].url = "data:image/png;base64,foreign";
    if (mode === "path") input.request.params.input[2].path = "/foreign";
    if (mode === "extra")
      input.request.params.input.push({
        type: "mention",
        name: "extra",
        path: "/extra",
      });
    expect(summarize(input).ok).toBe(false);
  });

  it.each(["bare-label", "wrong-path", "duplicate-link", "legacy-range"])(
    "rejects %s Skill resource serialization even with matching wire/canonical",
    (mode) => {
      const input = fixture();
      const body = input.request.params.input[0];
      const label = input.evidence.skillToken.label;
      const link = body.text.slice(input.evidence.prompt.length + 1);
      if (mode === "bare-label") body.text = body.text.replace(link, label);
      if (mode === "wrong-path")
        body.text = body.text.replace(skillIdentity.path, foreign);
      if (mode === "duplicate-link") body.text += ` ${link}`;
      if (mode === "legacy-range")
        body.text_elements.push({
          placeholder: label,
          byteRange: {
            start: Buffer.byteLength(input.evidence.prompt + " ["),
            end: Buffer.byteLength(input.evidence.prompt + " [" + label),
          },
        });
      input.evidence.expectedSubmission = {
        ...input.evidence.expectedSubmission,
        text: body.text,
        textElements: structuredClone(body.text_elements),
      };
      input.evidence.canonical.thread.turns[0].items[0].content[0] =
        structuredClone(body);
      expect(summarize(input).skillResourceLinkPreserved).toBe(false);
      expect(summarize(input).ok).toBe(false);
    },
  );

  it.each([
    "duplicate-placeholder",
    "missing-placeholder",
    "missing-id",
    "small-paste",
  ])("rejects %s paste expansion evidence", (mode) => {
    const token = { id: "paste-1", label: "[Pasted text]", editable: "false" };
    let text = `正文 ${token.label} /skill`;
    let paste = "中😀".repeat(400);
    if (mode === "duplicate-placeholder") text += token.label;
    if (mode === "missing-placeholder") text = "正文 /skill";
    if (mode === "missing-id") delete token.id;
    if (mode === "small-paste") paste = "small";
    const input = fixture();
    input.evidence.editorText = text;
    input.evidence.pasteToken = token;
    input.evidence.pasteText = paste;
    expect(summarize(input).ok).toBe(false);
  });
});
