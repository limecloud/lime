import React from "react";
import {
  Check,
  Copy,
  GitFork,
  MoreHorizontal,
  Quote,
  RotateCcw,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { MessageActions } from "../styles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface MessageActionButtonsProps {
  actionContent: string;
  canCopyMessage: boolean;
  canQuoteMessage: boolean;
  copied: boolean;
  isImageWorkbenchMessage: boolean;
  messageId: string;
  onCopy?: (content: string, messageId: string) => void;
  onQuoteMessage?: (content: string, messageId: string) => void;
  onFork?: () => void;
  onRetry?: () => void;
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
  onFork,
  onRetry,
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
      {onFork || onRetry || (canQuoteMessage && onQuoteMessage) ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground transition-none hover:bg-muted hover:text-foreground focus-visible:ring-ring"
              aria-label={t("agentChat.messageList.actions.more")}
              title={t("agentChat.messageList.actions.more")}
              data-testid="message-actions-more"
            >
              <MoreHorizontal size={12} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44 p-1">
            {canQuoteMessage && onQuoteMessage ? (
              <DropdownMenuItem
                className="whitespace-nowrap"
                onClick={() => onQuoteMessage(actionContent, messageId)}
                data-testid="message-action-quote"
              >
                <Quote className="h-3.5 w-3.5" />
                {String(t("agentChat.messageList.actions.quote"))}
              </DropdownMenuItem>
            ) : null}
            {onRetry ? (
              <DropdownMenuItem
                className="whitespace-nowrap"
                onClick={onRetry}
                data-testid="message-action-retry"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {String(t("agentChat.messageList.actions.retry"))}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              className="whitespace-nowrap"
              onClick={onFork}
              data-testid="message-action-fork"
            >
              <GitFork className="h-3.5 w-3.5" />
              {String(t("agentChat.messageList.actions.fork"))}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
