/**
 * 待接入聊天输入框的应用快照。
 *
 * 设置页只负责写入，聊天 composer 挂载时一次性消费；消费失败会放回队列，
 * 避免读取失败或附件上限把用户的快照静默丢掉。
 */
export interface PendingAppSnapshot {
  dataUrl: string;
  windowName: string;
}

let pending: PendingAppSnapshot | null = null;

function normalize(snapshot: PendingAppSnapshot): PendingAppSnapshot | null {
  const dataUrl =
    typeof snapshot?.dataUrl === "string" ? snapshot.dataUrl.trim() : "";
  if (!dataUrl) return null;
  return {
    dataUrl,
    windowName:
      typeof snapshot.windowName === "string" ? snapshot.windowName.trim() : "",
  };
}

export function setPendingAppSnapshot(snapshot: PendingAppSnapshot): boolean {
  pending = normalize(snapshot);
  return pending !== null;
}

export function getPendingAppSnapshot(): PendingAppSnapshot | null {
  return pending;
}

/** 一次性取走快照；重复调用返回 null。 */
export function consumePendingAppSnapshot(): PendingAppSnapshot | null {
  const snapshot = pending;
  pending = null;
  return snapshot;
}

/** 消费失败时放回队列；已有更新的快照时不覆盖。 */
export function restorePendingAppSnapshot(
  snapshot: PendingAppSnapshot,
): boolean {
  if (pending) return false;
  const normalized = normalize(snapshot);
  if (!normalized) return false;
  pending = normalized;
  return true;
}

export function resetPendingAppSnapshotForTest(): void {
  pending = null;
}
