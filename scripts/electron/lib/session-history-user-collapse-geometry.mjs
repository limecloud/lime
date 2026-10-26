import {
  extractClipboardCopyEvidence,
  summarizeClipboardCopyProof,
} from "../../lib/chat-fixture/user-message-collapse-clipboard-observation.mjs";

export const COLLAPSE_SELECTORS = Object.freeze({
  scroll: '[data-testid="message-list-scroll-container"]',
  frame: '[data-testid="message-list-frame"]',
  root: '[data-testid="collapsible-user-message-content"]',
  viewport: '[data-testid="user-message-content-viewport"]',
  full: '[data-testid="user-message-content-full"]',
  toggle: '[data-testid="user-message-content-toggle"]',
});

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function canonicalBubbleSelector(probe) {
  for (const id of [probe.turnId, probe.itemId]) {
    assert(
      typeof id === "string" && /^[A-Za-z0-9_:-]+$/.test(id),
      "非法 fixture DOM identity",
    );
  }
  return `[data-message-role="user"][data-runtime-turn-id="${probe.turnId}"][data-thread-item-id="${probe.itemId}"]`;
}

export async function readCanonicalCollapseGeometry(page, probe) {
  return page.evaluate(
    async ({ probe, selectors }) => {
      const rect = (node) => {
        if (!(node instanceof Element)) return null;
        const value = node.getBoundingClientRect();
        return {
          top: value.top,
          bottom: value.bottom,
          height: value.height,
          left: value.left,
          right: value.right,
          width: value.width,
        };
      };
      const scroll = document.querySelector(selectors.scroll);
      const scrollRect = rect(scroll);
      const virtualList = scroll?.querySelector(
        '[data-testid="virtualized-turn-list"]',
      );
      const integerAttribute = (name) => {
        const raw = virtualList?.getAttribute(name);
        const value = raw === null || raw === undefined ? NaN : Number(raw);
        return Number.isSafeInteger(value) && value >= 0 ? value : null;
      };
      const bubbles = [
        ...document.querySelectorAll('[data-message-role="user"]'),
      ].filter(
        (node) =>
          node.getAttribute("data-runtime-turn-id") === probe.turnId &&
          node.getAttribute("data-thread-item-id") === probe.itemId,
      );
      const bubble = bubbles[0];
      const group = bubble?.closest('[data-testid="message-turn-group"]');
      const row = bubble?.closest("[data-turn-key]");
      const roots = bubble ? [...bubble.querySelectorAll(selectors.root)] : [];
      const root = roots[0];
      const viewport = root?.querySelector(selectors.viewport);
      const full = root?.querySelector(selectors.full);
      const toggle = root?.querySelector(selectors.toggle);
      const viewportRect = rect(viewport);
      const lineHeight = full
        ? Number.parseFloat(getComputedStyle(full).lineHeight)
        : NaN;
      const link = (href) => {
        const nodes = full
          ? [...full.querySelectorAll("a")].filter(
              (node) => node.getAttribute("href") === href,
            )
          : [];
        const node = nodes[0];
        const bounds = rect(node);
        const style = node ? getComputedStyle(node) : null;
        const inert = Boolean(node?.closest("[inert]"));
        const displayable = Boolean(
          node &&
          style?.display !== "none" &&
          style?.visibility !== "hidden" &&
          bounds?.height > 0,
        );
        return {
          count: nodes.length,
          inert,
          tabIndex: node instanceof HTMLElement ? node.tabIndex : null,
          clippedInContentViewport: Boolean(
            displayable &&
            viewportRect &&
            bounds.top >= viewportRect.top - 1 &&
            bounds.bottom <= viewportRect.bottom + 1,
          ),
          focused: document.activeElement === node,
        };
      };
      const rows = [...document.querySelectorAll("[data-turn-key]")]
        .map((node) => {
          const innerGroup = node.querySelector(
            '[data-testid="message-turn-group"]',
          );
          const bounds = rect(node);
          return {
            key: node.getAttribute("data-turn-key"),
            turnId: innerGroup?.getAttribute("data-runtime-turn-id") ?? null,
            kind: innerGroup?.getAttribute("data-render-entry-kind") ?? null,
            offset: Number.parseFloat(node.parentElement?.style.top ?? ""),
            ...bounds,
            relativeTop: scrollRect ? bounds.top - scrollRect.top : null,
            visible: Boolean(
              scrollRect &&
              bounds.bottom > scrollRect.top + 1 &&
              bounds.top < scrollRect.bottom - 1,
            ),
          };
        })
        .sort((a, b) => a.top - b.top);
      const active = document.activeElement;
      const renderedText = full?.textContent ?? null;
      const renderedDigest =
        renderedText === null
          ? null
          : await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(renderedText),
            );
      return {
        sessionId:
          document
            .querySelector(selectors.frame)
            ?.getAttribute("data-session-id") ?? null,
        bubbleCount: bubbles.length,
        rootCount: roots.length,
        turnId: bubble?.getAttribute("data-runtime-turn-id") ?? null,
        itemId: bubble?.getAttribute("data-thread-item-id") ?? null,
        directKind: bubble?.getAttribute("data-direct-segment-kind") ?? null,
        entryKind: group?.getAttribute("data-render-entry-kind") ?? null,
        rowKey: row?.getAttribute("data-turn-key") ?? null,
        state: root?.getAttribute("data-user-message-content-state") ?? null,
        viewport: viewportRect,
        full: {
          ...rect(full),
          scrollHeight: full?.scrollHeight ?? null,
          textLength: full?.textContent?.length ?? null,
          textIdentity:
            renderedDigest === null
              ? null
              : {
                  length: renderedText.length,
                  sha256: [...new Uint8Array(renderedDigest)]
                    .map((byte) => byte.toString(16).padStart(2, "0"))
                    .join(""),
                },
          hasStart: Boolean(full?.textContent?.includes(probe.startMarker)),
          hasTail: Boolean(full?.textContent?.includes(probe.tailMarker)),
        },
        lineHeight: Number.isFinite(lineHeight) ? lineHeight : null,
        toggle: {
          tag: toggle?.tagName ?? null,
          expanded: toggle?.getAttribute("aria-expanded") ?? null,
          controls: toggle?.getAttribute("aria-controls") ?? null,
          controlsViewport: Boolean(
            viewport?.id &&
            toggle?.getAttribute("aria-controls") === viewport.id &&
            document.getElementById(viewport.id) === viewport,
          ),
        },
        firstLink: link(probe.visibleHref),
        tailLink: link(probe.hiddenHref),
        scroll:
          scroll && scrollRect
            ? {
                ...scrollRect,
                scrollTop: scroll.scrollTop,
                scrollHeight: scroll.scrollHeight,
                clientHeight: scroll.clientHeight,
                distanceToBottom:
                  scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight,
              }
            : null,
        virtual: {
          totalEntries: integerAttribute("data-total-entries"),
          startIndex: integerAttribute("data-start-index"),
          endIndex: integerAttribute("data-end-index"),
          offscreenCount: integerAttribute("data-offscreen-count"),
        },
        rows,
        firstVisible: rows.find((entry) => entry.visible) ?? null,
        active: {
          isToggle: active === toggle,
          isFirstLink:
            active?.getAttribute?.("href") === probe.visibleHref &&
            Boolean(root?.contains(active)),
          isTailLink:
            active?.getAttribute?.("href") === probe.hiddenHref &&
            Boolean(root?.contains(active)),
          insideRoot: Boolean(root?.contains(active)),
        },
      };
    },
    { probe, selectors: COLLAPSE_SELECTORS },
  );
}

export function assertLongListCollapseLoadedTailRange(snapshot, probe) {
  const count = snapshot.virtual?.totalEntries;
  assert(
    Number.isSafeInteger(count) && count > 0 && count <= probe.totalTurnCount,
    "缺实际 virtual loaded entry 数量",
  );
  assert(
    snapshot.rows.some(
      (row) => row.turnId === probe.tailTurnId && row.kind === "canonical_turn",
    ),
    "未挂载 canonical tail，不能推断当前是末页窗口",
  );
  const firstOrdinal = probe.totalTurnCount - count + 1;
  assert(
    probe.ordinal - 1 >= firstOrdinal &&
      probe.ordinal + 1 < probe.totalTurnCount,
    "collapse probe 与 surviving 邻居未处于实际 virtual 尾页范围",
  );
  return {
    basis: "observed-virtual-count-and-mounted-canonical-tail",
    totalEntries: count,
    firstOrdinal,
    lastOrdinal: probe.totalTurnCount,
    probeOrdinal: probe.ordinal,
    neighborsInside: true,
    completeLoadedIdentityClaim: false,
  };
}

export function assertLongListCollapseMountedNeighbors(snapshot, probe) {
  for (const turnId of [probe.previousTurnId, probe.turnId, probe.nextTurnId]) {
    const matches = snapshot.rows.filter((row) => row.turnId === turnId);
    assert(
      matches.length === 1 && matches[0].kind === "canonical_turn",
      `真实 wheel 后 canonical probe/邻居未唯一挂载: ${turnId}`,
    );
  }
  return {
    previousTurnId: probe.previousTurnId,
    turnId: probe.turnId,
    nextTurnId: probe.nextTurnId,
  };
}

const safeId = (value) =>
  typeof value === "string" &&
  value.length <= 180 &&
  /^[A-Za-z0-9_:-]+$/.test(value)
    ? value
    : null;
const safeNumber = (value) => (Number.isFinite(value) ? value : null);
const safeInteger = (value) =>
  Number.isSafeInteger(value) && value >= 0 ? value : null;
const safeState = (value) =>
  ["collapsed", "expanded", "short", "unmeasured"].includes(value)
    ? value
    : null;
const safeRect = (value) =>
  Object.fromEntries(
    ["top", "bottom", "height", "left", "right", "width", "relativeTop"].map(
      (key) => [key, safeNumber(value?.[key])],
    ),
  );

// 落盘边界为白名单；不展开未知对象、正文、clipboard 或 transport request。
export function summarizeLongListCollapseGeometry(snapshot = {}) {
  const rows = Array.isArray(snapshot.rows)
    ? snapshot.rows
    : Array.isArray(snapshot.mountedRows)
      ? snapshot.mountedRows
      : [];
  const row = (value) => ({
    key: safeId(value?.key),
    turnId: safeId(value?.turnId),
    kind: value?.kind === "canonical_turn" ? "canonical_turn" : null,
    ...safeRect(value),
    offset: safeNumber(value?.offset),
    visible: value?.visible === true,
  });
  return {
    sessionId: safeId(snapshot.sessionId),
    turnId: safeId(snapshot.turnId),
    itemId: safeId(snapshot.itemId),
    rowKey: safeId(snapshot.rowKey),
    directKind: snapshot.directKind === "message" ? "message" : null,
    entryKind:
      snapshot.entryKind === "canonical_turn" ? "canonical_turn" : null,
    bubbleCount: safeInteger(snapshot.bubbleCount),
    rootCount: safeInteger(snapshot.rootCount),
    state: safeState(snapshot.state),
    toggle: {
      tag: snapshot.toggle?.tag === "BUTTON" ? "BUTTON" : null,
      expanded: ["true", "false"].includes(snapshot.toggle?.expanded)
        ? snapshot.toggle.expanded
        : null,
      controls: safeId(snapshot.toggle?.controls),
      controlsViewport: snapshot.toggle?.controlsViewport === true,
    },
    ...Object.fromEntries(
      ["firstLink", "tailLink"].map((key) => [
        key,
        {
          count: safeInteger(snapshot[key]?.count),
          inert: snapshot[key]?.inert === true,
          tabIndex: safeNumber(snapshot[key]?.tabIndex),
          clippedInContentViewport:
            snapshot[key]?.clippedInContentViewport === true,
          focused: snapshot[key]?.focused === true,
        },
      ]),
    ),
    lineHeight: safeNumber(snapshot.lineHeight),
    viewport: safeRect(snapshot.viewport),
    full: {
      ...safeRect(snapshot.full),
      scrollHeight: safeNumber(snapshot.full?.scrollHeight),
      textIdentity: {
        length: safeInteger(snapshot.full?.textIdentity?.length),
        sha256: /^[a-f0-9]{64}$/.test(snapshot.full?.textIdentity?.sha256 ?? "")
          ? snapshot.full.textIdentity.sha256
          : null,
      },
      hasStart: snapshot.full?.hasStart === true,
      hasTail: snapshot.full?.hasTail === true,
    },
    virtual: Object.fromEntries(
      ["totalEntries", "startIndex", "endIndex", "offscreenCount"].map(
        (key) => [key, safeInteger(snapshot.virtual?.[key])],
      ),
    ),
    scroll: {
      ...safeRect(snapshot.scroll),
      ...Object.fromEntries(
        ["scrollTop", "scrollHeight", "clientHeight", "distanceToBottom"].map(
          (key) => [key, safeNumber(snapshot.scroll?.[key])],
        ),
      ),
    },
    mountedRows: rows.slice(0, 240).map(row),
    firstVisible: snapshot.firstVisible ? row(snapshot.firstVisible) : null,
    active: Object.fromEntries(
      ["isToggle", "isFirstLink", "isTailLink", "insideRoot"].map((key) => [
        key,
        snapshot.active?.[key] === true,
      ]),
    ),
    completeLoadedIdentityClaim: false,
  };
}

const FAILURE_STAGES = [
  "initial-page",
  "wheel-target",
  "collapsed",
  "collapsed-copy",
  "collapsed-keyboard",
  "expanded",
  "expanded-copy",
  "expanded-keyboard",
  "successor-anchor",
  "collapse-anchor",
  "restart-precondition",
  "business-boundary",
  "trusted-input",
  "collector-cleanup",
];
const FAILURE_OBSERVATIONS = [
  "initial",
  "collapsed",
  "expanded",
  "beforeAnchor",
  "afterAnchor",
  "current",
];

export function summarizeLongListCollapseMeasurements(capture = {}) {
  const samples = (Array.isArray(capture?.samples) ? capture.samples : [])
    .slice(0, 300)
    .filter(
      (sample) =>
        sample &&
        safeInteger(sample.mountId) > 0 &&
        safeId(sample.turnId) &&
        safeId(sample.itemId) &&
        safeId(sample.rowKey),
    )
    .map((sample) => ({
      sequence: safeInteger(sample.sequence),
      mountId: safeInteger(sample.mountId),
      turnId: safeId(sample.turnId),
      itemId: safeId(sample.itemId),
      rowKey: safeId(sample.rowKey),
      state: safeState(sample.state),
      ...Object.fromEntries(
        [
          "fullHeight",
          "fullWidth",
          "viewportHeight",
          "rowHeight",
          "scrollTop",
        ].map((key) => [key, safeNumber(sample[key])]),
      ),
      ...Object.fromEntries(
        ["totalEntries", "startIndex", "endIndex", "offscreenCount"].map(
          (key) => [key, safeInteger(sample[key])],
        ),
      ),
    }));
  const mounts = new Map();
  const identities = new Map();
  for (const sample of samples) {
    const dimensions = `${sample.fullHeight}:${sample.fullWidth}`;
    const mount = mounts.get(sample.mountId) ?? {
      changes: 0,
      oscillations: 0,
      last: null,
      previous: null,
    };
    if (mount.last !== null && dimensions !== mount.last) {
      mount.changes += 1;
      if (dimensions === mount.previous) mount.oscillations += 1;
      mount.previous = mount.last;
    }
    mount.last = dimensions;
    mounts.set(sample.mountId, mount);
    const key = `${sample.turnId}\u0000${sample.itemId}\u0000${sample.rowKey}`;
    const ids = identities.get(key) ?? new Set();
    ids.add(sample.mountId);
    identities.set(key, ids);
  }
  const totalCalls = safeInteger(capture?.totalCalls);
  return {
    source: "native-full-rect-call",
    limit: 300,
    samples,
    capturedCount: samples.length,
    totalCalls,
    droppedCount:
      totalCalls === null ? null : Math.max(0, totalCalls - samples.length),
    frozenAtError: capture?.frozenAtError === true,
    observationErrorCount: safeInteger(capture?.observationErrorCount),
    nativeRestored: capture?.nativeRestored === true,
    uniqueMountCount: mounts.size,
    dimensionChangedMountCount: [...mounts.values()].filter(
      (mount) => mount.changes > 0,
    ).length,
    oscillatingMountCount: [...mounts.values()].filter(
      (mount) => mount.oscillations > 0,
    ).length,
    remountedIdentityCount: [...identities.values()].filter(
      (ids) => ids.size > 1,
    ).length,
    completeHistoryClaim: false,
  };
}

export function summarizeLongListCollapseFailure(evidence = {}) {
  const probe = evidence.probe ?? {};
  return {
    phase: ["interactive", "cold-restart"].includes(evidence.phase)
      ? evidence.phase
      : null,
    stage: FAILURE_STAGES.includes(evidence.stage) ? evidence.stage : null,
    probe: Object.fromEntries(
      [
        "sessionId",
        "threadId",
        "turnId",
        "itemId",
        "previousTurnId",
        "nextTurnId",
        "tailTurnId",
      ]
        .map((key) => [key, safeId(probe[key])])
        .concat(
          ["ordinal", "totalTurnCount"].map((key) => [
            key,
            safeInteger(probe[key]),
          ]),
        ),
    ),
    observations: Object.fromEntries(
      FAILURE_OBSERVATIONS.filter((key) => evidence.observations?.[key]).map(
        (key) => [
          key,
          summarizeLongListCollapseGeometry(evidence.observations[key]),
        ],
      ),
    ),
    trace: {
      complete: evidence.trace?.complete === true,
      currentIpcOnly: evidence.trace?.currentIpcOnly === true,
      errorCount: safeInteger(evidence.trace?.errorCount),
      entryCount: safeInteger(evidence.trace?.entryCount),
      inputCount: safeInteger(evidence.trace?.inputCount),
      appendCount: safeInteger(evidence.trace?.appendCount),
      currentRingCount: safeInteger(evidence.trace?.currentRingCount),
      invalidationCount: safeInteger(evidence.trace?.invalidationCount),
      hooksIntact: evidence.trace?.hooksIntact === true,
      cleanupFailed: evidence.trace?.cleanupFailed === true,
      nativeRestored: evidence.trace?.nativeRestored === true,
      cleanupComplete: evidence.trace?.cleanupComplete === true,
    },
    ...(evidence.measurementSampling
      ? {
          measurementSampling: summarizeLongListCollapseMeasurements(
            evidence.measurementSampling,
          ),
        }
      : {}),
    ...(evidence.clipboardCopyEvidence
      ? {
          clipboardCopyEvidence: summarizeClipboardCopyProof(
            evidence.clipboardCopyEvidence,
          ),
        }
      : {}),
  };
}

export function extractLongListCollapseFailure(error) {
  if (!error || !Object.hasOwn(error, "userMessageCollapseEvidence"))
    return null;
  const evidence = error.userMessageCollapseEvidence;
  return evidence && typeof evidence === "object" && !Array.isArray(evidence)
    ? summarizeLongListCollapseFailure(evidence)
    : null;
}

export async function attachLongListCollapseFailure(
  error,
  page,
  probe,
  details,
) {
  if (!(error instanceof Error))
    error = new Error("canonical long-list collapse gate failed");
  let current;
  const existing = extractLongListCollapseFailure(error);
  try {
    current = await readCanonicalCollapseGeometry(page, probe);
  } catch {
    /* 保留已测安全几何。 */
  }
  error.userMessageCollapseEvidence = summarizeLongListCollapseFailure({
    ...details,
    probe,
    measurementSampling:
      details.measurementSampling ?? existing?.measurementSampling,
    clipboardCopyEvidence:
      details.clipboardCopyEvidence ??
      extractClipboardCopyEvidence(error) ??
      existing?.clipboardCopyEvidence,
    observations: { ...details.observations, ...(current ? { current } : {}) },
  });
  return error;
}

function stableShape(snapshot) {
  return JSON.stringify({
    state: snapshot.state,
    viewport: snapshot.viewport,
    fullHeight: snapshot.full?.height,
    scrollTop: snapshot.scroll?.scrollTop,
    rows: snapshot.rows.map(({ key, top, height, offset }) => ({
      key,
      top,
      height,
      offset,
    })),
  });
}

export async function waitForCanonicalCollapseGeometry(
  page,
  probe,
  expectedState,
  options = {},
) {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const started = Date.now();
  let previous = null;
  let unchanged = 0;
  let snapshot;
  while (Date.now() - started < timeoutMs) {
    snapshot = await readCanonicalCollapseGeometry(page, probe);
    const identityReady =
      snapshot.bubbleCount === 1 &&
      snapshot.rootCount === 1 &&
      snapshot.viewport?.height > 0 &&
      snapshot.full?.height > 0;
    const shape = stableShape(snapshot);
    unchanged =
      identityReady && snapshot.state === expectedState && shape === previous
        ? unchanged + 1
        : 0;
    if (unchanged >= 2) return snapshot;
    previous = shape;
    await page.waitForTimeout(50);
  }
  throw new Error(
    `canonical collapse geometry 未稳定: ${JSON.stringify(snapshot)}`,
  );
}

export function assertCanonicalCollapseGeometry(
  snapshot,
  probe,
  expectedState,
) {
  assert(
    snapshot.sessionId === probe.sessionId &&
      snapshot.turnId === probe.turnId &&
      snapshot.itemId === probe.itemId,
    "canonical session/Turn/Item identity 不符",
  );
  assert(
    snapshot.bubbleCount === 1 && snapshot.rootCount === 1 && snapshot.rowKey,
    "用户 bubble 或正文 owner 不唯一",
  );
  assert(
    snapshot.entryKind === "canonical_turn" &&
      snapshot.directKind === "message",
    "未证明 direct canonical 用户正文入口",
  );
  assert(snapshot.state === expectedState, "正文状态不符");
  assert(
    snapshot.toggle.tag === "BUTTON" && snapshot.toggle.controlsViewport,
    "toggle 不是原生 button 或 aria-controls 未绑定 viewport",
  );
  assert(
    snapshot.toggle.expanded ===
      (expectedState === "expanded" ? "true" : "false"),
    "aria-expanded 与实际状态不一致",
  );
  assert(
    snapshot.full.hasStart && snapshot.full.hasTail,
    "全量自然正文丢失首尾 marker",
  );
  assert(
    snapshot.lineHeight > 0 &&
      snapshot.full.height > 20 * snapshot.lineHeight + 1,
    "未实测确认正文超过 20 行阈值",
  );
  assert(
    snapshot.firstLink.count === 1 && snapshot.tailLink.count === 1,
    "首尾链接 identity 不唯一",
  );
  assert(
    snapshot.firstLink.clippedInContentViewport && !snapshot.firstLink.inert,
    "首链接未保留可见/可达",
  );
  if (expectedState === "collapsed") {
    assert(
      snapshot.viewport.height <= 20 * snapshot.lineHeight + 2 &&
        snapshot.viewport.height < snapshot.full.height - 10,
      "collapsed 未实际裁剪布局高度",
    );
    assert(
      !snapshot.tailLink.clippedInContentViewport && snapshot.tailLink.inert,
      "被遮挡尾链接未 inert 或仍可见",
    );
  } else {
    assert(
      snapshot.viewport.height >= snapshot.full.height - 2,
      "expanded 仍裁剪完整正文",
    );
    assert(
      snapshot.tailLink.clippedInContentViewport && !snapshot.tailLink.inert,
      "expanded 尾链接未恢复",
    );
  }
  assertNoTurnRowOverlap(snapshot.rows);
  return snapshot;
}

export function assertNoTurnRowOverlap(rows, tolerance = 2) {
  const sorted = [...rows].sort((a, b) => a.top - b.top);
  for (const row of sorted)
    assert(row.height > 0 && Number.isFinite(row.top), "已挂载 row 缺实际几何");
  for (let index = 1; index < sorted.length; index += 1) {
    assert(
      sorted[index - 1].bottom <= sorted[index].top + tolerance,
      `相邻已挂载 row 重叠: ${sorted[index - 1].key} / ${sorted[index].key}`,
    );
  }
}

export function assertCanonicalRenderedBodyPreserved(before, after) {
  const left = before.full?.textIdentity;
  const right = after.full?.textIdentity;
  assert(
    Number.isInteger(left?.length) &&
      left.length > 0 &&
      typeof left.sha256 === "string" &&
      /^[a-f0-9]{64}$/.test(left.sha256),
    "缺完整 rendered body 摘要",
  );
  assert(
    left.length === right?.length && left.sha256 === right?.sha256,
    "展开/收起改变完整 rendered body",
  );
  return { unchanged: true, length: left.length, sha256: left.sha256 };
}

export function assertSurvivingNeighborAnchor(
  before,
  after,
  probe,
  tolerance = 3,
) {
  const prior = before.firstVisible;
  const next = after.firstVisible;
  assert(
    prior?.turnId === probe.nextTurnId &&
      next?.turnId === probe.nextTurnId &&
      prior.key === next.key,
    "收起未保持 surviving first-visible successor Turn",
  );
  assert(
    prior.kind === "canonical_turn" && next.kind === "canonical_turn",
    "surviving neighbor 未走 canonical Turn owner",
  );
  assert(
    Math.abs(prior.relativeTop - next.relativeTop) <= tolerance,
    "surviving row viewport-relative top 漂移",
  );
  assert(
    before.scroll.distanceToBottom > 64 && after.scroll.distanceToBottom > 64,
    "锚点场景未进入距底超过 64px 的旧历史",
  );
  const targetBefore = before.rows.find((row) => row.turnId === probe.turnId);
  const targetAfter = after.rows.find((row) => row.turnId === probe.turnId);
  assert(
    targetBefore && targetAfter,
    "focused target row 未保留挂载，无法核相邻布局",
  );
  assert(
    targetBefore.height > targetAfter.height + 10,
    "收起没有真实降低 canonical Turn row 高度",
  );
  const gapBefore = prior.offset - targetBefore.offset - targetBefore.height;
  const gapAfter = next.offset - targetAfter.offset - targetAfter.height;
  assert(
    Number.isFinite(gapBefore) &&
      Number.isFinite(gapAfter) &&
      Math.abs(gapBefore - gapAfter) <= tolerance,
    "successor offset 未跟随实测 row 高度",
  );
  assertNoTurnRowOverlap(after.rows);
  return {
    policy: "surviving-successor-turn",
    scrollInput: "electron-mouse-wheel",
    key: prior.key,
    turnId: prior.turnId,
    beforeTop: prior.relativeTop,
    afterTop: next.relativeTop,
    driftPx: next.relativeTop - prior.relativeTop,
    gapBefore,
    gapAfter,
    removedInternalOffsetPreservation: "not asserted",
  };
}
