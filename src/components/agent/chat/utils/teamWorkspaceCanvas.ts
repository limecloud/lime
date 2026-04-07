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
