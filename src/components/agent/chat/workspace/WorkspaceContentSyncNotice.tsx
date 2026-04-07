import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import type { SyncStatus } from "../hooks/useContentSync";
import { ContentSyncNotice, ContentSyncNoticeText } from "./WorkspaceStyles";

interface WorkspaceContentSyncNoticeProps {
  status: Exclude<SyncStatus, "idle">;
}

function resolveContentSyncNoticeMeta(status: Exclude<SyncStatus, "idle">): {
  label: string;
  Icon: typeof Loader2;
  animated?: boolean;
} {
  switch (status) {
    case "syncing":
      return {
        label: "正在同步到当前内容…",
        Icon: Loader2,
        animated: true,
      };
    case "success":
      return {
        label: "内容已同步",
        Icon: CheckCircle2,
      };
    case "error":
    default:
      return {
        label: "同步失败，将自动重试",
        Icon: AlertTriangle,
      };
  }
}

export function WorkspaceContentSyncNotice({
  status,
}: WorkspaceContentSyncNoticeProps) {
  const notice = resolveContentSyncNoticeMeta(status);
  const NoticeIcon = notice.Icon;

  return (
    <ContentSyncNotice $status={status}>
      <NoticeIcon
        className={notice.animated ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"}
      />
      <ContentSyncNoticeText>{notice.label}</ContentSyncNoticeText>
    </ContentSyncNotice>
  );
}
