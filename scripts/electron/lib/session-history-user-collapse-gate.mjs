import { summarizeLongListUserMessageProbe } from "./session-history-user-collapse-fixture.mjs";
import { summarizeClipboardCopyProof } from "../../lib/chat-fixture/user-message-collapse-clipboard-observation.mjs";
import {
  COLLAPSE_SELECTORS,
  assert,
  canonicalBubbleSelector,
  readCanonicalCollapseGeometry,
  waitForCanonicalCollapseGeometry,
  assertCanonicalCollapseGeometry,
  assertCanonicalRenderedBodyPreserved,
  assertSurvivingNeighborAnchor,
  assertLongListCollapseLoadedTailRange,
  assertLongListCollapseMountedNeighbors,
  attachLongListCollapseFailure,
} from "./session-history-user-collapse-geometry.mjs";

function toggleFor(page, probe) {
  return page
    .locator(canonicalBubbleSelector(probe))
    .locator(COLLAPSE_SELECTORS.toggle);
}

// focus 仅设立键盘起点；可达性证据必须来自随后真实 Tab/Shift+Tab。
async function focusToggleWithoutScroll(page, probe) {
  await toggleFor(page, probe).evaluate((node) =>
    node.focus({ preventScroll: true }),
  );
}

async function wheelToTarget(page, probe, options) {
  const started = Date.now();
  const container = page.locator(COLLAPSE_SELECTORS.scroll);
  await container.hover();
  while (Date.now() - started < options.timeoutMs) {
    const snapshot = await readCanonicalCollapseGeometry(page, probe);
    assert(
      snapshot.sessionId === probe.sessionId && snapshot.scroll,
      "wheel 导航不在目标 session",
    );
    const row = snapshot.rows.find((entry) => entry.turnId === probe.turnId);
    if (row && snapshot.rootCount === 1) {
      const delta = row.top - snapshot.scroll.top - 32;
      if (Math.abs(delta) > 3) await page.mouse.wheel(0, delta);
      await page.waitForTimeout(100);
      return;
    }
    // ordinal 选在已载入尾页内；不合成 scrollTop、跳转 key 或历史请求。
    await page.mouse.wheel(
      0,
      -Math.max(160, snapshot.scroll.clientHeight * 0.7),
    );
    await page.waitForTimeout(100);
  }
  throw new Error(
    "真实 wheel 未找到非尾部 canonical 长正文；检查已加载 page 与 probe ordinal",
  );
}

async function verifyCollapsedKeyboardReachability(page, probe) {
  await focusToggleWithoutScroll(page, probe);
  const backwards = [];
  let reachedFirst = false;
  for (let index = 0; index < 16; index += 1) {
    await page.keyboard.press("Shift+Tab");
    const { active } = await readCanonicalCollapseGeometry(page, probe);
    backwards.push(active);
    assert(!active.isTailLink, "collapsed 尾链接可经真实 Shift+Tab 聚焦");
    if (active.isFirstLink) {
      reachedFirst = true;
      break;
    }
    if (!active.insideRoot) break;
  }
  assert(reachedFirst, "可见首链接不能由真实 Shift+Tab 到达");
  const forwards = [];
  let reachedToggle = false;
  let exitedRoot = false;
  for (let index = 0; index < 16; index += 1) {
    await page.keyboard.press("Tab");
    const { active } = await readCanonicalCollapseGeometry(page, probe);
    forwards.push(active);
    assert(!active.isTailLink, "collapsed 尾链接可经真实 Tab 聚焦");
    reachedToggle ||= active.isToggle;
    if (!active.insideRoot) {
      exitedRoot = true;
      break;
    }
  }
  assert(
    reachedToggle && exitedRoot,
    "collapsed 键盘顺序未经过 toggle 并退出正文",
  );
  return {
    setup: "focus-toggle-preventScroll",
    input: "electron-keyboard-Tab-ShiftTab",
    reachedFirst,
    reachedToggle,
    exitedRoot,
    backwards,
    forwards,
  };
}

async function verifyExpandedTailReachability(page, probe) {
  await focusToggleWithoutScroll(page, probe);
  const states = [];
  let reachedTail = false;
  for (let index = 0; index < 16; index += 1) {
    await page.keyboard.press("Shift+Tab");
    const { active } = await readCanonicalCollapseGeometry(page, probe);
    states.push(active);
    if (active.isTailLink) {
      reachedTail = true;
      break;
    }
    if (!active.insideRoot) break;
  }
  assert(reachedTail, "expanded 尾链接未恢复真实键盘可达性");
  let reachedToggle = false;
  for (let index = 0; index < 16; index += 1) {
    await page.keyboard.press("Tab");
    const { active } = await readCanonicalCollapseGeometry(page, probe);
    if (active.isToggle) {
      reachedToggle = true;
      break;
    }
    if (!active.insideRoot) break;
  }
  assert(reachedToggle, "展开后不能用真实 Tab 回到 toggle");
  return {
    input: "electron-keyboard-Tab-ShiftTab",
    reachedTail,
    reachedToggle,
    states,
  };
}

async function wheelToSurvivingSuccessor(page, probe, options) {
  await page.locator(COLLAPSE_SELECTORS.scroll).hover();
  const snapshot = await readCanonicalCollapseGeometry(page, probe);
  const target = snapshot.rows.find((row) => row.turnId === probe.turnId);
  assert(
    target && snapshot.active.isToggle,
    "必须保留 toggle 焦点以 pin 原 canonical row",
  );
  // 先真实 wheel 到 row 底部，再把 successor 顶端移到 viewport 顶端上方 8px。
  await page.mouse.wheel(0, target.bottom - snapshot.scroll.top + 8);
  const started = Date.now();
  while (Date.now() - started < options.timeoutMs) {
    const current = await readCanonicalCollapseGeometry(page, probe);
    const successor = current.rows.find(
      (row) => row.turnId === probe.nextTurnId,
    );
    if (successor) {
      const delta = successor.top - current.scroll.top + 8;
      if (Math.abs(delta) > 2) await page.mouse.wheel(0, delta);
      const settled = await waitForCanonicalCollapseGeometry(
        page,
        probe,
        "expanded",
        options,
      );
      if (
        settled.firstVisible?.turnId === probe.nextTurnId &&
        settled.active.isToggle &&
        settled.scroll.distanceToBottom > 64
      )
        return settled;
    }
    await page.waitForTimeout(100);
  }
  throw new Error("真实 wheel 未建立 surviving successor first-visible anchor");
}

async function sharedExactCopy(page, probe, state, hooks) {
  assert(
    typeof hooks.verifyExactCopy === "function",
    "必须接入共享真实 Electron clipboard oracle",
  );
  const proof = await hooks.verifyExactCopy({
    page,
    probe,
    state,
    bubbleSelector: canonicalBubbleSelector(probe),
  });
  if (
    !(
      proof?.match === true &&
      proof.sha256 === probe.sha256 &&
      proof.textUtf16Length === probe.textUtf16Length &&
      proof.readSource === "electron-main-clipboard"
    )
  ) {
    const error = new Error("copy 未证明真实剪贴板完整 Markdown/Unicode 原文");
    Object.defineProperty(error, "clipboardCopyEvidence", {
      value: summarizeClipboardCopyProof(proof?.clipboardCopyEvidence),
      configurable: true,
    });
    throw error;
  }
  // 只保留显式允许的字段，避免共享 callback 的额外全文落盘。
  return {
    match: true,
    sha256: proof.sha256,
    textUtf16Length: proof.textUtf16Length,
    readSource: proof.readSource,
    clipboardCopyEvidence: summarizeClipboardCopyProof(
      proof.clipboardCopyEvidence,
    ),
  };
}

async function beginReadOnly(hooks, probe) {
  assert(
    typeof hooks.beginReadOnly === "function" &&
      typeof hooks.finishReadOnly === "function",
    "必须接共享 canonical readback/完整 trace 不变 oracle",
  );
  return hooks.beginReadOnly(probe);
}

async function finishReadOnly(hooks, probe, checkpoint) {
  const proof = await hooks.finishReadOnly({ probe, checkpoint });
  assert(
    proof?.traceComplete === true &&
      proof.canonicalUnchanged === true &&
      proof.forbiddenMutationCount === 0 &&
      proof.itemId === probe.itemId &&
      proof.turnId === probe.turnId,
    "缺完整 trace 或 canonical 业务不变证据",
  );
  return {
    traceComplete: true,
    canonicalUnchanged: true,
    forbiddenMutationCount: 0,
    itemId: proof.itemId,
    turnId: proof.turnId,
    canonical: proof.canonical,
    inputBoundary: proof.inputBoundary,
    traceProvenance: proof.traceProvenance,
  };
}

export async function runCanonicalLongListCollapseGate(
  page,
  probe,
  hooks,
  options = {},
) {
  options = { timeoutMs: 30_000, ...options };
  const observations = {};
  let stage = "initial-page";
  try {
    const checkpoint = await beginReadOnly(hooks, probe);
    observations.initial = await readCanonicalCollapseGeometry(page, probe);
    const loadedTail = assertLongListCollapseLoadedTailRange(
      observations.initial,
      probe,
    );
    stage = "wheel-target";
    await wheelToTarget(page, probe, options);
    stage = "collapsed";
    const collapsed = assertCanonicalCollapseGeometry(
      await waitForCanonicalCollapseGeometry(page, probe, "collapsed", options),
      probe,
      "collapsed",
    );
    observations.collapsed = collapsed;
    const mountedNeighbors = assertLongListCollapseMountedNeighbors(
      collapsed,
      probe,
    );
    stage = "collapsed-copy";
    const collapsedCopy = await sharedExactCopy(
      page,
      probe,
      "collapsed",
      hooks,
    );
    stage = "collapsed-keyboard";
    const collapsedKeyboard = await verifyCollapsedKeyboardReachability(
      page,
      probe,
    );
    stage = "expanded";
    await toggleFor(page, probe).click();
    const expanded = assertCanonicalCollapseGeometry(
      await waitForCanonicalCollapseGeometry(page, probe, "expanded", options),
      probe,
      "expanded",
    );
    observations.expanded = expanded;
    const renderedBody = assertCanonicalRenderedBodyPreserved(
      collapsed,
      expanded,
    );
    stage = "expanded-copy";
    const expandedCopy = await sharedExactCopy(page, probe, "expanded", hooks);
    stage = "expanded-keyboard";
    const expandedKeyboard = await verifyExpandedTailReachability(page, probe);
    stage = "successor-anchor";
    const before = await wheelToSurvivingSuccessor(page, probe, options);
    observations.beforeAnchor = before;
    assertCanonicalCollapseGeometry(before, probe, "expanded");
    stage = "collapse-anchor";
    // 不点击 offscreen toggle，避免 Playwright 自动滚回改变真实阅读锚点。
    await page.keyboard.press("Enter");
    const after = assertCanonicalCollapseGeometry(
      await waitForCanonicalCollapseGeometry(page, probe, "collapsed", options),
      probe,
      "collapsed",
    );
    observations.afterAnchor = after;
    const anchor = assertSurvivingNeighborAnchor(before, after, probe);
    assertCanonicalRenderedBodyPreserved(expanded, after);
    assert(after.active.isToggle, "keyboard collapse 未保留 toggle 焦点");
    stage = "restart-precondition";
    // 留下 expanded，保证 cold restart 的默认收起不是重验已有 collapsed 状态。
    await page.keyboard.press("Space");
    const restartPrecondition = assertCanonicalCollapseGeometry(
      await waitForCanonicalCollapseGeometry(page, probe, "expanded", options),
      probe,
      "expanded",
    );
    stage = "business-boundary";
    const business = await finishReadOnly(hooks, probe, checkpoint);
    return {
      ok: true,
      probe: summarizeLongListUserMessageProbe(probe),
      loadedTail,
      mountedNeighbors,
      collapsed,
      expanded,
      clipboard: { collapsed: collapsedCopy, expanded: expandedCopy },
      keyboard: {
        collapsed: collapsedKeyboard,
        expanded: expandedKeyboard,
        collapseInput: "electron-keyboard-Enter",
        reopenInput: "electron-keyboard-Space",
      },
      anchor,
      renderedBody,
      restartPrecondition: {
        expanded: restartPrecondition.state === "expanded",
        itemId: restartPrecondition.itemId,
        turnId: restartPrecondition.turnId,
      },
      business,
      limitation:
        "不声称收起后精确保留已消失的长 row 内部原文 offset；仅验证 surviving successor Turn 锚点。",
    };
  } catch (error) {
    throw await attachLongListCollapseFailure(error, page, probe, {
      phase: "interactive",
      stage,
      observations,
    });
  }
}

export async function runCanonicalLongListCollapseColdRestartGate(
  page,
  probe,
  hooks,
  restart,
  options = {},
) {
  options = { timeoutMs: 30_000, ...options };
  const observations = {};
  let stage = "initial-page";
  try {
    assertLongListCollapseColdRestartIdentity(restart, probe);
    const checkpoint = await beginReadOnly(hooks, probe);
    observations.initial = await readCanonicalCollapseGeometry(page, probe);
    const loadedTail = assertLongListCollapseLoadedTailRange(
      observations.initial,
      probe,
    );
    stage = "wheel-target";
    await wheelToTarget(page, probe, options);
    stage = "collapsed";
    const collapsed = assertCanonicalCollapseGeometry(
      await waitForCanonicalCollapseGeometry(page, probe, "collapsed", options),
      probe,
      "collapsed",
    );
    observations.collapsed = collapsed;
    const mountedNeighbors = assertLongListCollapseMountedNeighbors(
      collapsed,
      probe,
    );
    stage = "collapsed-copy";
    const clipboard = await sharedExactCopy(
      page,
      probe,
      "cold-collapsed",
      hooks,
    );
    stage = "collapsed-keyboard";
    const keyboard = await verifyCollapsedKeyboardReachability(page, probe);
    stage = "business-boundary";
    const business = await finishReadOnly(hooks, probe, checkpoint);
    return {
      ok: true,
      probe: summarizeLongListUserMessageProbe(probe),
      loadedTail,
      mountedNeighbors,
      restart: {
        oldPid: restart.oldPid,
        newPid: restart.newPid,
        oldProcessExited: true,
        navigation: "sidebar",
        priorExpanded: true,
        defaultCollapsed: true,
      },
      collapsed,
      clipboard,
      keyboard,
      business,
    };
  } catch (error) {
    throw await attachLongListCollapseFailure(error, page, probe, {
      phase: "cold-restart",
      stage,
      observations,
    });
  }
}

export function assertLongListCollapseColdRestartIdentity(restart, probe) {
  assert(
    restart?.previous?.restartPrecondition?.expanded === true,
    "cold restart 前必须实际留下 expanded",
  );
  assert(
    restart.previous.restartPrecondition.itemId === probe.itemId &&
      restart.previous.restartPrecondition.turnId === probe.turnId,
    "重启前后 Item/Turn 不一致",
  );
  assert(
    Number.isInteger(restart.oldPid) &&
      Number.isInteger(restart.newPid) &&
      restart.oldPid !== restart.newPid &&
      restart.oldProcessExited === true &&
      restart.navigation === "sidebar",
    "未证明真正 Electron process close/relaunch 与持久化侧栏入口",
  );
}
