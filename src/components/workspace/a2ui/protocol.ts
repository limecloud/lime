import {
  STANDARD_CATALOG_ID,
  type A2UIComponent,
  type A2UIResponse,
} from "./types";
import { updateDataModel } from "./dataModel";

type UnknownRecord = Record<string, unknown>;

interface SurfaceState {
  surfaceId: string;
  catalogId: string;
  root?: string;
  components: Map<string, A2UIComponent>;
  data: Record<string, unknown>;
}

type NormalizedMessage =
  | {
      type: "createSurface";
      surfaceId: string;
      catalogId: string;
      root?: string;
    }
  | {
      type: "updateComponents";
      surfaceId: string;
      components: A2UIComponent[];
    }
  | {
      type: "updateDataModel";
      surfaceId: string;
      path?: string;
      value?: unknown;
    }
  | {
      type: "deleteSurface";
      surfaceId: string;
    };

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isA2UIResponseShape(value: unknown): value is A2UIResponse {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    Array.isArray(value.components) &&
    typeof value.root === "string"
  );
}

function hasProtocolKeys(value: UnknownRecord): boolean {
  return [
    "createSurface",
    "updateComponents",
    "updateDataModel",
    "deleteSurface",
    "beginRendering",
    "surfaceUpdate",
    "dataModelUpdate",
  ].some((key) => key in value);
}

function unwrapContentEnvelope(value: UnknownRecord): UnknownRecord {
  if (
    "content" in value &&
    isRecord(value.content) &&
    !hasProtocolKeys(value)
  ) {
    return {
      ...(typeof value.version === "string" ? { version: value.version } : {}),
      ...value.content,
    };
  }

  return value;
}

function extractProtocolMessages(value: unknown): UnknownRecord[] | null {
  if (Array.isArray(value)) {
    return value.filter(isRecord).map(unwrapContentEnvelope);
  }

  if (!isRecord(value)) {
    return null;
  }

  if (Array.isArray(value.messages)) {
    return value.messages.filter(isRecord).map(unwrapContentEnvelope);
  }

  const unwrapped = unwrapContentEnvelope(value);
  return hasProtocolKeys(unwrapped) ? [unwrapped] : null;
}

function unwrapLegacyLiteral(value: UnknownRecord): unknown {
  const literalEntries: [string, unknown][] = [
    ["literalString", value.literalString],
    ["literalNumber", value.literalNumber],
    ["literalBoolean", value.literalBoolean],
    ["literalInt", value.literalInt],
    ["literalFloat", value.literalFloat],
    ["literalNull", null],
  ];

  const literal = literalEntries.find(([key]) => key in value);
  if (literal) {
    return literal[1];
  }

  if ("literalList" in value && Array.isArray(value.literalList)) {
    return value.literalList.map((item) =>
      isRecord(item) ? unwrapLegacyValue(item) : item,
    );
  }

  if ("path" in value && typeof value.path === "string") {
    return { path: value.path };
  }

  if ("call" in value && typeof value.call === "string") {
    return value;
  }

  return null;
}

function unwrapLegacyValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => unwrapLegacyValue(item));
  }

  if (!isRecord(value)) {
    return value;
  }

  const literal = unwrapLegacyLiteral(value);
  if (literal !== null) {
    return literal;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [
      key,
      unwrapLegacyValue(entryValue),
    ]),
  );
}

function convertLegacyChildList(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  if (Array.isArray(value.explicitList)) {
    return value.explicitList.filter(
      (childId): childId is string => typeof childId === "string",
    );
  }

  if (isRecord(value.template)) {
    const componentId =
      typeof value.template.componentId === "string"
        ? value.template.componentId
        : null;
    if (!componentId) {
      return [];
    }

    const path =
      typeof value.template.dataBinding === "string"
        ? value.template.dataBinding
        : typeof value.template.path === "string"
          ? value.template.path
          : "/";

    return {
      componentId,
      path,
    };
  }

  if (typeof value.componentId === "string" && typeof value.path === "string") {
    return {
      componentId: value.componentId,
      path: value.path,
    };
  }

  return unwrapLegacyValue(value);
}

function convertLegacyActionContext(
  value: unknown,
): Record<string, unknown> | undefined {
  if (Array.isArray(value)) {
    const entries = value
      .filter(isRecord)
      .filter(
        (entry): entry is UnknownRecord & { key: string } =>
          typeof entry.key === "string",
      )
      .map((entry) => [entry.key, unwrapLegacyValue(entry.value)] as const);

    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [
      key,
      unwrapLegacyValue(entryValue),
    ]),
  );
}

function convertLegacyAction(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  if (
    "event" in value ||
    "functionCall" in value ||
    "name" in value === false
  ) {
    return unwrapLegacyValue(value);
  }

  const name = typeof value.name === "string" ? value.name : "submit";
  const context = convertLegacyActionContext(value.context);

  return {
    event: {
      name,
      ...(context ? { context } : {}),
    },
  };
}

function convertLegacyTabItems(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }

  return value
    .filter(isRecord)
    .map((item) => ({
      title: unwrapLegacyValue(item.title),
      child: typeof item.child === "string" ? item.child : "",
    }))
    .filter((item) => item.child.length > 0);
}

function convertLegacyComponent(
  rawComponent: UnknownRecord,
): A2UIComponent | null {
  const rawId = rawComponent.id;
  const rawDefinition = rawComponent.component;

  if (typeof rawId !== "string" || !isRecord(rawDefinition)) {
    return null;
  }

  const [rawType] = Object.keys(rawDefinition);
  const props = rawDefinition[rawType];

  if (!rawType || !isRecord(props)) {
    return null;
  }

  const componentType = rawType === "MultipleChoice" ? "ChoicePicker" : rawType;
  const nextComponent: UnknownRecord = {
    id: rawId,
    component: componentType,
  };

  if (typeof rawComponent.weight === "number") {
    nextComponent.weight = rawComponent.weight;
  }

  for (const [key, rawValue] of Object.entries(props)) {
    switch (key) {
      case "children":
        nextComponent.children = convertLegacyChildList(rawValue);
        break;
      case "tabItems":
        nextComponent.tabs = convertLegacyTabItems(rawValue);
        break;
      case "entryPointChild":
        if (typeof rawValue === "string") {
          nextComponent.trigger = rawValue;
        }
        break;
      case "contentChild":
        if (typeof rawValue === "string") {
          nextComponent.content = rawValue;
        }
        break;
      case "usageHint":
        nextComponent.variant = unwrapLegacyValue(rawValue);
        break;
      case "alignment":
        nextComponent.align = unwrapLegacyValue(rawValue);
        break;
      case "distribution":
        nextComponent.justify = unwrapLegacyValue(rawValue);
        break;
      case "action":
        nextComponent.action = convertLegacyAction(rawValue);
        break;
      case "text":
        if (componentType === "TextField") {
          nextComponent.value = unwrapLegacyValue(rawValue);
        } else {
          nextComponent.text = unwrapLegacyValue(rawValue);
        }
        break;
      case "type":
      case "textFieldType":
        if (componentType === "TextField") {
          nextComponent.variant = unwrapLegacyValue(rawValue);
        } else {
          nextComponent[key] = unwrapLegacyValue(rawValue);
        }
        break;
      case "selections":
        if (componentType === "ChoicePicker") {
          nextComponent.value = unwrapLegacyValue(rawValue);
        } else {
          nextComponent[key] = unwrapLegacyValue(rawValue);
        }
        break;
      case "maxAllowedSelections":
        if (componentType === "ChoicePicker") {
          nextComponent.variant =
            Number(rawValue) === 1 ? "mutuallyExclusive" : "multipleSelection";
        }
        break;
      case "primary":
        if (componentType === "Button") {
          nextComponent.variant = rawValue ? "primary" : "borderless";
        }
        break;
      default:
        nextComponent[key] =
          key === "child" && typeof rawValue === "string"
            ? rawValue
            : unwrapLegacyValue(rawValue);
        break;
    }
  }

  return nextComponent as unknown as A2UIComponent;
}

function extractLegacyDataEntryValue(value: UnknownRecord): unknown {
  if ("valueString" in value) {
    return value.valueString;
  }
  if ("valueNumber" in value) {
    return value.valueNumber;
  }
  if ("valueBoolean" in value) {
    return value.valueBoolean;
  }
  if ("valueInt" in value) {
    return value.valueInt;
  }
  if ("valueFloat" in value) {
    return value.valueFloat;
  }
  if ("valueNull" in value) {
    return null;
  }
  if (Array.isArray(value.valueMap)) {
    return convertLegacyDataEntries(value.valueMap);
  }
  if (Array.isArray(value.valueList)) {
    return value.valueList.map((entry) =>
      isRecord(entry) ? extractLegacyDataEntryValue(entry) : entry,
    );
  }
  return undefined;
}

function convertLegacyDataEntries(entries: unknown[]): Record<string, unknown> {
  return Object.fromEntries(
    entries
      .filter(isRecord)
      .filter(
        (entry): entry is UnknownRecord & { key: string } =>
          typeof entry.key === "string",
      )
      .map((entry) => [entry.key, extractLegacyDataEntryValue(entry)]),
  );
}

function convertRawComponent(
  rawComponent: unknown,
  isLegacy: boolean,
): A2UIComponent | null {
  if (!isRecord(rawComponent)) {
    return null;
  }

  if (isLegacy || isRecord(rawComponent.component)) {
    return convertLegacyComponent(rawComponent);
  }

  return rawComponent as unknown as A2UIComponent;
}

function normalizeMessage(message: UnknownRecord): NormalizedMessage | null {
  if (isRecord(message.createSurface)) {
    return {
      type: "createSurface",
      surfaceId:
        typeof message.createSurface.surfaceId === "string"
          ? message.createSurface.surfaceId
          : "main",
      catalogId:
        typeof message.createSurface.catalogId === "string"
          ? message.createSurface.catalogId
          : STANDARD_CATALOG_ID,
      root: "root",
    };
  }

  if (isRecord(message.beginRendering)) {
    return {
      type: "createSurface",
      surfaceId:
        typeof message.beginRendering.surfaceId === "string"
          ? message.beginRendering.surfaceId
          : "main",
      catalogId:
        typeof message.beginRendering.catalogId === "string"
          ? message.beginRendering.catalogId
          : STANDARD_CATALOG_ID,
      root:
        typeof message.beginRendering.root === "string"
          ? message.beginRendering.root
          : "root",
    };
  }

  if (
    isRecord(message.updateComponents) &&
    Array.isArray(message.updateComponents.components)
  ) {
    return {
      type: "updateComponents",
      surfaceId:
        typeof message.updateComponents.surfaceId === "string"
          ? message.updateComponents.surfaceId
          : "main",
      components: message.updateComponents.components
        .map((component) => convertRawComponent(component, false))
        .filter((component): component is A2UIComponent => component !== null),
    };
  }

  if (
    isRecord(message.surfaceUpdate) &&
    Array.isArray(message.surfaceUpdate.components)
  ) {
    return {
      type: "updateComponents",
      surfaceId:
        typeof message.surfaceUpdate.surfaceId === "string"
          ? message.surfaceUpdate.surfaceId
          : "main",
      components: message.surfaceUpdate.components
        .map((component) => convertRawComponent(component, true))
        .filter((component): component is A2UIComponent => component !== null),
    };
  }

  if (isRecord(message.updateDataModel)) {
    return {
      type: "updateDataModel",
      surfaceId:
        typeof message.updateDataModel.surfaceId === "string"
          ? message.updateDataModel.surfaceId
          : "main",
      path:
        typeof message.updateDataModel.path === "string"
          ? message.updateDataModel.path
          : "/",
      value: message.updateDataModel.value,
    };
  }

  if (isRecord(message.dataModelUpdate)) {
    return {
      type: "updateDataModel",
      surfaceId:
        typeof message.dataModelUpdate.surfaceId === "string"
          ? message.dataModelUpdate.surfaceId
          : "main",
      path:
        typeof message.dataModelUpdate.path === "string"
          ? message.dataModelUpdate.path
          : "/",
      value: Array.isArray(message.dataModelUpdate.contents)
        ? convertLegacyDataEntries(message.dataModelUpdate.contents)
        : undefined,
    };
  }

  if (isRecord(message.deleteSurface)) {
    return {
      type: "deleteSurface",
      surfaceId:
        typeof message.deleteSurface.surfaceId === "string"
          ? message.deleteSurface.surfaceId
          : "main",
    };
  }

  return null;
}

function ensureSurface(
  surfaces: Map<string, SurfaceState>,
  surfaceId: string,
): SurfaceState {
  const existing = surfaces.get(surfaceId);
  if (existing) {
    return existing;
  }

  const created: SurfaceState = {
    surfaceId,
    catalogId: STANDARD_CATALOG_ID,
    root: undefined,
    components: new Map(),
    data: {},
  };
  surfaces.set(surfaceId, created);
  return created;
}

function selectSurface(
  surfaces: Map<string, SurfaceState>,
  preferredSurfaceId: string | null,
): SurfaceState | null {
  if (preferredSurfaceId) {
    const preferred = surfaces.get(preferredSurfaceId);
    if (preferred) {
      return preferred;
    }
  }

  for (const surface of surfaces.values()) {
    if (surface.components.size > 0) {
      return surface;
    }
  }

  return surfaces.values().next().value ?? null;
}

export function convertProtocolToA2UIResponse(
  value: unknown,
): A2UIResponse | null {
  if (isA2UIResponseShape(value)) {
    return value;
  }

  const rawMessages = extractProtocolMessages(value);
  if (!rawMessages || rawMessages.length === 0) {
    return null;
  }

  const normalizedMessages = rawMessages
    .map((message) => normalizeMessage(message))
    .filter((message): message is NormalizedMessage => message !== null);

  if (normalizedMessages.length === 0) {
    return null;
  }

  const surfaces = new Map<string, SurfaceState>();
  let lastTouchedSurfaceId: string | null = null;

  for (const message of normalizedMessages) {
    lastTouchedSurfaceId = message.surfaceId;

    switch (message.type) {
      case "createSurface": {
        const surface = ensureSurface(surfaces, message.surfaceId);
        surface.catalogId = message.catalogId;
        surface.root = message.root || surface.root;
        break;
      }
      case "updateComponents": {
        const surface = ensureSurface(surfaces, message.surfaceId);
        for (const component of message.components) {
          surface.components.set(component.id, component);
        }
        if (!surface.root && surface.components.has("root")) {
          surface.root = "root";
        }
        break;
      }
      case "updateDataModel": {
        const surface = ensureSurface(surfaces, message.surfaceId);
        surface.data = updateDataModel(
          surface.data,
          message.path,
          message.value,
        );
        break;
      }
      case "deleteSurface":
        surfaces.delete(message.surfaceId);
        break;
    }
  }

  const surface = selectSurface(surfaces, lastTouchedSurfaceId);
  if (!surface || surface.components.size === 0) {
    return null;
  }

  const root =
    (surface.root && surface.components.has(surface.root) && surface.root) ||
    (surface.components.has("root") ? "root" : null) ||
    surface.components.keys().next().value;

  if (!root) {
    return null;
  }

  return {
    id: `surface-${surface.surfaceId}`,
    root,
    components: [...surface.components.values()],
    data: surface.data,
  };
}
