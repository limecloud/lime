import React from "react";
import { Check, Copy, Quote } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { MessageActions } from "../styles";

interface MessageActionButtonsProps {
  actionContent: string;
  canCopyMessage: boolean;
  canQuoteMessage: boolean;
  copied: boolean;
  isImageWorkbenchMessage: boolean;
  messageId: string;
  onCopy?: (content: string, messageId: string) => void;
  onQuoteMessage?: (content: string, messageId: string) => void;
}

export function MessageActionButtons({
  actionContent,
  canCopyMessage,
  canQuoteMessage,
  copied,
  isImageWorkbenchMessage,
  messageId,
  onCopy,
  onQuoteMessage,
}: MessageActionButtonsProps) {
  const { t } = useTranslation("agent");

  return (
    <MessageActions
      className={[
        "message-actions",
        isImageWorkbenchMessage ? "image-workbench-message-actions" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-testid="message-actions"
    >
      {canQuoteMessage ? (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground transition-none hover:bg-muted hover:text-foreground focus-visible:ring-ring"
          onClick={() => onQuoteMessage?.(actionContent, messageId)}
          aria-label={t("agentChat.messageList.actions.quote")}
          title={t("agentChat.messageList.actions.quote")}
        >
          <Quote size={12} />
        </Button>
      ) : null}
      {canCopyMessage ? (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground transition-none hover:bg-muted hover:text-foreground focus-visible:ring-ring"
          onClick={() => onCopy?.(actionContent, messageId)}
          aria-label={t("agentChat.messageList.actions.copy")}
          title={t("agentChat.messageList.actions.copy")}
        >
          {copied ? (
            <Check size={12} />
          ) : (
            <Copy size={12} />
          )}
        </Button>
      ) : null}
    </MessageActions>
  );
}
