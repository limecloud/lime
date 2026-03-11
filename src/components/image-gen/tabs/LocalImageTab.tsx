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
  display: flex;
  flex-direction: column;
  height: 100%;
  background: hsl(var(--background));
`;

const Content = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 24px;
  gap: 24px;
`;

const DropZone = styled.div<{ $dragging?: boolean }>`
  width: 100%;
  max-width: 520px;
  min-height: 280px;
  border: 2px dashed
    ${({ $dragging }) =>
      $dragging ? "hsl(var(--primary))" : "hsl(var(--border))"};
  border-radius: 20px;
  padding: 48px;
  text-align: center;
  cursor: pointer;
  transition: all 0.3s ease;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
  background: ${({ $dragging }) =>
    $dragging ? "hsl(var(--primary) / 0.06)" : "hsl(var(--card) / 0.3)"};

  &:hover {
    border-color: hsl(var(--primary) / 0.5);
    background: hsl(var(--card) / 0.5);
    transform: translateY(-2px);
    box-shadow: 0 8px 32px hsl(var(--background) / 0.3);
  }
`;

const IconContainer = styled.div`
  width: 80px;
  height: 80px;
  border-radius: 24px;
  background: linear-gradient(
    135deg,
    hsl(var(--primary) / 0.12),
    hsl(var(--primary) / 0.06)
  );
  display: flex;
  align-items: center;
  justify-content: center;
  color: hsl(var(--primary) / 0.7);
  animation: ${float} 3s ease-in-out infinite;
`;

const DropTitle = styled.p`
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: hsl(var(--foreground));
`;

const DropHint = styled.p`
  margin: 0;
  font-size: 13px;
  color: hsl(var(--muted-foreground));
  line-height: 1.6;
`;

const PreviewContainer = styled.div`
  width: 100%;
  max-width: 600px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  animation: ${fadeIn} 0.35s ease;
`;

const PreviewCard = styled.div`
  position: relative;
  border-radius: 16px;
  overflow: hidden;
  border: 1px solid hsl(var(--border));
  box-shadow: 0 8px 32px hsl(var(--background) / 0.4);
  max-height: 440px;

  img {
    display: block;
    max-width: 100%;
    max-height: 420px;
    object-fit: contain;
  }
`;

const Actions = styled.div`
  display: flex;
  gap: 12px;
`;

const ActionButton = styled.button<{ $primary?: boolean; $danger?: boolean }>`
  height: 42px;
  padding: 0 24px;
  border: ${({ $primary }) =>
    $primary ? "none" : "1px solid hsl(var(--border))"};
  border-radius: 12px;
  background: ${({ $primary, $danger }) =>
    $primary
      ? "linear-gradient(135deg, hsl(var(--primary)), hsl(var(--primary) / 0.8))"
      : $danger
        ? "transparent"
        : "hsl(var(--card) / 0.6)"};
  color: ${({ $primary, $danger }) =>
    $primary
      ? "hsl(var(--primary-foreground))"
      : $danger
        ? "hsl(var(--destructive))"
        : "hsl(var(--foreground))"};
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transition: all 0.2s ease;

  &:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: ${({ $primary }) =>
      $primary
        ? "0 6px 20px hsl(var(--primary) / 0.3)"
        : "0 4px 12px hsl(var(--background) / 0.3)"};
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
  height: 100%;
  gap: 16px;
  color: hsl(var(--muted-foreground));
  text-align: center;
  padding: 48px;
`;

const NoProjectIcon = styled.div`
  width: 64px;
  height: 64px;
  border-radius: 20px;
  background: hsl(var(--muted) / 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  color: hsl(var(--muted-foreground) / 0.5);
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
        <NoProjectState>
          <NoProjectIcon>
            <Upload size={28} />
          </NoProjectIcon>
          <div
            style={{
              fontSize: 15,
              fontWeight: 500,
              color: "hsl(var(--foreground) / 0.7)",
            }}
          >
            请先选择项目
          </div>
          <div style={{ fontSize: 13 }}>
            在右上角选择一个项目后即可上传本地图片
          </div>
        </NoProjectState>
      </Container>
    );
  }

  return (
    <Container>
      <ScrollArea className="h-full">
        <Content>
          {previewUrl ? (
            <PreviewContainer>
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
                <ImagePlus size={36} />
              </IconContainer>
              <DropTitle>选择本地图片</DropTitle>
              <DropHint>
                支持 JPG、PNG、WebP、GIF、BMP 格式
                <br />
                点击此区域选择文件
              </DropHint>
            </DropZone>
          )}
        </Content>
      </ScrollArea>
    </Container>
  );
}

export default LocalImageTab;
