// @vitest-environment node
import assert from "node:assert/strict";
import { test as nodeTest } from "node:test";
import { assertQueuedMessageReorderEvidence } from "./queued-message-reorder-gate-b.mjs";

const vitestTest = process.env.VITEST
  ? (await import("vitest")).test
  : undefined;

/** @param {string} name @param {() => void} body */
function test(name, body) {
  if (vitestTest) vitestTest(name, body);
  else nodeTest(name, body);
}

/** @typedef {Parameters<typeof assertQueuedMessageReorderEvidence>[0]} Evidence */

/** @param {{method: string, params: Record<string, any>}[]} calls */
function encodeTrace(calls) {
  return JSON.stringify(
    calls.map((call, index) => ({
      command: "app_server_handle_json_lines",
      transport: "electron-ipc",
      status: "success",
      args_preview: {
        request: {
          lines: [JSON.stringify({ id: index + 1, jsonrpc: "2.0", ...call })],
        },
      },
    })),
  );
}

/** @returns {Evidence} */
function fixture() {
  const threadId = "queue-thread";
  /** @type {Evidence["initialSubmissions"]} */
  const initialSubmissions = [
    {
      id: "marker",
      clientUserMessageId: "client-marker",
      input: [
        {
          type: "text",
          text: "Queue",
          text_elements: [
            { byteRange: { start: 0, end: 5 }, placeholder: "Queue" },
          ],
        },
        { type: "skill", name: "review", path: "/fixture/review/SKILL.md" },
      ],
    },
    {
      id: "rich",
      clientUserMessageId: "client-rich",
      input: [
        { type: "text", text: "A" },
        { type: "image", url: "sidecar://media/fixture.png" },
        { type: "text", text: "B" },
      ],
    },
    {
      id: "sentinel",
      clientUserMessageId: "client-sentinel",
      input: [
        { type: "text", text: "Read" },
        { type: "mention", name: "README", path: "C:\\fixture\\README.md" },
      ],
    },
  ];
  const initialIds = initialSubmissions.map((item) => item.id);
  const dragOrder = ["marker", "sentinel", "rich"];
  /** @param {string[]} ids */
  const read = (ids) => ({
    data: ids.map((id) => {
      const submission = initialSubmissions.find((item) => item.id === id);
      assert.ok(submission);
      return structuredClone(submission);
    }),
    observation: {
      electron: true,
      fallback: false,
      command: "app_server_handle_json_lines",
      transport: "electron-ipc",
      status: "success",
      method: "thread/queue/list",
      params: { threadId },
      requestId: "list-1",
      responseId: "list-1",
    },
  });
  return {
    threadId,
    initialSubmissions,
    initial: read(initialIds),
    drag: read(dragOrder),
    keyboard: read(initialIds),
    traceRaw: encodeTrace([
      {
        method: "thread/queue/reorder",
        params: { threadId, queuedSubmissionIds: dragOrder },
      },
      {
        method: "thread/queue/reorder",
        params: { threadId, queuedSubmissionIds: initialIds },
      },
    ]),
    events: [
      {
        type: "dragstart",
        trusted: true,
        submissionId: "rich",
        action: "reorder",
        key: null,
        order: initialIds,
      },
      {
        type: "drop",
        trusted: true,
        submissionId: "sentinel",
        action: null,
        key: null,
        order: initialIds,
      },
      {
        type: "keydown",
        trusted: true,
        submissionId: "rich",
        action: "reorder",
        key: "ArrowUp",
        order: dragOrder,
      },
    ],
    gui: {
      sameThread: true,
      dragOrder,
      keyboardOrder: initialIds,
      handleFocused: true,
      idle: true,
    },
  };
}

test("native reorder evidence binds trusted drag/keyboard, real lists and full typed inputs", () => {
  const evidence = fixture();
  const before = structuredClone(evidence);
  const result = assertQueuedMessageReorderEvidence(evidence);
  assert.deepEqual(result.dragOrder, ["marker", "sentinel", "rich"]);
  assert.equal(result.mutations.length, 2);
  assert.deepEqual(evidence, before);
});

for (const stage of /** @type {const} */ (["initial", "drag", "keyboard"])) {
  for (const fault of [
    "response-id",
    "fallback",
    "wrong-thread",
    "wrong-method",
  ]) {
    test(`${stage} rejects ${fault} in the actual canonical IPC observation`, () => {
      const evidence = fixture();
      const observation = evidence[stage].observation;
      if (fault === "response-id") observation.responseId = "foreign";
      if (fault === "fallback") observation.fallback = true;
      if (fault === "wrong-thread") observation.params.threadId = "other";
      if (fault === "wrong-method") observation.method = "thread/read";
      assert.throws(
        () => assertQueuedMessageReorderEvidence(evidence),
        /real preload IPC/,
      );
    });
  }
}

for (const stage of /** @type {const} */ (["initial", "drag", "keyboard"])) {
  test(`${stage} rejects a successful ACK without canonical order`, () => {
    const evidence = fixture();
    evidence[stage].data.reverse();
    assert.throws(
      () => assertQueuedMessageReorderEvidence(evidence),
      /canonical ID order/,
    );
  });
}

for (const field of [
  "client",
  "text-elements",
  "image",
  "skill-path",
  "mention-path",
  "extra-text",
]) {
  test(`canonical readback rejects ${field} loss/substitution while IDs still match`, () => {
    const evidence = fixture();
    const records = evidence.drag.data;
    if (field === "client") records[2].clientUserMessageId = "replacement";
    if (field === "text-elements") {
      const text = records[0].input[0];
      assert.equal(text.type, "text");
      delete text.text_elements;
    }
    if (field === "image")
      records[2].input[1] = { type: "image", url: "sidecar://media/other.png" };
    if (field === "skill-path")
      records[0].input[1] = {
        type: "skill",
        name: "review",
        path: "/other/SKILL.md",
      };
    if (field === "mention-path")
      records[1].input[1] = {
        type: "mention",
        name: "README",
        path: "/other/README.md",
      };
    if (field === "extra-text")
      records[2].input.push({ type: "text", text: "duplicate" });
    assert.throws(
      () => assertQueuedMessageReorderEvidence(evidence),
      /typed input\/client identity/,
    );
  });
}

for (const fault of [
  "duplicate",
  "missing",
  "wrong-thread",
  "wrong-order",
  "extra-update",
]) {
  test(`real mutation ledger rejects ${fault}`, () => {
    const evidence = fixture();
    const calls = [
      {
        method: "thread/queue/reorder",
        params: {
          threadId: evidence.threadId,
          queuedSubmissionIds: ["marker", "sentinel", "rich"],
        },
      },
      {
        method: "thread/queue/reorder",
        params: {
          threadId: evidence.threadId,
          queuedSubmissionIds: ["marker", "rich", "sentinel"],
        },
      },
    ];
    if (fault === "duplicate") calls.push(calls[0]);
    if (fault === "missing") calls.pop();
    if (fault === "wrong-thread") calls[0].params.threadId = "other";
    if (fault === "wrong-order") calls[1].params.queuedSubmissionIds.reverse();
    if (fault === "extra-update")
      calls.push({ ...calls[0], method: "thread/queue/update" });
    evidence.traceRaw = encodeTrace(calls);
    assert.throws(
      () => assertQueuedMessageReorderEvidence(evidence),
      /two mutations|identity\/order/,
    );
  });
}

for (const transport of ["renderer-mock", "http-bridge", "stdio"]) {
  test(`native evidence rejects ${transport}`, () => {
    const evidence = fixture();
    assert.ok(evidence.traceRaw);
    const trace = JSON.parse(evidence.traceRaw);
    trace[0].transport = transport;
    evidence.traceRaw = JSON.stringify(trace);
    assert.throws(
      () => assertQueuedMessageReorderEvidence(evidence),
      /electron-ipc/,
    );
  });
}

for (const type of ["dragstart", "drop", "keydown"]) {
  test(`${type} must originate from trusted native input`, () => {
    const evidence = fixture();
    const event = evidence.events.find((event) => event.type === type);
    assert.ok(event);
    event.trusted = false;
    assert.throws(
      () => assertQueuedMessageReorderEvidence(evidence),
      /trusted/,
    );
  });
}

for (const fault of [
  "wrong-source",
  "wrong-target",
  "wrong-key",
  "wrong-handle",
  "optimistic-drop",
  "stale-keyboard",
]) {
  test(`native event identity rejects ${fault}`, () => {
    const evidence = fixture();
    if (fault === "wrong-source") evidence.events[0].submissionId = "sentinel";
    if (fault === "wrong-target") evidence.events[1].submissionId = "rich";
    if (fault === "wrong-key") evidence.events[2].key = "ArrowDown";
    if (fault === "wrong-handle") evidence.events[2].action = "move-up";
    if (fault === "optimistic-drop")
      evidence.events[1].order = ["marker", "sentinel", "rich"];
    if (fault === "stale-keyboard")
      evidence.events[2].order = ["marker", "rich", "sentinel"];
    assert.throws(
      () => assertQueuedMessageReorderEvidence(evidence),
      /trusted|before native drop|keyboard did not start/,
    );
  });
}

for (const field of /** @type {const} */ ([
  "sameThread",
  "handleFocused",
  "idle",
])) {
  test(`native result requires GUI ${field}`, () => {
    const evidence = fixture();
    evidence.gui[field] = false;
    assert.throws(
      () => assertQueuedMessageReorderEvidence(evidence),
      /GUI thread|focus|unexpected Turn/,
    );
  });
}

test("a canonical replacement ID cannot pass even with unchanged count", () => {
  const evidence = fixture();
  evidence.keyboard.data[1].id = "replacement";
  assert.throws(
    () => assertQueuedMessageReorderEvidence(evidence),
    /canonical ID order/,
  );
});

test("a text-only fixture cannot stand in for image/skill/path coverage", () => {
  const evidence = fixture();
  evidence.initialSubmissions.forEach((item) => {
    item.input = [{ type: "text", text: "only text" }];
  });
  assert.throws(
    () => assertQueuedMessageReorderEvidence(evidence),
    /seed is missing image/,
  );
});
