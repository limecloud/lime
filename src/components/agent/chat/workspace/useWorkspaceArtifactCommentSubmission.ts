import { useCallback, useLayoutEffect, useRef } from "react";
import { useAtomValue } from "jotai";
import { artifactAnnotationDraftsAtom } from "@/components/artifact/annotations/ArtifactAnnotationDraftStore";
import { workbookControllersAtom } from "@/components/artifact/workbook/WorkbookController";
import { presentationControllersAtom } from "@/components/artifact/presentation/PresentationController";
import type { ArtifactCommentSubmission } from "@/components/artifact/ArtifactCommentSubmissionContext";
import {
  buildArtifactAnnotationRequest,
  buildArtifactAnnotationBatchRequest,
} from "@/components/artifact/annotations/artifactAnnotation";
import { readFileBytes } from "@/lib/api/fileBrowser";
import { hashFileBytes } from "@/lib/artifact/fileRevision";
import { createComposerSubmissionSettlement } from "../components/composerSubmissionSettlement";
import {
  isRuntimeSubmissionAccepted,
  normalizeRuntimeSubmissionResult,
  type RuntimeSubmissionAcceptance,
} from "../hooks/agentSendResult";
import type { InputbarSendHandler } from "../components/Inputbar/inputbarSendPayload";
import { fileTabId } from "./right-surface/openWorkspaceFile";

interface Params {
  sessionId?: string | null;
  threadId?: string | null;
  originatingTurnId?: string | null;
  projectId?: string | null;
  isSending: boolean;
  activeSessionIdRef: { readonly current: string | null | undefined };
  getNavigationEpoch: () => number;
  send: InputbarSendHandler;
  openFile?: (path: string, isCurrent: () => boolean) => Promise<boolean>;
}

const scopeKey = (params: Params) =>
  JSON.stringify([
    params.sessionId,
    params.threadId,
    params.getNavigationEpoch(),
  ]);

/** 批注仅编排文件校验与既有发送接受合同，不拥有第二套 runtime。 */
export function useWorkspaceArtifactCommentSubmission(
  params: Params,
): ArtifactCommentSubmission | null {
  const drafts = useAtomValue(artifactAnnotationDraftsAtom);
  const workbooks = useAtomValue(workbookControllersAtom);
  const presentations = useAtomValue(presentationControllersAtom);
  const latest = useRef(params);
  const mounted = useRef(false);
  const openRequest = useRef(0);
  useLayoutEffect(() => {
    latest.current = params;
  });
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const submit = useCallback<ArtifactCommentSubmission["submit"]>(
    async (request) => {
      const captured = latest.current;
      const isCurrent = () =>
        mounted.current &&
        request.isCurrent() &&
        request.scopeKey === scopeKey(latest.current) &&
        latest.current.activeSessionIdRef.current === captured.sessionId;
      if (!captured.sessionId || !captured.threadId || !isCurrent())
        return "canceled";
      const matchesIdentity = (receipt: RuntimeSubmissionAcceptance) =>
        receipt.sessionId === captured.sessionId &&
        receipt.threadId === captured.threadId;
      const target = captured.isSending ? "queue" : "start";
      const comments =
        "comments" in request ? request.comments : [request.comment];
      const text = comments.map((comment) => comment.body).join("\n\n");
      const settlement = createComposerSubmissionSettlement({
        controller: request.controller,
        target,
        scope: { projectId: captured.projectId, sessionId: captured.sessionId },
        // This Controller belongs to the captured draft, even after its view closes.
        // commit still checks its exact revision, so newer edits remain intact.
        canApplyUi: () => true,
        onCommitted: () => undefined,
      });
      if (
        settlement.receipt?.kind !== "accepted" ||
        settlement.receipt.draft.text !== text
      )
        return "rejected";
      try {
        const annotation =
          "comments" in request
            ? buildArtifactAnnotationBatchRequest(comments)
            : buildArtifactAnnotationRequest(request.comment);
        const metadataKey =
          "artifactAnnotationBatch" in annotation.requestMetadata
            ? "artifactAnnotationBatch"
            : "artifactAnnotation";
        const metadata =
          "artifactAnnotationBatch" in annotation.requestMetadata
            ? annotation.requestMetadata.artifactAnnotationBatch
            : annotation.requestMetadata.artifactAnnotation;
        const fileEditor =
          comments[0].format === "workbook"
            ? workbooks.get(comments[0].path)
            : comments[0].format === "presentation"
              ? presentations.get(comments[0].path)
              : undefined;
        if (fileEditor && !(await fileEditor.flushPublicFile()))
          return "rejected";
        if (!isCurrent()) return "canceled";
        const revision = await hashFileBytes(
          await readFileBytes(comments[0].path),
        );
        if (!isCurrent()) return "canceled";
        if (revision !== comments[0].sourceSha256) return "file-changed";
        const receipt = settlement.receipt;
        const returned = await captured.send({
          images: [...receipt.draft.attachments],
          textOverride: annotation.prompt,
          sendOptions: {
            targetSessionId: captured.sessionId,
            skipSessionRestore: true,
            skipThemeSkillPrefix: true,
            skipSceneCommandRouting: true,
            skipWorkspaceCommandRouting: true,
            composerDraft: receipt.draft,
            composerSubmission: receipt.submission,
            composerTarget: target,
            composerRestoreToken: settlement.composerRestoreToken,
            observer: {
              onRuntimeAccepted: (receipt) => {
                if (matchesIdentity(receipt))
                  settlement.onRuntimeAccepted(receipt);
              },
            },
            displayContent: annotation.displayContent,
            requestMetadata: {
              ...annotation.requestMetadata,
              [metadataKey]: {
                ...metadata,
                sessionId: captured.sessionId,
                threadId: captured.threadId,
                originatingTurnId: captured.originatingTurnId ?? null,
              },
            },
          },
        });
        const normalized = normalizeRuntimeSubmissionResult(returned);
        const result = settlement.finish(
          isRuntimeSubmissionAccepted(normalized) &&
            !matchesIdentity(normalized.receipt)
            ? { kind: "rejected" }
            : normalized,
        );
        return isRuntimeSubmissionAccepted(result) ? "accepted" : "rejected";
      } catch (error) {
        return isRuntimeSubmissionAccepted(settlement.reject(error))
          ? "accepted"
          : "rejected";
      }
    },
    [workbooks, presentations],
  );
  return params.sessionId && params.threadId
    ? {
        scopeKey: scopeKey(params),
        draftScopeKey: JSON.stringify([params.sessionId, params.threadId]),
        drafts,
        openComment: async (id) => {
          const current = latest.current;
          const draft = drafts
            .getSnapshot()
            .find((entry) => entry.comment.id === id);
          if (
            !mounted.current ||
            !current.sessionId ||
            !current.threadId ||
            !current.openFile ||
            draft?.scopeKey !==
              JSON.stringify([current.sessionId, current.threadId])
          )
            return;
          const request = ++openRequest.current;
          const capturedScope = scopeKey(current);
          const isCurrent = () =>
            mounted.current &&
            request === openRequest.current &&
            capturedScope === scopeKey(latest.current) &&
            latest.current.activeSessionIdRef.current === current.sessionId &&
            drafts.getSnapshot().some((entry) => entry === draft);
          try {
            const opened = await current.openFile(
              draft.comment.path,
              isCurrent,
            );
            if (opened && isCurrent())
              drafts.focus(id, fileTabId(draft.comment.path));
          } catch {
            // File opening owns its visible error; the existing draft stays intact.
          }
        },
        submit,
      }
    : null;
}
