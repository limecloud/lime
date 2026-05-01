import type { MediaTaskModalityRuntimeContractIndexEntry } from "@/lib/api/mediaTasks";

const LIMECORE_POLICY_META_PREFIX = "LimeCore 策略输入";
const MAX_VISIBLE_REFS = 3;

function normalizeRefs(refs?: string[] | null): string[] {
  const normalized = new Set<string>();
  (refs || []).forEach((ref) => {
    const trimmed = ref.trim();
    if (trimmed) {
      normalized.add(trimmed);
    }
  });
  return Array.from(normalized);
}

function formatRefs(refs: string[]): string {
  const visibleRefs = refs.slice(0, MAX_VISIBLE_REFS);
  const extraCount = refs.length - visibleRefs.length;
  return extraCount > 0
    ? `${visibleRefs.join(" / ")} +${extraCount}`
    : visibleRefs.join(" / ");
}

function buildPolicyEvaluationMetaItem(
  entry: MediaTaskModalityRuntimeContractIndexEntry,
): string | null {
  const status = entry.limecore_policy_evaluation_status?.trim().toLowerCase();
  const decision = entry.limecore_policy_evaluation_decision
    ?.trim()
    .toLowerCase();

  if (!status && !decision) {
    return null;
  }

  const pendingRefs = normalizeRefs(
    entry.limecore_policy_evaluation_pending_refs?.length
      ? entry.limecore_policy_evaluation_pending_refs
      : entry.limecore_policy_pending_hit_refs?.length
        ? entry.limecore_policy_pending_hit_refs
        : entry.limecore_policy_missing_inputs,
  );
  if (status === "input_gap") {
    return pendingRefs.length > 0
      ? `${LIMECORE_POLICY_META_PREFIX}待命中: ${pendingRefs.length}`
      : `${LIMECORE_POLICY_META_PREFIX}待命中`;
  }

  const blockingRefs = normalizeRefs(
    entry.limecore_policy_evaluation_blocking_refs,
  );
  if (decision === "deny" || blockingRefs.length > 0) {
    return blockingRefs.length > 0
      ? `${LIMECORE_POLICY_META_PREFIX}阻断: ${formatRefs(blockingRefs)}`
      : `${LIMECORE_POLICY_META_PREFIX}阻断`;
  }

  const askRefs = normalizeRefs(entry.limecore_policy_evaluation_ask_refs);
  if (decision === "ask" || askRefs.length > 0) {
    return askRefs.length > 0
      ? `${LIMECORE_POLICY_META_PREFIX}需确认: ${formatRefs(askRefs)}`
      : `${LIMECORE_POLICY_META_PREFIX}需确认`;
  }

  if (status === "evaluated" && decision === "allow") {
    return `${LIMECORE_POLICY_META_PREFIX}已评估: allow`;
  }

  return null;
}

export function mergeMediaTaskPolicyEvaluationMetaItems(
  existingItems: string[] | undefined,
  entry: MediaTaskModalityRuntimeContractIndexEntry,
): string[] | undefined {
  const policyItem = buildPolicyEvaluationMetaItem(entry);
  if (!policyItem) {
    return existingItems;
  }

  const nextItems = (existingItems || [])
    .map((item) => item.trim())
    .filter(
      (item, index, items) =>
        item &&
        !item.startsWith(LIMECORE_POLICY_META_PREFIX) &&
        items.indexOf(item) === index,
    );
  nextItems.push(policyItem);
  return nextItems;
}

export function areTaskMetaItemsEqual(
  leftItems: string[] | undefined,
  rightItems: string[] | undefined,
): boolean {
  const left = leftItems || [];
  const right = rightItems || [];
  if (left.length !== right.length) {
    return false;
  }
  return left.every((item, index) => item === right[index]);
}
