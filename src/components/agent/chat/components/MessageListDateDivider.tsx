import { useTranslation } from "react-i18next";

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function MessageListDateDivider({
  timestamp,
}: {
  timestamp: Date | null | undefined;
}) {
  const { t, i18n } = useTranslation("agent");
  if (!timestamp || Number.isNaN(timestamp.getTime())) {
    return null;
  }
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const time = new Intl.DateTimeFormat(i18n.language, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(timestamp);
  const dayLabel = isSameDay(timestamp, now)
    ? String(t("agentChat.messageList.dateDivider.today"))
    : isSameDay(timestamp, yesterday)
      ? String(t("agentChat.messageList.dateDivider.yesterday"))
      : new Intl.DateTimeFormat(i18n.language, {
          month: "long",
          day: "numeric",
        }).format(timestamp);
  return (
    <div
      className="flex items-center justify-center py-1 text-[11px] font-medium text-[color:var(--lime-text-muted)]"
      data-testid="message-list-date-divider"
    >
      {dayLabel} {time}
    </div>
  );
}
