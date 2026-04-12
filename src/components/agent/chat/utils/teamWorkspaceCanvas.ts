export interface TeamWorkspaceCanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface TeamWorkspaceCanvasItemLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
}

export interface TeamWorkspaceCanvasLayoutState {
  version: number;
  updatedAt: number;
  viewport: TeamWorkspaceCanvasViewport;
  items: Record<string, TeamWorkspaceCanvasItemLayout>;
}

export const TEAM_WORKSPACE_CANVAS_STORAGE_VERSION = 2;
export const TEAM_WORKSPACE_CANVAS_DEFAULT_VIEWPORT: TeamWorkspaceCanvasViewport =
  {
    x: 56,
    y: 56,
    zoom: 1,
  };
export const TEAM_WORKSPACE_CANVAS_MIN_ZOOM = 0.55;
export const TEAM_WORKSPACE_CANVAS_MAX_ZOOM = 1.65;
export const TEAM_WORKSPACE_CANVAS_DEFAULT_WIDTH = 360;
export const TEAM_WORKSPACE_CANVAS_DEFAULT_HEIGHT = 280;
export const TEAM_WORKSPACE_CANVAS_MIN_WIDTH = 280;
export const TEAM_WORKSPACE_CANVAS_MIN_HEIGHT = 200;
export const TEAM_WORKSPACE_CANVAS_WORLD_MIN_WIDTH = 1480;
export const TEAM_WORKSPACE_CANVAS_WORLD_MIN_HEIGHT = 980;
export const TEAM_WORKSPACE_CANVAS_WORLD_PADDING = 180;
export const TEAM_WORKSPACE_CANVAS_VIEWPORT_PADDING = 64;
export const TEAM_WORKSPACE_CANVAS_AUTO_LAYOUT_GAP_X = 24;
export const TEAM_WORKSPACE_CANVAS_AUTO_LAYOUT_GAP_Y = 28;
export const TEAM_WORKSPACE_CANVAS_STAGE_HEIGHT = "clamp(540px, 74vh, 920px)";
export const TEAM_WORKSPACE_CANVAS_KEYBOARD_PAN_STEP = 72;
export const TEAM_WORKSPACE_CANVAS_KEYBOARD_FAST_PAN_STEP = 216;

export interface TeamWorkspaceCanvasBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

interface TeamWorkspaceCanvasStageHintState {
  status?: "forming" | "formed" | "failed" | string;
  errorMessage?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeFiniteNumber(
  value: unknown,
  fallback: number,
  options?: {
    min?: number;
    max?: number;
  },
): number {
  const normalized =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;

  if (!Number.isFinite(normalized)) {
    return fallback;
  }

  const min = options?.min ?? Number.NEGATIVE_INFINITY;
  const max = options?.max ?? Number.POSITIVE_INFINITY;
  return Math.min(Math.max(normalized, min), max);
}

export function clampTeamWorkspaceCanvasZoom(value: number): number {
  return normalizeFiniteNumber(value, 1, {
    min: TEAM_WORKSPACE_CANVAS_MIN_ZOOM,
    max: TEAM_WORKSPACE_CANVAS_MAX_ZOOM,
  });
}

function clampCanvasNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function resolveCanvasAutoLayoutColumns(
  laneCount: number,
  viewportWidth: number,
): number {
  if (laneCount <= 1) {
    return 1;
  }
  if (laneCount === 2) {
    return 2;
  }

  if (viewportWidth >= 1080) {
    return Math.min(3, laneCount);
  }

  return Math.min(2, laneCount);
}

export function resolveCanvasLanePreferredSize(params: {
  laneKind: "session" | "runtime" | "planned";
  laneCount: number;
  viewportWidth: number;
  expanded?: boolean;
}): Pick<TeamWorkspaceCanvasItemLayout, "width" | "height"> {
  const columns = resolveCanvasAutoLayoutColumns(
    params.laneCount,
    params.viewportWidth,
  );
  const safeViewportWidth = Math.max(
    params.viewportWidth,
    columns >= 3 ? 1180 : 980,
  );
  const usableWidth =
    safeViewportWidth -
    TEAM_WORKSPACE_CANVAS_VIEWPORT_PADDING * 2 -
    Math.max(0, columns - 1) * TEAM_WORKSPACE_CANVAS_AUTO_LAYOUT_GAP_X;
  const rawWidth = Math.floor(usableWidth / columns);
  const width =
    params.laneKind === "session"
      ? clampCanvasNumber(
          rawWidth,
          340,
          columns === 1 ? 560 : columns === 2 ? 460 : 390,
        )
      : clampCanvasNumber(rawWidth - 20, 320, columns === 1 ? 520 : 380);
  const height =
    params.laneKind === "session"
      ? params.expanded
        ? clampCanvasNumber(Math.round(width * 1.68), 620, 880)
        : clampCanvasNumber(Math.round(width * 1.12), 380, 520)
      : clampCanvasNumber(Math.round(width * 0.78), 260, 340);

  return { width, height };
}

export function buildCanvasStageHint(params: {
  hasRealTeamGraph: boolean;
  hasRuntimeFormation: boolean;
  hasSelectedTeamPlan: boolean;
  teamDispatchPreviewState?: TeamWorkspaceCanvasStageHintState | null;
}): string {
  const {
    hasRealTeamGraph,
    hasRuntimeFormation,
    hasSelectedTeamPlan,
    teamDispatchPreviewState,
  } = params;

  if (hasRealTeamGraph) {
    return "当前任务会按状态持续刷新，焦点会优先落在正在处理的任务上；需要时可调整任务布局或缩放视图。";
  }

  if (teamDispatchPreviewState?.status === "forming") {
    return "当前任务分工正在准备中，任务拆出后会接手这些位置。";
  }

  if (teamDispatchPreviewState?.status === "formed") {
    return "当前任务分工已经准备好，任务拆出后会依次开始处理。";
  }

  if (teamDispatchPreviewState?.status === "failed") {
    return (
      teamDispatchPreviewState.errorMessage?.trim() ||
      "当前任务分工准备失败，暂时无法生成任务视图。"
    );
  }

  if (hasRuntimeFormation || hasSelectedTeamPlan) {
    return "这里会先展示当前任务分工，任务拆出后会切换为独立的任务视图。";
  }

  return "任务拆出后，这里会切换成独立的任务视图。";
}

export function resolveCanvasLaneBounds(
  layouts: TeamWorkspaceCanvasItemLayout[],
): TeamWorkspaceCanvasBounds {
  if (layouts.length === 0) {
    return {
      minX: 0,
      minY: 0,
      maxX: TEAM_WORKSPACE_CANVAS_WORLD_MIN_WIDTH,
      maxY: TEAM_WORKSPACE_CANVAS_WORLD_MIN_HEIGHT,
      width: TEAM_WORKSPACE_CANVAS_WORLD_MIN_WIDTH,
      height: TEAM_WORKSPACE_CANVAS_WORLD_MIN_HEIGHT,
    };
  }

  const minX = Math.min(...layouts.map((layout) => layout.x));
  const minY = Math.min(...layouts.map((layout) => layout.y));
  const maxX = Math.max(...layouts.map((layout) => layout.x + layout.width));
  const maxY = Math.max(...layouts.map((layout) => layout.y + layout.height));

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(
      TEAM_WORKSPACE_CANVAS_WORLD_MIN_WIDTH,
      maxX - minX + TEAM_WORKSPACE_CANVAS_WORLD_PADDING * 2,
    ),
    height: Math.max(
      TEAM_WORKSPACE_CANVAS_WORLD_MIN_HEIGHT,
      maxY - minY + TEAM_WORKSPACE_CANVAS_WORLD_PADDING * 2,
    ),
  };
}

export function resolveCanvasViewportMetrics(
  element: HTMLDivElement | null,
  fallbackHeight: number,
): {
  width: number;
  height: number;
} {
  const rect = element?.getBoundingClientRect();
  return {
    width: rect && rect.width > 0 ? rect.width : 960,
    height: rect && rect.height > 0 ? rect.height : fallbackHeight,
  };
}

export function canStartTeamWorkspaceCanvasPanGesture(
  target: EventTarget | null,
  currentTarget: EventTarget | null,
  modifierActive: boolean,
): boolean {
  if (modifierActive) {
    return true;
  }

  if (!(target instanceof HTMLElement)) {
    return target === currentTarget;
  }

  if (target.closest('[data-team-workspace-canvas-pan-block="true"]')) {
    return false;
  }

  return (
    target.closest('[data-team-workspace-canvas-pan-surface="true"]') !==
      null || target === currentTarget
  );
}

export function isEditableTeamWorkspaceCanvasKeyboardTarget(
  target: EventTarget | null,
): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return (
    target.isContentEditable ||
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    Boolean(target.closest("[contenteditable='true']"))
  );
}

export function buildDefaultTeamWorkspaceCanvasItemLayout(
  index: number,
  options?: {
    width?: number;
    height?: number;
    columns?: number;
    offsetX?: number;
    offsetY?: number;
    gapX?: number;
    gapY?: number;
  },
): TeamWorkspaceCanvasItemLayout {
  const width = normalizeFiniteNumber(
    options?.width,
    TEAM_WORKSPACE_CANVAS_DEFAULT_WIDTH,
    { min: TEAM_WORKSPACE_CANVAS_MIN_WIDTH },
  );
  const height = normalizeFiniteNumber(
    options?.height,
    TEAM_WORKSPACE_CANVAS_DEFAULT_HEIGHT,
    { min: TEAM_WORKSPACE_CANVAS_MIN_HEIGHT },
  );
  const columns = Math.max(1, Math.round(options?.columns ?? 3));
  const gapX = normalizeFiniteNumber(options?.gapX, 28, { min: 16 });
  const gapY = normalizeFiniteNumber(options?.gapY, 28, { min: 16 });
  const offsetX = normalizeFiniteNumber(options?.offsetX, 48);
  const offsetY = normalizeFiniteNumber(options?.offsetY, 48);
  const columnIndex = index % columns;
  const rowIndex = Math.floor(index / columns);

  return {
    x: offsetX + columnIndex * (width + gapX),
    y: offsetY + rowIndex * (height + gapY),
    width,
    height,
    zIndex: index + 1,
  };
}

export function buildTeamWorkspaceCanvasAutoLayout(
  items: Array<{
    persistKey: string;
    layout: TeamWorkspaceCanvasItemLayout;
  }>,
  options?: {
    maxRowWidth?: number;
    offsetX?: number;
    offsetY?: number;
    gapX?: number;
    gapY?: number;
    centerRows?: boolean;
  },
): Record<string, TeamWorkspaceCanvasItemLayout> {
  const maxRowWidth = normalizeFiniteNumber(options?.maxRowWidth, 920, {
    min: TEAM_WORKSPACE_CANVAS_MIN_WIDTH + 32,
  });
  const offsetX = normalizeFiniteNumber(options?.offsetX, 64);
  const offsetY = normalizeFiniteNumber(options?.offsetY, 64);
  const gapX = normalizeFiniteNumber(options?.gapX, 32, { min: 16 });
  const gapY = normalizeFiniteNumber(options?.gapY, 32, { min: 16 });
  const centerRows = options?.centerRows ?? true;
  const rows: Array<
    Array<{
      persistKey: string;
      layout: TeamWorkspaceCanvasItemLayout;
      width: number;
      height: number;
    }>
  > = [];
  let currentRow: Array<{
    persistKey: string;
    layout: TeamWorkspaceCanvasItemLayout;
    width: number;
    height: number;
  }> = [];
  let currentRowWidth = 0;

  items.forEach((item) => {
    const width = normalizeFiniteNumber(
      item.layout.width,
      TEAM_WORKSPACE_CANVAS_DEFAULT_WIDTH,
      { min: TEAM_WORKSPACE_CANVAS_MIN_WIDTH },
    );
    const height = normalizeFiniteNumber(
      item.layout.height,
      TEAM_WORKSPACE_CANVAS_DEFAULT_HEIGHT,
      { min: TEAM_WORKSPACE_CANVAS_MIN_HEIGHT },
    );
    const nextRowWidth =
      currentRow.length === 0 ? width : currentRowWidth + gapX + width;

    if (currentRow.length > 0 && nextRowWidth > maxRowWidth) {
      rows.push(currentRow);
      currentRow = [];
      currentRowWidth = 0;
    }

    currentRow.push({
      persistKey: item.persistKey,
      layout: item.layout,
      width,
      height,
    });
    currentRowWidth =
      currentRow.length === 1 ? width : currentRowWidth + gapX + width;
  });

  if (currentRow.length > 0) {
    rows.push(currentRow);
  }

  let cursorY = offsetY;
  let globalIndex = 0;

  return rows.reduce<Record<string, TeamWorkspaceCanvasItemLayout>>(
    (accumulator, row) => {
      const rowWidth =
        row.reduce((total, item) => total + item.width, 0) +
        Math.max(0, row.length - 1) * gapX;
      const rowHeight = row.reduce(
        (maxHeight, item) => Math.max(maxHeight, item.height),
        0,
      );
      let cursorX = centerRows
        ? offsetX + Math.max(0, (maxRowWidth - rowWidth) / 2)
        : offsetX;

      row.forEach((item) => {
        globalIndex += 1;
        accumulator[item.persistKey] = {
          ...item.layout,
          x: cursorX,
          y: cursorY,
          width: item.width,
          height: item.height,
          zIndex: globalIndex,
        };
        cursorX += item.width + gapX;
      });

      cursorY += rowHeight + gapY;
      return accumulator;
    },
    {},
  );
}

export function createDefaultTeamWorkspaceCanvasLayoutState(): TeamWorkspaceCanvasLayoutState {
  return {
    version: TEAM_WORKSPACE_CANVAS_STORAGE_VERSION,
    updatedAt: Date.now(),
    viewport: {
      ...TEAM_WORKSPACE_CANVAS_DEFAULT_VIEWPORT,
    },
    items: {},
  };
}

function normalizeItemLayout(
  value: unknown,
): TeamWorkspaceCanvasItemLayout | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    x: normalizeFiniteNumber(value.x, 0),
    y: normalizeFiniteNumber(value.y, 0),
    width: normalizeFiniteNumber(
      value.width,
      TEAM_WORKSPACE_CANVAS_DEFAULT_WIDTH,
      { min: TEAM_WORKSPACE_CANVAS_MIN_WIDTH },
    ),
    height: normalizeFiniteNumber(
      value.height,
      TEAM_WORKSPACE_CANVAS_DEFAULT_HEIGHT,
      { min: TEAM_WORKSPACE_CANVAS_MIN_HEIGHT },
    ),
    zIndex: normalizeFiniteNumber(value.zIndex, 1, { min: 1 }),
  };
}

export function normalizeTeamWorkspaceCanvasLayout(
  value: unknown,
): TeamWorkspaceCanvasLayoutState | null {
  if (!isRecord(value)) {
    return null;
  }

  const viewportRecord = isRecord(value.viewport) ? value.viewport : {};
  const itemsRecord = isRecord(value.items) ? value.items : {};
  const items = Object.entries(itemsRecord).reduce<
    Record<string, TeamWorkspaceCanvasItemLayout>
  >((accumulator, [key, itemValue]) => {
    const normalized = normalizeItemLayout(itemValue);
    if (normalized) {
      accumulator[key] = normalized;
    }
    return accumulator;
  }, {});

  return {
    version: TEAM_WORKSPACE_CANVAS_STORAGE_VERSION,
    updatedAt: normalizeFiniteNumber(value.updatedAt, Date.now()),
    viewport: {
      x: normalizeFiniteNumber(
        viewportRecord.x,
        TEAM_WORKSPACE_CANVAS_DEFAULT_VIEWPORT.x,
      ),
      y: normalizeFiniteNumber(
        viewportRecord.y,
        TEAM_WORKSPACE_CANVAS_DEFAULT_VIEWPORT.y,
      ),
      zoom: clampTeamWorkspaceCanvasZoom(
        normalizeFiniteNumber(
          viewportRecord.zoom,
          TEAM_WORKSPACE_CANVAS_DEFAULT_VIEWPORT.zoom,
        ),
      ),
    },
    items,
  };
}

export function getTeamWorkspaceCanvasStorageKey(sessionId: string): string {
  return `lime.team_workspace.canvas_layout.v2:${sessionId}`;
}

export function loadTeamWorkspaceCanvasLayout(
  sessionId?: string | null,
): TeamWorkspaceCanvasLayoutState | null {
  const normalizedSessionId = sessionId?.trim();
  if (!normalizedSessionId || typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(
      getTeamWorkspaceCanvasStorageKey(normalizedSessionId),
    );
    if (!raw) {
      return null;
    }
    return normalizeTeamWorkspaceCanvasLayout(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function persistTeamWorkspaceCanvasLayout(
  sessionId: string,
  state: TeamWorkspaceCanvasLayoutState,
): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      getTeamWorkspaceCanvasStorageKey(sessionId),
      JSON.stringify({
        ...state,
        version: TEAM_WORKSPACE_CANVAS_STORAGE_VERSION,
        updatedAt: Date.now(),
      }),
    );
  } catch {
    return;
  }
}
