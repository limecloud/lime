import type { CreationMode } from "@/lib/workspace/workbenchContract";
import type { A2UIFormData } from "@/lib/workspace/a2ui";
import {
  buildCreateConfirmationMetadata,
  parseCreateConfirmationIntent,
  resolveConfirmedInitialPrompt,
  resolveCreateContentTitle,
  shouldCreateContentByIntent,
  type CreateConfirmationSource,
  type PendingCreateConfirmation,
} from "@/components/workspace/utils/createConfirmationPolicy";

export interface UpsertPendingCreateConfirmationOptions {
  source: CreateConfirmationSource;
  defaultCreationMode: CreationMode;
  initialUserPrompt?: string;
  creationMode?: CreationMode;
  preferredContentId?: string;
  fallbackContentTitle?: string;
}

export function upsertPendingCreateConfirmationMap(
  previous: Record<string, PendingCreateConfirmation>,
  projectId: string,
  options: UpsertPendingCreateConfirmationOptions,
): Record<string, PendingCreateConfirmation> {
  if (!projectId) {
    return previous;
  }

  const normalizedPrompt = options.initialUserPrompt?.trim() || "";
  const normalizedFallbackTitle = options.fallbackContentTitle?.trim() || "";

  return {
    ...previous,
    [projectId]: {
      projectId,
      source: options.source,
      creationMode: options.creationMode ?? options.defaultCreationMode,
      initialUserPrompt: normalizedPrompt || undefined,
      preferredContentId: options.preferredContentId,
      fallbackContentTitle: normalizedFallbackTitle || undefined,
      createdAt: Date.now(),
    },
  };
}

export function consumePendingCreateConfirmationMap(
  previous: Record<string, PendingCreateConfirmation>,
  projectId: string,
): Record<string, PendingCreateConfirmation> {
  if (!projectId || !previous[projectId]) {
    return previous;
  }
  const next = { ...previous };
  delete next[projectId];
  return next;
}

export interface WorkspaceContentCandidate {
  id: string;
  updated_at: number;
}

export function resolveContinuationTargetContent(
  contents: WorkspaceContentCandidate[],
  preferredContentId?: string,
): WorkspaceContentCandidate | null {
  if (!contents.length) {
    return null;
  }
  const sorted = [...contents].sort((a, b) => b.updated_at - a.updated_at);
  if (!preferredContentId) {
    return sorted[0] || null;
  }
  return (
    sorted.find((item) => item.id === preferredContentId) ||
    sorted[0] ||
    null
  );
}

export type CreateConfirmationDecision =
  | {
      type: "continue_history";
      initialUserPrompt: string;
      creationMode: CreationMode;
      preferredContentId?: string;
    }
  | {
      type: "create_new";
      initialUserPrompt: string;
      creationMode: CreationMode;
      title: string;
      metadata: Record<string, unknown>;
    };

interface ResolveCreateConfirmationDecisionParams {
  pending: PendingCreateConfirmation;
  formData: A2UIFormData;
  defaultContentTitle: string;
}

interface ResolveCreateConfirmationDecisionSuccess {
  ok: true;
  decision: CreateConfirmationDecision;
}

interface ResolveCreateConfirmationDecisionFailure {
  ok: false;
  message: string;
}

export type ResolveCreateConfirmationDecisionResult =
  | ResolveCreateConfirmationDecisionSuccess
  | ResolveCreateConfirmationDecisionFailure;

export function resolveCreateConfirmationDecision({
  pending,
  formData,
  defaultContentTitle,
}: ResolveCreateConfirmationDecisionParams): ResolveCreateConfirmationDecisionResult {
  const parsedIntent = parseCreateConfirmationIntent(formData);
  if (!parsedIntent.ok) {
    return {
      ok: false,
      message: parsedIntent.message,
    };
  }

  const intent = parsedIntent.intent;
  const initialUserPrompt = resolveConfirmedInitialPrompt(pending, intent);

  if (!shouldCreateContentByIntent(intent)) {
    return {
      ok: true,
      decision: {
        type: "continue_history",
        initialUserPrompt,
        creationMode: pending.creationMode,
        preferredContentId: pending.preferredContentId,
      },
    };
  }

  return {
    ok: true,
    decision: {
      type: "create_new",
      initialUserPrompt,
      creationMode: pending.creationMode,
      title: resolveCreateContentTitle(pending, defaultContentTitle, intent),
      metadata: buildCreateConfirmationMetadata(pending, intent),
    },
  };
}
