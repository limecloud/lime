import { tool, stringProperty, integerProperty } from "./dynamicToolSchema";

const identity = {
  snapshotId: stringProperty("snapshotId from the latest observe result."),
  tabId: stringProperty("Claimed tab id; defaults to the selected tab."),
};
const backendNodeId = integerProperty(
  "backendNodeId from the latest observe result.",
);

export const BROWSER_INPUT_TOOLS = Object.freeze([
  tool(
    "hover",
    "Hover over a visible main-document node from the latest observe result. Scrolls it into view and rejects obscured targets. Observe again after the action.",
    { ...identity, backendNodeId },
    ["backendNodeId", "snapshotId"],
  ),
  tool(
    "scroll",
    "Scroll with a native wheel in CSS pixels. Positive deltaY scrolls down; positive deltaX scrolls right. An optional observed main-document node targets its scroll container; otherwise the viewport center is used. Frame targets are unavailable. Observe again after the action.",
    {
      ...identity,
      backendNodeId,
      deltaX: { type: "number", minimum: -10000, maximum: 10000 },
      deltaY: { type: "number", minimum: -10000, maximum: 10000 },
    },
    ["snapshotId"],
  ),
  tool(
    "select",
    "Select options in a main-document native HTML select after one-use action approval. Each choice matches all supplied value/label/index fields exactly; index is zero-based. Supports multiple selects and an empty array to clear selection. Dispatches synthetic input/change events. Observe again afterwards.",
    {
      ...identity,
      backendNodeId,
      options: {
        type: "array",
        maxItems: 100,
        items: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: {
            value: { type: "string", maxLength: 4000 },
            label: { type: "string", maxLength: 4000 },
            index: { type: "integer", minimum: 0 },
          },
        },
      },
    },
    ["backendNodeId", "snapshotId", "options"],
  ),
  tool(
    "drag",
    "Drag from an observed main-document source node to an observed destination in the same snapshot after one-use action approval. Supports pointer drags and HTML5 drag-and-drop. Does not accept local files or child-frame targets. Observe again afterwards.",
    {
      ...identity,
      backendNodeId,
      targetBackendNodeId: integerProperty(
        "Destination backendNodeId from the same observe result.",
      ),
    },
    ["backendNodeId", "targetBackendNodeId", "snapshotId"],
  ),
]);
