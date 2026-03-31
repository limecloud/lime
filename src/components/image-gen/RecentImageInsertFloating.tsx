import { useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import { History, LocateFixed, X } from "lucide-react";
import { toast } from "sonner";
import type { Page, PageParams } from "@/types/page";
import type { CanvasImageTargetType } from "@/lib/canvasImageInsertBus";
import { onCanvasImageInsertAck } from "@/lib/canvasImageInsertBus";
import {
  clearCanvasImageInsertHistory,
  getCanvasImageInsertHistory,
  type CanvasImageInsertHistoryEntry,
} from "@/lib/canvasImageInsertHistory";

const FloatingRoot = styled.div`
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 1100;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
`;

const FloatingButton = styled.button`
  height: 38px;
  border-radius: 10px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background) / 0.92);
  color: hsl(var(--foreground));
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  font-size: 12px;
  cursor: pointer;
  box-shadow: 0 8px 28px hsl(var(--background) / 0.32);
  backdrop-filter: blur(8px);
  transition: all 0.2s;

  &:hover {
    border-color: hsl(var(--primary) / 0.5);
    color: hsl(var(--primary));
  }
`;

const Panel = styled.div`
  width: 320px;
  max-height: 360px;
  border: 1px solid hsl(var(--border));
  border-radius: 12px;
  background: hsl(var(--background) / 0.95);
  box-shadow: 0 12px 34px hsl(var(--background) / 0.4);
  backdrop-filter: blur(10px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const PanelHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid hsl(var(--border) / 0.6);
`;

const PanelTitle = styled.div`
  font-size: 12px;
  font-weight: 600;
  color: hsl(var(--foreground));
  display: inline-flex;
  align-items: center;
  gap: 6px;
`;

const HeaderActions = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
`;

const HeaderActionButton = styled.button`
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  color: hsl(var(--muted-foreground));
  border-radius: 8px;
  font-size: 11px;
  padding: 4px 8px;
  cursor: pointer;

  &:hover {
    border-color: hsl(var(--primary) / 0.5);
    color: hsl(var(--primary));
  }
`;

const List = styled.div`
  overflow: auto;
  padding: 8px 10px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const Item = styled.div`
  border: 1px solid hsl(var(--border) / 0.6);
  border-radius: 10px;
  padding: 8px 10px;
  background: hsl(var(--card) / 0.5);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
`;

const ItemMeta = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const ItemTitle = styled.div`
  font-size: 12px;
  color: hsl(var(--foreground));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const ItemHint = styled.div`
  font-size: 11px;
  color: hsl(var(--muted-foreground));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const LocateButton = styled.button`
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  font-size: 11px;
  padding: 4px 8px;
  cursor: pointer;
  flex-shrink: 0;

  &:hover {
    border-color: hsl(var(--primary) / 0.5);
    color: hsl(var(--primary));
  }
`;

const CANVAS_LABEL_MAP: Record<CanvasImageTargetType, string> = {
  auto: "当前画布",
  document: "文档",
  video: "视频",
};

interface RecentImageInsertFloatingProps {
  onNavigate?: (page: Page, params?: PageParams) => void;
}

function getHistoryPreview(): CanvasImageInsertHistoryEntry[] {
  return getCanvasImageInsertHistory().slice(0, 8);
}

export function RecentImageInsertFloating({
  onNavigate,
}: RecentImageInsertFloatingProps) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<CanvasImageInsertHistoryEntry[]>(
    getHistoryPreview,
  );

  useEffect(() => {
    const unsubscribeAck = onCanvasImageInsertAck(() => {
      setHistory(getHistoryPreview());
    });

    const handleStorage = () => {
      setHistory(getHistoryPreview());
    };
    window.addEventListener("storage", handleStorage);

    return () => {
      unsubscribeAck();
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const hasHistory = history.length > 0;
  const visibleCount = useMemo(() => history.length, [history.length]);

  if (!hasHistory) {
    return null;
  }

  const handleLocate = (entry: CanvasImageInsertHistoryEntry) => {
    onNavigate?.("agent", {
      projectId: entry.projectId,
      contentId: entry.contentId ?? undefined,
      theme: entry.theme,
      lockTheme: false,
    });
    setOpen(false);
    toast.success("正在定位到插图位置");
  };

  const handleClearHistory = () => {
    clearCanvasImageInsertHistory();
    setHistory([]);
    setOpen(false);
    toast.success("已清空最近插图记录");
  };

  return (
    <FloatingRoot>
      {open && (
        <Panel>
          <PanelHeader>
            <PanelTitle>
              <History size={14} />
              最近插图记录
            </PanelTitle>
            <HeaderActions>
              <HeaderActionButton type="button" onClick={handleClearHistory}>
                清空
              </HeaderActionButton>
              <HeaderActionButton type="button" onClick={() => setOpen(false)}>
                关闭
              </HeaderActionButton>
            </HeaderActions>
          </PanelHeader>
          <List>
            {history.map((entry) => {
              const canvasLabel = CANVAS_LABEL_MAP[entry.canvasType] || "画布";
              const locationLabel = entry.locationLabel || "已插入";
              return (
                <Item key={entry.requestId}>
                  <ItemMeta>
                    <ItemTitle>
                      {entry.imageTitle?.trim() || "图片"} · {canvasLabel}
                    </ItemTitle>
                    <ItemHint>{locationLabel}</ItemHint>
                  </ItemMeta>
                  <LocateButton type="button" onClick={() => handleLocate(entry)}>
                    <LocateFixed size={12} style={{ marginRight: 4 }} />
                    定位
                  </LocateButton>
                </Item>
              );
            })}
          </List>
        </Panel>
      )}

      <FloatingButton type="button" onClick={() => setOpen((prev) => !prev)}>
        {open ? <X size={14} /> : <History size={14} />}
        最近插图 {visibleCount}
      </FloatingButton>
    </FloatingRoot>
  );
}

export default RecentImageInsertFloating;
