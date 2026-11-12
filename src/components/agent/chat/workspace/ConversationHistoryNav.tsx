import { ArrowLeft, ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  requestConversationHistoryBack,
  requestConversationHistoryForward,
  useConversationHistory,
} from "@/lib/conversationHistory";

export function ConversationHistoryNav() {
  const { t } = useTranslation("navigation");
  const { canBack, canForward } = useConversationHistory();
  const buttonClass =
    "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[color:var(--lime-text-muted)] transition-colors hover:bg-[color:var(--lime-chrome-tab-hover)] hover:text-[color:var(--lime-text-strong)] disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent";
  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        className={buttonClass}
        aria-label={String(
          t("navigation.sidebar.conversations.history.back", {
            defaultValue: "后退",
          }),
        )}
        data-testid="conversation-history-back"
        disabled={!canBack}
        onClick={requestConversationHistoryBack}
      >
        <ArrowLeft className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={buttonClass}
        aria-label={String(
          t("navigation.sidebar.conversations.history.forward", {
            defaultValue: "前进",
          }),
        )}
        data-testid="conversation-history-forward"
        disabled={!canForward}
        onClick={requestConversationHistoryForward}
      >
        <ArrowRight className="h-4 w-4" />
      </button>
    </div>
  );
}
