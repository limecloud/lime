import {
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ArtifactNavigationContext } from "./ArtifactNavigationContext";
import { useArtifactCommentSubmission } from "../ArtifactCommentSubmissionContext";
import { submitArtifactAnnotationBatch } from "./artifactAnnotationSubmission";
import type { ArtifactAnnotationDraft } from "./ArtifactAnnotationDraftStore";
import type {
  ArtifactAnnotationComment,
  ArtifactAnnotationDraftComment,
} from "./artifactAnnotation";

const noDrafts: readonly ArtifactAnnotationDraft[] = [];
const emptySnapshot = () => noDrafts;
const emptySubscribe = () => () => undefined;
const noFocus = () => null;

/** 定位由格式适配器提供；草稿、编辑卡与会话提交共用同一 owner。 */
export function useArtifactAnnotations({
  path,
  format,
  sourceSha256,
  reload,
  navigateToComment,
  previewRequestKey,
}: {
  path: string;
  format: ArtifactAnnotationComment["format"];
  sourceSha256?: string;
  reload: () => void;
  navigateToComment?: (comment: ArtifactAnnotationDraftComment) => void;
  previewRequestKey?: string;
}) {
  const submission = useArtifactCommentSubmission();
  const navigation = useContext(ArtifactNavigationContext);
  const previewId = navigation?.tabId ?? previewRequestKey;
  const active = navigation?.active ?? true;
  const drafts = useSyncExternalStore(
    submission?.drafts.subscribe ?? emptySubscribe,
    submission?.drafts.getSnapshot ?? emptySnapshot,
  );
  const fileDrafts = drafts.filter(
    (draft) =>
      draft.scopeKey === submission?.draftScopeKey &&
      draft.comment.path === path &&
      draft.comment.format === format,
  );
  const [commentMode, setCommentMode] = useState(false);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [showDrafts, setShowDrafts] = useState(false);
  const reanchor = useRef<{ id: string; identity: string } | null>(null);
  const identity = JSON.stringify([submission?.draftScopeKey, path, format]);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [loadedIdentity, setLoadedIdentity] = useState(identity);
  useEffect(() => {
    setLoadedIdentity(identity);
    setActiveDraftId(null);
    setShowDrafts(false);
    setCommentMode(false);
    reanchor.current = null;
  }, [identity]);
  const focusRequest = useSyncExternalStore(
    submission?.drafts.subscribe ?? emptySubscribe,
    submission?.drafts.getFocusSnapshot ?? noFocus,
  );
  const requestedDraft = fileDrafts.find(
    (draft) => draft.comment.id === focusRequest?.id,
  );
  const navigate = useRef(navigateToComment);
  navigate.current = navigateToComment;
  const draftStore = submission?.drafts;
  const requestedComment = requestedDraft?.comment;
  const requestedId = requestedDraft?.comment.id;
  useEffect(() => {
    if (
      !focusRequest ||
      !active ||
      !sourceSha256 ||
      !requestedId ||
      !requestedComment ||
      (focusRequest.previewRequestKey !== undefined &&
        focusRequest.previewRequestKey !== previewId) ||
      loadedIdentity !== identity
    )
      return;
    setShowDrafts(false);
    setActiveDraftId(requestedId);
    navigate.current?.(requestedComment);
    draftStore?.consumeFocus(focusRequest.request);
  }, [
    focusRequest,
    requestedId,
    requestedComment,
    identity,
    loadedIdentity,
    sourceSha256,
    previewId,
    active,
    draftStore,
  ]);
  const activeDraft =
    loadedIdentity === identity
      ? fileDrafts.find((draft) => draft.comment.id === activeDraftId)
      : undefined;
  const focus = (id: string) => {
    const draft =
      fileDrafts.find((entry) => entry.comment.id === id) ??
      submission?.drafts
        .getSnapshot()
        .find(
          (entry) =>
            entry.comment.id === id &&
            entry.scopeKey === submission.draftScopeKey &&
            entry.comment.path === path &&
            entry.comment.format === format,
        );
    if (!draft || loadedIdentity !== identity) return;
    setShowDrafts(false);
    setActiveDraftId(id);
    navigate.current?.(draft.comment);
  };
  const annotate = (comment: ArtifactAnnotationDraftComment) => {
    if (
      !submission ||
      !sourceSha256 ||
      loadedIdentity !== identity ||
      comment.path !== path ||
      comment.format !== format ||
      comment.sourceSha256 !== sourceSha256
    )
      return;
    const pending = reanchor.current;
    reanchor.current = null;
    if (
      pending?.identity === identity &&
      submission.drafts.reanchor(pending.id, { ...comment, id: pending.id })
    ) {
      focus(pending.id);
      return;
    }
    focus(submission.drafts.create(submission.draftScopeKey, comment));
  };
  const batchDrafts = fileDrafts.filter((draft) =>
    draft.controller.getDocument().text.trim(),
  );
  const batchPending = fileDrafts.some((draft) => draft.pending);
  const sendBatch = async () => {
    if (
      !submission ||
      loadedIdentity !== identity ||
      batchPending ||
      !batchDrafts.length
    )
      return;
    await submitArtifactAnnotationBatch({
      submission,
      drafts: batchDrafts,
      isCurrent: () => mounted.current && currentIdentity.current === identity,
    });
  };
  return {
    submission,
    fileDrafts,
    activeDraft,
    commentMode: loadedIdentity === identity && commentMode,
    showDrafts: loadedIdentity === identity && showDrafts,
    annotate,
    batchDrafts,
    batchPending,
    sendBatch,
    cancelBatch: () => {
      if (batchPending) return;
      for (const draft of fileDrafts)
        submission?.drafts.remove(draft.comment.id);
      setActiveDraftId(null);
      setShowDrafts(false);
    },
    focus,
    toggleMode: () => setCommentMode((value) => !value),
    toggleDrafts: () => {
      setActiveDraftId(null);
      setShowDrafts((value) => !value);
    },
    close: () => setActiveDraftId(null),
    relocate: () => {
      if (!activeDraft || currentIdentity.current !== identity) return;
      reanchor.current = { id: activeDraft.comment.id, identity };
      setActiveDraftId(null);
      setCommentMode(true);
      reload();
    },
  };
}
