/**
 * @file 本地图片 Tab
 * @description 从本地文件系统选择图片并保存到图片库
 * @module components/image-gen/tabs/LocalImageTab
 */

import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { ImagePlus, Loader2, Upload, Trash2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import styled, { keyframes } from "styled-components";
import { uploadMaterial } from "@/lib/api/materials";

export interface LocalImageTabProps {
  /** 目标项目 ID */
  projectId?: string | null;
}

// ==================== Animations ====================

const fadeIn = keyframes`
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
`;

const float = keyframes`
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-8px); }
`;

// ==================== Styled Components ====================

const Container = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 10px;
  background: linear-gradient(180deg, hsl(210 40% 98%) 0%, hsl(0 0% 100%) 100%);
`;

const Surface = styled.div`
  flex: 1;
  display: flex;
  min-height: 0;
  flex-direction: column;
  border-radius: 28px;
  border: 1px solid hsl(var(--border) / 0.78);
  background: hsl(var(--background) / 0.84);
  box-shadow:
    0 18px 42px hsl(215 32% 12% / 0.05),
    inset 0 1px 0 hsl(0 0% 100% / 0.72);
  overflow: hidden;
`;

const Content = styled.div`
  flex: 1;
  display: flex;
  min-height: 0;
  align-items: center;
  justify-content: center;
  padding: 28px;
  gap: 18px;
`;

const DropZone = styled.div<{ $dragging?: boolean }>`
  width: 100%;
  max-width: 760px;
  min-height: 360px;
  border: 1.5px dashed
    ${({ $dragging }) =>
      $dragging ? "hsl(214 68% 38% / 0.48)" : "hsl(var(--border) / 0.9)"};
  border-radius: 28px;
  padding: 40px 32px;
  text-align: center;
  cursor: pointer;
  transition: all 0.3s ease;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  background: ${({ $dragging }) =>
    $dragging
      ? "hsl(211 100% 96%)"
      : "linear-gradient(180deg, hsl(var(--background)), hsl(201 42% 98% / 0.9))"};
  box-shadow:
    0 18px 38px hsl(215 32% 12% / 0.04),
    inset 0 1px 0 hsl(0 0% 100% / 0.72);

  &:hover {
    border-color: hsl(214 68% 38% / 0.34);
    background: linear-gradient(
      180deg,
      hsl(var(--background)),
      hsl(203 100% 97% / 0.94)
    );
    transform: translateY(-2px);
    box-shadow: 0 20px 44px hsl(215 32% 12% / 0.08);
  }
`;

const IconContainer = styled.div`
  width: 76px;
  height: 76px;
  border-radius: 22px;
  background: linear-gradient(135deg, hsl(203 100% 97%), hsl(201 52% 94%));
  display: flex;
  align-items: center;
  justify-content: center;
  color: hsl(211 58% 38%);
  animation: ${float} 3s ease-in-out infinite;
`;

const DropTitle = styled.p`
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  color: hsl(var(--foreground));
`;

const DropHint = styled.p`
  margin: 0;
  max-width: 420px;
  font-size: 13px;
  color: hsl(var(--muted-foreground));
  line-height: 1.6;
`;

const DropActionText = styled.div`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 38px;
  padding: 0 18px;
  border-radius: 14px;
  border: 1px solid hsl(215 28% 17% / 0.92);
  background: linear-gradient(180deg, hsl(221 39% 16%), hsl(216 34% 12%));
  color: hsl(var(--background));
  font-size: 13px;
  font-weight: 700;
  box-shadow: 0 14px 28px hsl(220 40% 12% / 0.12);
`;

const PreviewContainer = styled.div`
  width: 100%;
  max-width: 1080px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  animation: ${fadeIn} 0.35s ease;
`;

const PreviewMeta = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex-wrap: wrap;
  width: 100%;
`;

const PreviewChip = styled.div`
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  max-width: min(100%, 680px);
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid hsl(var(--border) / 0.84);
  background: hsl(var(--background) / 0.86);
  font-size: 12px;
  font-weight: 600;
  color: hsl(var(--muted-foreground));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const PreviewCard = styled.div`
  position: relative;
  width: 100%;
  border-radius: 24px;
  overflow: hidden;
  border: 1px solid hsl(var(--border) / 0.82);
  background: linear-gradient(
    180deg,
    hsl(var(--background)),
    hsl(210 20% 98% / 0.96)
  );
  box-shadow:
    0 20px 46px hsl(215 32% 12% / 0.08),
    inset 0 1px 0 hsl(0 0% 100% / 0.72);
  padding: 14px;

  img {
    display: block;
    width: 100%;
    max-height: min(62vh, 640px);
    object-fit: contain;
    border-radius: 18px;
    background: hsl(210 40% 99%);
  }
`;

const Actions = styled.div`
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: center;
`;

const ActionButton = styled.button<{ $primary?: boolean; $danger?: boolean }>`
  height: 42px;
  padding: 0 18px;
  border: ${({ $primary }) =>
    $primary ? "none" : "1px solid hsl(var(--border))"};
  border-radius: 14px;
  background: ${({ $primary, $danger }) =>
    $primary
      ? "linear-gradient(180deg, hsl(221 39% 16%), hsl(216 34% 12%))"
      : $danger
        ? "transparent"
        : "hsl(var(--background) / 0.9)"};
  color: ${({ $primary, $danger }) =>
    $primary
      ? "hsl(var(--background))"
      : $danger
        ? "hsl(var(--destructive))"
        : "hsl(var(--foreground))"};
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transition: all 0.2s ease;

  &:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: ${({ $primary }) =>
      $primary
        ? "0 16px 32px hsl(220 40% 12% / 0.16)"
        : "0 10px 20px hsl(215 32% 12% / 0.08)"};
  }

  &:disabled {
    opacity: 0.5;
    cursor: wait;
  }
`;

const NoProjectState = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  gap: 14px;
  color: hsl(var(--muted-foreground));
  text-align: center;
  padding: 48px;
`;

const NoProjectIcon = styled.div`
  width: 72px;
  height: 72px;
  border-radius: 20px;
  background: linear-gradient(
    135deg,
    hsl(203 100% 97%),
    hsl(201 52% 94% / 0.86)
  );
  display: flex;
  align-items: center;
  justify-content: center;
  color: hsl(211 58% 38%);
`;

// ==================== Component ====================

export function LocalImageTab({ projectId }: LocalImageTabProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSelectFile = async () => {
    try {
      const filePath = await open({
        filters: [
          {
            name: "图片",
            extensions: ["jpg", "jpeg", "png", "webp", "gif", "bmp"],
          },
        ],
        multiple: false,
      });

      if (filePath && typeof filePath === "string") {
        setSelectedPath(filePath);
        setPreviewUrl(`asset://localhost/${filePath}`);
      }
    } catch (error) {
      console.error("选择文件失败:", error);
    }
  };

  const handleSaveToGallery = async () => {
    if (!projectId) {
      toast.error("请先选择项目");
      return;
    }

    if (!selectedPath) {
      toast.error("请先选择图片");
      return;
    }

    setSaving(true);
    try {
      await uploadMaterial({
        projectId,
        name: selectedPath.split("/").pop() || "本地图片",
        type: "image",
        filePath: selectedPath,
        tags: ["local"],
      });
      toast.success("已保存到图片库");

      // 清空选择
      setPreviewUrl(null);
      setSelectedPath(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`保存失败: ${message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleClear = () => {
    setPreviewUrl(null);
    setSelectedPath(null);
  };

  if (!projectId) {
    return (
      <Container>
        <Surface>
          <NoProjectState>
            <NoProjectIcon>
              <Upload size={30} />
            </NoProjectIcon>
            <div
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: "hsl(var(--foreground))",
              }}
            >
              请先选择项目
            </div>
            <div style={{ fontSize: 13 }}>
              在右上角选择一个项目后即可上传本地图片
            </div>
          </NoProjectState>
        </Surface>
      </Container>
    );
  }

  return (
    <Container>
      <Surface>
        <ScrollArea className="h-full">
          <Content>
            {previewUrl ? (
              <PreviewContainer>
                <PreviewMeta>
                  <PreviewChip title={selectedPath || undefined}>
                    {selectedPath?.split("/").pop() || "本地图片"}
                  </PreviewChip>
                </PreviewMeta>
                <PreviewCard>
                  <img src={previewUrl} alt="预览" />
                </PreviewCard>
                <Actions>
                  <ActionButton onClick={handleClear} disabled={saving}>
                    <Trash2 size={16} />
                    重新选择
                  </ActionButton>
                  <ActionButton
                    $primary
                    onClick={handleSaveToGallery}
                    disabled={saving}
                  >
                    {saving ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        保存中...
                      </>
                    ) : (
                      <>
                        <Upload size={16} />
                        保存到图片库
                      </>
                    )}
                  </ActionButton>
                </Actions>
              </PreviewContainer>
            ) : (
              <DropZone onClick={handleSelectFile}>
                <IconContainer>
                  <ImagePlus size={34} />
                </IconContainer>
                <DropTitle>选择本地图片</DropTitle>
                <DropHint>
                  支持 JPG、PNG、WebP、GIF、BMP
                  格式，点击后直接选文件并进入预览。
                </DropHint>
                <DropActionText>选择文件</DropActionText>
              </DropZone>
            )}
          </Content>
        </ScrollArea>
      </Surface>
    </Container>
  );
}

export default LocalImageTab;
