import {
  ASSISTANT_DONE_TEXT,
  NEWS_PROMPT,
} from "./claw-chat-current-fixture-constants.mjs";
import { collectReadModelItems } from "./claw-chat-current-fixture-read-model-core.mjs";
import {
  readArray,
  readRecord,
  readString,
} from "./claw-chat-current-fixture-utils.mjs";

export const UNKNOWN_ITEM_SCENARIO = "unknown-item";
export const UNKNOWN_ITEM_PROMPT = NEWS_PROMPT;
export const UNKNOWN_ITEM_DONE_TEXT = ASSISTANT_DONE_TEXT;
export const UNKNOWN_ITEM_UPSTREAM_TYPE = "futureCapability";
export const UNKNOWN_ITEM_SECRET_MARKER = "UNKNOWN_ITEM_SECRET_MUST_NOT_LEAK";
export const UNKNOWN_ITEM_SAFE_FIELD_NAMES = [
  "[redacted]",
  "label",
  "opaquePayload",
  "status",
];

export function renderUnknownItemBackendEventsExpression() {
  return `
    ...(process.env.CLAW_CHAT_FIXTURE_SCENARIO === "${UNKNOWN_ITEM_SCENARIO}"
      ? [
          {
            type: "item.started",
            payload: {
              item: {
                id: "unknown-item-" + currentTurnIdForItem,
                threadId: currentThreadId(),
                turnId: currentTurnId(),
                type: "${UNKNOWN_ITEM_UPSTREAM_TYPE}",
                label: "future capability",
                opaquePayload: "opaque-value-must-not-render",
                secretToken: "${UNKNOWN_ITEM_SECRET_MARKER}",
                status: "inProgress"
              }
            }
          },
          {
            type: "item.completed",
            payload: {
              item: {
                id: "unknown-item-" + currentTurnIdForItem,
                threadId: currentThreadId(),
                turnId: currentTurnId(),
                type: "${UNKNOWN_ITEM_UPSTREAM_TYPE}",
                label: "future capability",
                opaquePayload: "opaque-value-must-not-render",
                secretToken: "${UNKNOWN_ITEM_SECRET_MARKER}",
                status: "completed"
              }
            }
          }
        ]
      : []),`;
}

export function readUnknownItemRecoveryEvidence(value) {
  const projectedItem = collectReadModelItems(value).find(
    (item) =>
      item?.type === "unknown_item" &&
      item?.upstream_type === UNKNOWN_ITEM_UPSTREAM_TYPE,
  );
  if (projectedItem) {
    return projectedItem;
  }

  const thread = readRecord(value?.thread);
  const threadId = readString(thread, "id", "threadId", "thread_id");
  for (const candidateTurn of readArray(thread, "turns")) {
    const turn = readRecord(candidateTurn);
    const item = readArray(turn, "items")
      .map((candidate) => readRecord(candidate))
      .find(
        (candidate) =>
          candidate?.type === "unknownItem" &&
          candidate?.upstreamType === UNKNOWN_ITEM_UPSTREAM_TYPE,
      );
    if (!item) continue;

    return {
      id: readString(item, "id"),
      thread_id: threadId,
      turn_id: readString(turn, "id", "turnId", "turn_id"),
      status: readString(turn, "status"),
      upstream_type: readString(item, "upstreamType"),
      field_names: readArray(item, "fieldNames").filter(
        (fieldName) => typeof fieldName === "string",
      ),
    };
  }
  return null;
}

export async function collectUnknownItemScenarioEvidence({ page, readModel }) {
  const unsupportedItem = page.locator(
    '[data-testid="timeline-unsupported-item"]',
    { hasText: UNKNOWN_ITEM_UPSTREAM_TYPE },
  );
  await unsupportedItem.waitFor({ state: "visible" });
  const gui = await unsupportedItem.evaluate(
    (target, { upstreamType, secretMarker, safeFieldNames }) => {
      const text = target.innerText || "";
      const bodyText = document.body?.textContent || "";
      return {
        visible: target.getClientRects().length > 0 && text.trim().length > 0,
        diagnosticsCollapsed: target.querySelector("details")?.open === false,
        upstreamTypeHidden: !text.includes(upstreamType),
        safeFieldNamesHidden: safeFieldNames.every(
          (name) => !text.includes(name),
        ),
        internalTypeHidden: !text.includes("unknown_item"),
        rawValuesHidden:
          !bodyText.includes(secretMarker) &&
          !bodyText.includes("opaque-value-must-not-render") &&
          !bodyText.includes("future capability"),
      };
    },
    {
      upstreamType: UNKNOWN_ITEM_UPSTREAM_TYPE,
      secretMarker: UNKNOWN_ITEM_SECRET_MARKER,
      safeFieldNames: UNKNOWN_ITEM_SAFE_FIELD_NAMES,
    },
  );
  const diagnostics = unsupportedItem.getByTestId(
    "timeline-unsupported-item-diagnostics",
  );
  await diagnostics.waitFor({ state: "hidden" });
  await unsupportedItem.locator("summary").click();
  await diagnostics.waitFor({ state: "visible" });
  const expanded = await diagnostics.evaluate(
    (target, { upstreamType, safeFieldNames, secretMarker }) => ({
      diagnosticsExpanded: target.closest("details")?.open === true,
      upstreamTypeVisible: target.innerText.includes(upstreamType),
      safeFieldNamesVisible: safeFieldNames.every((name) =>
        target.innerText.includes(name),
      ),
      rawValuesHidden:
        !target.textContent.includes(secretMarker) &&
        !target.textContent.includes("opaque-value-must-not-render") &&
        !target.textContent.includes("future capability"),
    }),
    {
      upstreamType: UNKNOWN_ITEM_UPSTREAM_TYPE,
      safeFieldNames: UNKNOWN_ITEM_SAFE_FIELD_NAMES,
      secretMarker: UNKNOWN_ITEM_SECRET_MARKER,
    },
  );
  await unsupportedItem.locator("summary").click();
  await diagnostics.waitFor({ state: "hidden" });
  const item = readUnknownItemRecoveryEvidence(readModel);
  const serializedReadModel = JSON.stringify(readModel || {});
  return {
    gui: { ...gui, diagnostics: expanded },
    readModel: {
      present: Boolean(item),
      itemId: item?.id ?? null,
      threadId: item?.thread_id ?? null,
      turnId: item?.turn_id ?? null,
      status: item?.status ?? null,
      upstreamType: item?.upstream_type ?? null,
      fieldNames: Array.isArray(item?.field_names) ? item.field_names : [],
      rawValuesHidden:
        !serializedReadModel.includes(UNKNOWN_ITEM_SECRET_MARKER) &&
        !serializedReadModel.includes("opaque-value-must-not-render") &&
        !serializedReadModel.includes("future capability"),
    },
  };
}

function backendEventTypesForPrompt(backendLedger) {
  const startIndex = backendLedger.findIndex(
    (entry) =>
      entry?.kind === "turnStart" && entry?.inputText === UNKNOWN_ITEM_PROMPT,
  );
  if (startIndex < 0) return [];
  const eventTypes = [];
  for (const entry of backendLedger.slice(startIndex + 1)) {
    if (entry?.kind === "turnStart") break;
    if (entry?.kind === "backendEmit" && Array.isArray(entry.eventTypes)) {
      eventTypes.push(...entry.eventTypes.filter(Boolean));
    }
  }
  return eventTypes;
}

function includesOrdered(eventTypes, expected) {
  let cursor = 0;
  for (const eventType of eventTypes) {
    if (eventType === expected[cursor]) cursor += 1;
    if (cursor === expected.length) return true;
  }
  return false;
}

export function buildUnknownItemScenarioAssertions({
  appServerRequestMethods,
  backendLedger,
  summary,
}) {
  const evidence = summary.unknownItem ?? {};
  const eventTypes = backendEventTypesForPrompt(backendLedger);
  return {
    unknownItemBackendLifecycleObserved: includesOrdered(eventTypes, [
      "item.started",
      "item.completed",
      "turn.completed",
    ]),
    unknownItemUsesCurrentAppServerRead:
      appServerRequestMethods.includes("turn/start") &&
      appServerRequestMethods.includes("thread/read"),
    unknownItemGuiFailVisible:
      evidence.gui?.visible === true &&
      evidence.gui?.diagnosticsCollapsed === true &&
      evidence.gui?.upstreamTypeHidden === true &&
      evidence.gui?.safeFieldNamesHidden === true,
    unknownItemGuiDiagnosticsInteractive:
      evidence.gui?.diagnostics?.diagnosticsExpanded === true &&
      evidence.gui?.diagnostics?.upstreamTypeVisible === true &&
      evidence.gui?.diagnostics?.safeFieldNamesVisible === true,
    unknownItemGuiFieldsSanitized:
      evidence.gui?.internalTypeHidden === true &&
      evidence.gui?.rawValuesHidden === true &&
      evidence.gui?.diagnostics?.rawValuesHidden === true,
    unknownItemReadModelRecovered:
      evidence.readModel?.present === true &&
      evidence.readModel?.upstreamType === UNKNOWN_ITEM_UPSTREAM_TYPE &&
      evidence.readModel?.status === "completed",
    unknownItemReadModelFieldsSanitized:
      UNKNOWN_ITEM_SAFE_FIELD_NAMES.every((name) =>
        evidence.readModel?.fieldNames?.includes(name),
      ) && evidence.readModel?.rawValuesHidden === true,
  };
}
