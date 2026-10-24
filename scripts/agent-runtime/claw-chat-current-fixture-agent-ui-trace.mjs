import fs from "node:fs";
import path from "node:path";
import {
  APP_SERVER_METHOD_DIAGNOSTICS_SUPPORT_BUNDLE_EXPORT,
  APP_SERVER_METHOD_DIAGNOSTICS_TRACE_EXPORT,
  APP_SERVER_METHOD_DIAGNOSTICS_TRACE_LIST,
  APP_SERVER_METHOD_DIAGNOSTICS_TRACE_READ,
} from "./claw-chat-current-fixture-constants.mjs";
import {
  invokeAppServerFromPage,
  reloadRendererDocument,
} from "./claw-chat-current-fixture-rpc.mjs";
import {
  sanitizeJson,
  sanitizeText,
} from "./claw-chat-current-fixture-utils.mjs";

const TRACE_SUMMARY_METRIC_KEYS = [
  "providerWaitMs",
  "serverToRendererFirstTextDeltaMs",
  "rendererApplyFirstTextDeltaMs",
  "clientLocalOutputMs",
  "inputbarTriggerToHomeSubmitMs",
  "inputbarTriggerToPendingPreviewCommitMs",
  "inputbarTriggerToPendingPreviewPaintMs",
  "inputbarTriggerToSendDispatchMs",
  "inputbarTriggerToSubmitAcceptedMs",
  "homeInputToPendingPreviewCommitMs",
  "homeInputToPendingPreviewPaintMs",
  "homeInputToSendDispatchMs",
  "homeInputMaterializeDurationMs",
  "homeInputToSubmitAcceptedMs",
  "homeInputToFirstTextDeltaMs",
  "homeInputToFirstTextRenderFlushMs",
  "homeInputToFirstTextPaintMs",
  "sendDispatchToSubmitAcceptedMs",
  "streamSubmitDispatchedToAcceptedMs",
  "streamRequestStartToFirstTextPaintMs",
  "submitAcceptedToFirstTextPaintMs",
  "firstEventToFirstTextPaintMs",
  "firstTextDeltaToFirstTextPaintMs",
];

const FORBIDDEN_TRACE_EVIDENCE_FRAGMENTS = [
  "raw_transport_payload",
  "doc-hidden-envelope",
  "request_metadata",
  "authorization",
  "api_key",
  "sk-",
  "fixture fetched https://example.com/claw-event-read",
];

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value)
    : null;
}

function compactTraceSession(session) {
  const metrics = {};
  for (const key of TRACE_SUMMARY_METRIC_KEYS) {
    const value = finiteNumber(session?.[key]);
    if (value !== null) {
      metrics[key] = value;
    }
  }

  const phases = Array.isArray(session?.phases)
    ? session.phases
        .filter((phase) => typeof phase === "string" && phase.trim())
        .slice(-80)
    : [];

  return {
    sessionId:
      typeof session?.sessionId === "string" ? session.sessionId : null,
    workspaceId:
      typeof session?.workspaceId === "string" ? session.workspaceId : null,
    phaseCount: Array.isArray(session?.phases) ? session.phases.length : 0,
    phases,
    metrics,
  };
}

function hasMetric(sessions, key) {
  return sessions.some(
    (session) =>
      typeof session.metrics?.[key] === "number" &&
      Number.isFinite(session.metrics[key]),
  );
}

export function containsForbiddenTraceEvidenceFragment(value) {
  const text = JSON.stringify(value).toLowerCase();
  return FORBIDDEN_TRACE_EVIDENCE_FRAGMENTS.some((fragment) => {
    if (fragment === "sk-") {
      return /\bsk-[a-z0-9_-]{8,}/iu.test(text);
    }
    return text.includes(fragment.toLowerCase());
  });
}

function stringArray(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string")
    : [];
}

function compactTraceSummary(trace) {
  if (!trace || typeof trace !== "object") {
    return null;
  }
  return {
    sessionId:
      typeof trace.sessionId === "string"
        ? trace.sessionId
        : typeof trace.session_id === "string"
          ? trace.session_id
          : null,
    traceId:
      typeof trace.traceId === "string"
        ? trace.traceId
        : typeof trace.trace_id === "string"
          ? trace.trace_id
          : null,
    path:
      typeof trace.path === "string" && !path.isAbsolute(trace.path)
        ? trace.path
        : null,
    eventCount:
      typeof trace.eventCount === "number"
        ? trace.eventCount
        : typeof trace.event_count === "number"
          ? trace.event_count
          : 0,
  };
}

function compactTraceEvents(events) {
  return Array.isArray(events)
    ? events
        .map((event) => {
          const metrics =
            event?.metrics && typeof event.metrics === "object"
              ? event.metrics
              : {};
          const w3cTraceId =
            typeof metrics.w3c_trace_id === "string"
              ? metrics.w3c_trace_id
              : typeof metrics.w3cTraceId === "string"
                ? metrics.w3cTraceId
                : null;
          const w3cTraceparent =
            typeof metrics.w3c_traceparent === "string"
              ? metrics.w3c_traceparent
              : typeof metrics.w3cTraceparent === "string"
                ? metrics.w3cTraceparent
                : null;
          const elapsedMs = finiteNumber(
            metrics.elapsed_ms ?? metrics.elapsedMs,
          );
          const serverEventEmittedAt = finiteNumber(
            metrics.server_event_emitted_at ?? metrics.serverEventEmittedAt,
          );
          return {
            seq: typeof event?.seq === "number" ? event.seq : null,
            checkpoint:
              typeof event?.checkpoint === "string" ? event.checkpoint : null,
            eventType:
              typeof event?.eventType === "string"
                ? event.eventType
                : typeof event?.event_type === "string"
                  ? event.event_type
                  : null,
            redactionMode:
              typeof event?.redaction?.mode === "string"
                ? event.redaction.mode
                : null,
            elapsedMs,
            serverEventEmittedAt,
            w3cTraceId,
            hasW3cTraceparent:
              typeof w3cTraceparent === "string" &&
              /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/.test(w3cTraceparent),
          };
        })
        .filter((event) => event.checkpoint)
        .slice(0, 80)
    : [];
}

function compactTraceExport(result) {
  const bundlePath =
    typeof result?.bundlePath === "string"
      ? result.bundlePath
      : typeof result?.bundle_path === "string"
        ? result.bundle_path
        : "";
  return {
    available: result?.available === true,
    exported: result?.exported === true,
    bundleFileName: bundlePath ? path.basename(bundlePath) : null,
    includedSections: stringArray(
      result?.includedSections ?? result?.included_sections,
    ),
    omittedSections: stringArray(
      result?.omittedSections ?? result?.omitted_sections,
    ),
    redactionMode:
      typeof result?.redaction?.mode === "string"
        ? result.redaction.mode
        : null,
  };
}

function compactSupportBundleWithTrace(result) {
  const bundlePath =
    typeof result?.bundlePath === "string"
      ? result.bundlePath
      : typeof result?.bundle_path === "string"
        ? result.bundle_path
        : "";
  const includedSections = stringArray(
    result?.includedSections ?? result?.included_sections,
  );
  const omittedSections = stringArray(
    result?.omittedSections ?? result?.omitted_sections,
  );
  return {
    bundleFileName: bundlePath ? path.basename(bundlePath) : null,
    bundlePathExists: bundlePath ? fs.existsSync(bundlePath) : false,
    includedSections,
    omittedSections,
    traceExportIncluded: includedSections.some(
      (section) =>
        section.startsWith("trace-export/") && section.endsWith(".zip"),
    ),
    rawTraceJsonlOmitted: omittedSections.some((section) =>
      section.includes("raw trace event JSONL"),
    ),
  };
}

export function summarizeTraceEvidence({
  listResult,
  readResult,
  exportResult,
  supportBundleResult,
}) {
  const traces = Array.isArray(listResult?.traces)
    ? listResult.traces.map(compactTraceSummary).filter(Boolean)
    : [];
  const latestTrace =
    compactTraceSummary(readResult?.trace) ?? traces[0] ?? null;
  const events = compactTraceEvents(readResult?.events);
  const checkpoints = events.map((event) => event.checkpoint).filter(Boolean);
  const providerFirstTextDelta = events.find(
    (event) => event.checkpoint === "provider.first_text_delta.received",
  );
  const appServerMessageDelta = events.find(
    (event) => event.checkpoint === "app_server.message_delta.emitted",
  );
  const providerWaitMs = finiteNumber(providerFirstTextDelta?.elapsedMs);
  const serverEventEmittedAt = finiteNumber(
    appServerMessageDelta?.serverEventEmittedAt,
  );
  const evidence = {
    available: listResult?.available === true,
    traceCount: traces.length,
    trace: latestTrace,
    events,
    checkpoints,
    redactionMode:
      typeof readResult?.redaction?.mode === "string"
        ? readResult.redaction.mode
        : typeof listResult?.redaction?.mode === "string"
          ? listResult.redaction.mode
          : null,
    hasProviderFirstTextDelta: checkpoints.includes(
      "provider.first_text_delta.received",
    ),
    hasAppServerMessageDelta: checkpoints.includes(
      "app_server.message_delta.emitted",
    ),
    providerWaitMs,
    hasProviderWaitMs: providerWaitMs !== null,
    serverEventEmittedAt,
    hasServerEventEmittedAt: serverEventEmittedAt !== null,
    hasW3cTraceContext: events.some(
      (event) =>
        typeof event.w3cTraceId === "string" &&
        /^[0-9a-f]{32}$/.test(event.w3cTraceId) &&
        event.hasW3cTraceparent === true,
    ),
    export: compactTraceExport(exportResult),
    supportBundleWithTrace: compactSupportBundleWithTrace(supportBundleResult),
  };
  return {
    ...evidence,
    forbiddenFragmentPresent: containsForbiddenTraceEvidenceFragment(evidence),
  };
}

export async function enableRuntimeDiagnostics(page, options) {
  const installOverride = () => {
    try {
      window.localStorage.setItem("lime:agent-debug", "1");
      return true;
    } catch {
      return false;
    }
  };

  await page.addInitScript(installOverride);
  const applied = await page.evaluate(installOverride).catch(() => false);
  const reload = shouldSkipTraceDebugOverrideReload(page.url())
    ? {
        reloaded: false,
        reloadRecovered: false,
        reloadSkipped: "startup-placeholder",
      }
    : await reloadAfterTraceDebugOverride(page, options);

  return {
    applied: Boolean(applied),
    ...reload,
    source: "localStorage-debug-override",
  };
}

async function reloadAfterTraceDebugOverride(page, options) {
  try {
    const reload = await reloadRendererDocument(page, options);
    return {
      reloaded: true,
      reloadRecovered: reload.recovered,
      reloadRecovery: reload.recovery ?? null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!isRecoverableElectronReloadRace(message)) {
      throw error;
    }
    await page
      .waitForLoadState("domcontentloaded", {
        timeout: Math.min(options.timeoutMs ?? 30_000, 30_000),
      })
      .catch(() => undefined);
    return {
      reloaded: true,
      reloadRecovered: true,
      reloadError: sanitizeText(message).slice(0, 240),
    };
  }
}

function isRecoverableElectronReloadRace(message) {
  return (
    message.includes("net::ERR_ABORTED") ||
    message.includes("frame was detached")
  );
}

function shouldSkipTraceDebugOverrideReload(url) {
  return (
    url === "about:blank" ||
    url.includes("/main-window-startup.html") ||
    url.includes("\\main-window-startup.html")
  );
}

export async function collectAppServerTraceEvidence(
  page,
  requestLog,
  sessionId = null,
) {
  try {
    const listParams = {
      ...(typeof sessionId === "string" && sessionId ? { sessionId } : {}),
      limit: 5,
    };
    const listInvocation = await invokeAppServerFromPage(
      page,
      APP_SERVER_METHOD_DIAGNOSTICS_TRACE_LIST,
      listParams,
      requestLog,
    );
    const traces = Array.isArray(listInvocation.result?.traces)
      ? listInvocation.result.traces
      : [];
    const latestTrace = traces[0];
    if (!latestTrace?.traceId || !latestTrace?.sessionId) {
      return {
        available: listInvocation.result?.available === true,
        traceCount: traces.length,
        trace: null,
        events: [],
        checkpoints: [],
        redactionMode:
          typeof listInvocation.result?.redaction?.mode === "string"
            ? listInvocation.result.redaction.mode
            : null,
        hasProviderFirstTextDelta: false,
        hasAppServerMessageDelta: false,
        providerWaitMs: null,
        hasProviderWaitMs: false,
        serverEventEmittedAt: null,
        hasServerEventEmittedAt: false,
        hasW3cTraceContext: false,
        export: {
          available: false,
          exported: false,
          bundleFileName: null,
          includedSections: [],
          omittedSections: [],
          redactionMode: null,
        },
        supportBundleWithTrace: {
          bundleFileName: null,
          bundlePathExists: false,
          includedSections: [],
          omittedSections: [],
          traceExportIncluded: false,
          rawTraceJsonlOmitted: false,
        },
        forbiddenFragmentPresent: false,
      };
    }

    const readInvocation = await invokeAppServerFromPage(
      page,
      APP_SERVER_METHOD_DIAGNOSTICS_TRACE_READ,
      {
        sessionId: latestTrace.sessionId,
        traceId: latestTrace.traceId,
        maxEvents: 500,
      },
      requestLog,
    );
    const exportInvocation = await invokeAppServerFromPage(
      page,
      APP_SERVER_METHOD_DIAGNOSTICS_TRACE_EXPORT,
      {
        sessionId: latestTrace.sessionId,
        traceId: latestTrace.traceId,
      },
      requestLog,
    );
    const supportBundleInvocation = await invokeAppServerFromPage(
      page,
      APP_SERVER_METHOD_DIAGNOSTICS_SUPPORT_BUNDLE_EXPORT,
      {
        includeTraceExport: {
          sessionId: latestTrace.sessionId,
          traceId: latestTrace.traceId,
        },
      },
      requestLog,
    );

    return sanitizeJson(
      summarizeTraceEvidence({
        listResult: listInvocation.result,
        readResult: readInvocation.result,
        exportResult: exportInvocation.result,
        supportBundleResult: supportBundleInvocation.result,
      }),
    );
  } catch (error) {
    return {
      available: false,
      traceCount: 0,
      trace: null,
      events: [],
      checkpoints: [],
      redactionMode: null,
      hasProviderFirstTextDelta: false,
      hasAppServerMessageDelta: false,
      providerWaitMs: null,
      hasProviderWaitMs: false,
      serverEventEmittedAt: null,
      hasServerEventEmittedAt: false,
      hasW3cTraceContext: false,
      export: {
        available: false,
        exported: false,
        bundleFileName: null,
        includedSections: [],
        omittedSections: [],
        redactionMode: null,
      },
      supportBundleWithTrace: {
        bundleFileName: null,
        bundlePathExists: false,
        includedSections: [],
        omittedSections: [],
        traceExportIncluded: false,
        rawTraceJsonlOmitted: false,
      },
      forbiddenFragmentPresent: false,
      error: sanitizeText(error),
    };
  }
}

export async function collectAgentUiPerformanceTraceEvidence(page) {
  const snapshot = await page.evaluate(() => {
    const api = window.__LIME_AGENTUI_PERF__;
    if (!api || typeof api.summary !== "function") {
      return null;
    }
    return api.summary();
  });

  if (!snapshot) {
    return {
      available: false,
      entryCount: 0,
      sessionCount: 0,
      rawEntriesExported: false,
      sessions: [],
      hasProviderWaitMs: false,
      hasClientLocalOutputMs: false,
      hasHomeInputToPendingPreviewPaintMs: false,
      hasInputbarTriggerToPendingPreviewPaintMs: false,
      hasHomeInputToSendDispatchMs: false,
      hasHomeInputToFirstTextPaintMs: false,
      hasStreamRequestStartToFirstTextPaintMs: false,
      hasSubmitAcceptedToFirstTextPaintMs: false,
      hasFirstEventToFirstTextPaintMs: false,
      hasFirstVisibleOutputMs: false,
      hasFirstTextDeltaToFirstTextPaintMs: false,
      hasServerToRendererFirstTextDeltaMs: false,
      hasRendererApplyFirstTextDeltaMs: false,
      forbiddenFragmentPresent: false,
    };
  }

  const sessions = Array.isArray(snapshot.sessions)
    ? snapshot.sessions.map(compactTraceSession)
    : [];
  const evidence = {
    available: true,
    entryCount: Array.isArray(snapshot.entries) ? snapshot.entries.length : 0,
    sessionCount: sessions.length,
    rawEntriesExported: false,
    sessions,
    hasProviderWaitMs: hasMetric(sessions, "providerWaitMs"),
    hasClientLocalOutputMs: hasMetric(sessions, "clientLocalOutputMs"),
    hasHomeInputToPendingPreviewPaintMs: hasMetric(
      sessions,
      "homeInputToPendingPreviewPaintMs",
    ),
    hasInputbarTriggerToPendingPreviewPaintMs: hasMetric(
      sessions,
      "inputbarTriggerToPendingPreviewPaintMs",
    ),
    hasHomeInputToSendDispatchMs: hasMetric(
      sessions,
      "homeInputToSendDispatchMs",
    ),
    hasHomeInputToFirstTextPaintMs: hasMetric(
      sessions,
      "homeInputToFirstTextPaintMs",
    ),
    hasStreamRequestStartToFirstTextPaintMs: hasMetric(
      sessions,
      "streamRequestStartToFirstTextPaintMs",
    ),
    hasSubmitAcceptedToFirstTextPaintMs: hasMetric(
      sessions,
      "submitAcceptedToFirstTextPaintMs",
    ),
    hasFirstEventToFirstTextPaintMs: hasMetric(
      sessions,
      "firstEventToFirstTextPaintMs",
    ),
    hasFirstTextDeltaToFirstTextPaintMs: hasMetric(
      sessions,
      "firstTextDeltaToFirstTextPaintMs",
    ),
    hasServerToRendererFirstTextDeltaMs: hasMetric(
      sessions,
      "serverToRendererFirstTextDeltaMs",
    ),
    hasRendererApplyFirstTextDeltaMs: hasMetric(
      sessions,
      "rendererApplyFirstTextDeltaMs",
    ),
  };
  evidence.hasFirstVisibleOutputMs =
    evidence.hasHomeInputToFirstTextPaintMs ||
    evidence.hasStreamRequestStartToFirstTextPaintMs ||
    evidence.hasSubmitAcceptedToFirstTextPaintMs ||
    evidence.hasFirstEventToFirstTextPaintMs;

  return {
    ...evidence,
    forbiddenFragmentPresent: containsForbiddenTraceEvidenceFragment(evidence),
  };
}
