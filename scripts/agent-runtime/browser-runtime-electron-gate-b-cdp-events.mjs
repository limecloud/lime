import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { sendPromptFromGui } from "../lib/chat-fixture/gui-actions.mjs";
import { waitForGuiChatCompleted } from "../lib/chat-fixture/gui-completion-waits.mjs";
import {
  clickApprovalDecision,
  waitForApprovalPrompt,
} from "./browser-runtime-electron-gate-b-approval.mjs";
import { waitForBrowserAnnotationState as waitFor } from "./browser-runtime-electron-gate-b-annotation-diagnostics.mjs";

export function startBrowserCdpEventClient(connection) {
  const program = `
    import {pathToFileURL} from 'node:url';
    let data=''; for await(const chunk of process.stdin) data+=chunk;
    const connection=JSON.parse(data);
    const {connect}=await import(pathToFileURL(connection.clientModulePath).href);
    const send=value=>process.stdout.write(JSON.stringify(value)+'\\n');
    const client=await connect(connection,{
      onCDPEvent:event=>{if(event.method==='Runtime.consoleAPICalled' && event.params?.args?.some(arg=>arg.value==='BROWSER_CDP_PERSISTENT_EVENT')) send({type:'event',method:event.method,source:event.source});if(event.method.startsWith('Network.webSocket'))send({type:'websocket-event',method:event.method,source:event.source,requestId:event.params?.requestId,url:event.params?.url??event.params?.request?.url??event.params?.response?.url??null,payloadData:event.params?.response?.payloadData??null});},
      onCDPDetach:event=>send({type:'detach',tabId:event.tabId})
    });
    send({type:'ready'}); await client.closed; send({type:'closed'});
  `;
  const child = spawn(
    process.execPath,
    ["--input-type=module", "-e", program],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  const messages = [];
  const errors = [];
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
    let index;
    while ((index = output.indexOf("\n")) >= 0) {
      const line = output.slice(0, index);
      output = output.slice(index + 1);
      try {
        messages.push(JSON.parse(line));
      } catch {
        errors.push("invalid child message");
      }
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => errors.push(chunk));
  const exited = new Promise((resolve) =>
    child.once("exit", (code, signal) => resolve({ code, signal })),
  );
  child.stdin.end(JSON.stringify(connection));
  return { child, messages, errors, exited };
}

/** GUI -> real App Server/runtime -> approved Host -> native CDP -> separate Node process. */
export async function runBrowserCdpEventScenario(
  ctx,
  evidence,
  check,
  snapshot,
) {
  const { app, page, options, identity, providerFixture } = ctx;
  const state = providerFixture.scenario.cdp.events;
  const before = await ctx.readBrowserWorkspaceState(page);
  const promptText = "browser-cdp-events";
  const stage = (name) => {
    evidence.eventStage = name;
    console.log(`[browser-cdp-events] stage=${name}`);
  };
  let client;
  try {
    stage("subscription-approval");
    await sendPromptFromGui(page, options, promptText, {
      expectedSessionId: identity.sessionId,
    });
    let prompt = await waitForApprovalPrompt(page, options);
    check(
      "events-subscription-independent-approval",
      /CDP/.test(prompt.summary),
    );
    check("events-no-capability-before-approval", state.connection === null);
    check(
      "events-no-debugger-before-approval",
      !(await ctx.readBrowserDebuggerState(app, before.webContentsId)).attached,
    );
    await snapshot("event-subscription-approval");
    await clickApprovalDecision(page, prompt.interactionId, "allow_once");
    const connection = await waitFor(
      options,
      () => state.connection,
      Boolean,
      "Canonical tool did not return an event capability",
    );
    check(
      "events-same-canonical-native-owner",
      state.claimed.tabId === before.tabId &&
        state.claimed.webContentsId === before.webContentsId &&
        state.claimed.threadId === identity.threadId &&
        connection.source.tabId === before.tabId,
    );
    client = startBrowserCdpEventClient(connection);
    stage("client-authorize");
    const consumer = await waitFor(
      options,
      () => ({
        ready: client.messages.some((entry) => entry.type === "ready"),
        stopped:
          client.child.exitCode !== null || client.child.signalCode !== null,
      }),
      (value) => value.ready || value.stopped,
      "Separate Node client did not authorize",
    );
    check("events-client-authorized", consumer.ready);
    check(
      "events-real-client-process",
      client.child.pid > 0 && client.child.pid !== process.pid,
    );
    state.consumerReady();
    for (const [step, method] of [
      ["enable", "Runtime.enable"],
      ["emit", "Runtime.evaluate"],
    ]) {
      stage(`${step}-approval`);
      const previous = prompt.interactionId;
      prompt = await waitForApprovalPrompt(page, options, previous);
      check(
        `events-${step}-separate-command-approval`,
        prompt.summary.includes(method),
      );
      check(`events-${step}-no-result-before-approval`, !state.results[step]);
      await clickApprovalDecision(page, prompt.interactionId, "allow_once");
      await waitFor(
        options,
        () => state.results[step],
        Boolean,
        `Canonical CDP ${step} result missing`,
      );
      check(`events-${step}-canonical-result`, state.results[step].success);
    }
    stage("native-event");
    const delivery = await waitFor(
      options,
      () => ({
        event: client.messages.find((entry) => entry.type === "event"),
        closed: client.messages.some((entry) => entry.type === "closed"),
      }),
      (value) => Boolean(value.event) || value.closed,
      "Native event did not reach the external consumer",
    );
    check("events-channel-open-until-native-event", Boolean(delivery.event));
    const nativeEvent = delivery.event;
    check(
      "events-original-notification-source",
      nativeEvent.source.tabId === before.tabId &&
        nativeEvent.method === "Runtime.consoleAPICalled",
    );
    state.eventReceived();
    for (const [step, method] of [
      ["enableNetwork", "Network.enable"],
      ["openWebSocket", "Runtime.evaluate"],
    ]) {
      stage(`${step}-approval`);
      const previous = prompt.interactionId;
      prompt = await waitForApprovalPrompt(page, options, previous);
      check(
        `events-${step}-separate-command-approval`,
        prompt.summary.includes(method),
      );
      check(`events-${step}-no-result-before-approval`, !state.results[step]);
      await clickApprovalDecision(page, prompt.interactionId, "allow_once");
      await waitFor(
        options,
        () => state.results[step],
        Boolean,
        `Canonical CDP ${step} result missing`,
      );
      check(`events-${step}-canonical-result`, state.results[step].success);
    }
    stage("native-websocket-events");
    const webSocketDelivery = await waitFor(
      options,
      () => client.messages.filter((entry) => entry.type === "websocket-event"),
      (messages) =>
        messages.some(
          (entry) =>
            entry.method === "Network.webSocketFrameReceived" &&
            entry.payloadData === "BROWSER_CDP_WS_RESPONSE",
        ) &&
        messages.some((entry) => entry.method === "Network.webSocketClosed"),
      "Native WebSocket frame did not reach the external consumer",
    );
    const expectedWebSocketMethods = [
      "Network.webSocketCreated",
      "Network.webSocketWillSendHandshakeRequest",
      "Network.webSocketHandshakeResponseReceived",
      "Network.webSocketFrameSent",
      "Network.webSocketFrameReceived",
      "Network.webSocketClosed",
    ];
    for (const method of expectedWebSocketMethods)
      check(
        `events-${method}-native-delivery`,
        webSocketDelivery.some(
          (entry) =>
            entry.method === method &&
            entry.source.tabId === before.tabId &&
            typeof entry.requestId === "string",
        ),
      );
    check(
      "events-websocket-request-frame",
      webSocketDelivery.some(
        (entry) =>
          entry.method === "Network.webSocketFrameSent" &&
          entry.payloadData === "BROWSER_CDP_WS_REQUEST",
      ),
    );
    check(
      "events-websocket-response-frame",
      webSocketDelivery.some(
        (entry) =>
          entry.method === "Network.webSocketFrameReceived" &&
          entry.payloadData === "BROWSER_CDP_WS_RESPONSE",
      ),
    );
    check(
      "events-websocket-one-native-request-lineage",
      new Set(webSocketDelivery.map((entry) => entry.requestId)).size === 1,
    );
    check(
      "events-websocket-server-received-browser-frame",
      state.webSocketMessages.includes("BROWSER_CDP_WS_REQUEST"),
    );
    state.webSocketEventsReceived();
    stage("canonical-terminal");
    const terminal = await waitFor(
      options,
      () =>
        ctx.waitForTerminalThread(
          page,
          options,
          identity.threadId,
          ctx.requestLog,
        ),
      (value) =>
        value.turn?.id === state.claimed.activeTurnId &&
        value.turn.status === "completed" &&
        JSON.stringify(value.turn).includes("BROWSER_CDP_DONE_events"),
      "CDP event canonical turn did not complete",
    );
    const gui = await waitForGuiChatCompleted(page, options, {
      prompt: promptText,
      doneText: "BROWSER_CDP_DONE_events",
      summaryText: "BROWSER_CDP_DONE_events",
      requiredVisibleTexts: ["BROWSER_CDP_DONE_events"],
      expectedIdentity: {
        sessionId: identity.sessionId,
        turnId: terminal.turn.id,
      },
    });
    await waitFor(
      options,
      () => client.messages,
      (messages) => messages.some((entry) => entry.type === "closed"),
      "Event channel remained open after turn completion",
    );
    const exited = await client.exited;
    check(
      "events-client-clean-exit",
      exited.code === 0 && client.errors.length === 0,
    );
    check(
      "events-terminal-detach-delivered",
      client.messages.filter(
        (entry) => entry.type === "detach" && entry.tabId === before.tabId,
      ).length === 1,
    );
    check(
      "events-debugger-revoked-at-terminal",
      !(await ctx.readBrowserDebuggerState(app, before.webContentsId)).attached,
    );
    const tools = terminal.turn.items.filter(
      (item) => item.type === "dynamicToolCall" && item.namespace === "browser",
    );
    check(
      "events-canonical-subscription-item",
      tools.filter(
        (item) => item.tool === "addCdpEventListener" && item.success === true,
      ).length === 1,
    );
    const { connect } = await import(
      pathToFileURL(connection.clientModulePath).href
    );
    let replayRejected = false;
    try {
      const stale = await connect(connection);
      await stale.dispose();
    } catch {
      replayRejected = true;
    }
    check("events-terminal-capability-not-replayable", replayRejected);
    evidence.events = {
      turnId: terminal.turn.id,
      tabId: before.tabId,
      webContentsId: before.webContentsId,
      clientPid: client.child.pid,
      messages: client.messages,
      clientExit: exited,
      webSocketEvents: webSocketDelivery,
      webSocketServerMessages: state.webSocketMessages,
      canonicalTools: tools.map((item) => ({
        id: item.id,
        tool: item.tool,
        success: item.success,
      })),
      guiTerminal: gui.completionScope,
    };
    await snapshot("event-subscription-completed");
  } finally {
    if (client)
      evidence.eventClient = {
        messages: client.messages,
        stderrCount: client.errors.length,
        exitCode: client.child.exitCode,
        signalCode: client.child.signalCode,
      };
    state.consumerReady();
    state.eventReceived();
    if (
      client &&
      client.child.exitCode === null &&
      client.child.signalCode === null
    ) {
      client.child.kill("SIGTERM");
      await client.exited;
    }
  }
}
