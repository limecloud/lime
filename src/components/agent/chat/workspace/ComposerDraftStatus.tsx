import { useTranslation } from "react-i18next";
import type { ComposerDraftStatus as DraftStatus } from "@/components/input-kit/ComposerDraftCoordinator";

export function ComposerDraftStatus({
  status,
  restoring,
}: {
  status: DraftStatus | null;
  restoring: boolean;
}) {
  const { t } = useTranslation("agent");
  let state:
    | "restoring"
    | "conflict"
    | "error"
    | "unavailable"
    | "saving"
    | "saved"
    | null = null;
  if (restoring) state = "restoring";
  else if (status?.mutation === "conflict") state = "conflict";
  else if (
    status?.mutation === "invalid" ||
    status?.persistence?.state === "error"
  )
    state = "error";
  else if (
    status?.mutation === "unavailable" ||
    status?.persistence?.state === "unavailable"
  )
    state = "unavailable";
  else if (
    status?.mutation === "pending" ||
    status?.persistence?.state === "pending"
  )
    state = "saving";
  else if (
    status?.identity &&
    status.storeRevision !== null &&
    status.persistence?.state === "saved" &&
    status.persistence.savedRevision !== null &&
    status.persistence.savedRevision >= status.storeRevision
  )
    state = "saved";
  if (!state || state === "restoring") return null;
  return (
    <p
      role="status"
      data-testid="composer-draft-status"
      data-state={state}
      className="px-3 pt-1 text-xs text-muted-foreground"
    >
      {t(`agentChat.inputbar.draftPersistence.${state}`)}
    </p>
  );
}
