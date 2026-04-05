/**
 * @file AI 生图 Tab
 * @description 从原 ImageGenPage 提取的 AI 图片生成功能
 * @module components/image-gen/tabs/AiImageGenTab
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import {
  Image as ImageIcon,
  ImagePlus,
  Loader2,
  Plus,
  Send,
  Settings,
  Sparkles,
  Trash2,
  ExternalLink,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  IMAGE_GENERATION_CANCELED_MESSAGE,
  useImageGen,
} from "../useImageGen";
import type { GeneratedImage } from "../types";
import { useProject } from "@/hooks/useProject";
import { useProjects } from "@/hooks/useProjects";
import {
  getStoredResourceProjectId,
  onResourceProjectChange,
  setStoredResourceProjectId,
} from "@/lib/resourceProjectSelection";
import { CharacterMention } from "@/components/agent/chat/skill-selection/CharacterMention";
import { SkillBadge } from "@/components/agent/chat/skill-selection/SkillBadge";
import { useActiveSkill } from "@/components/agent/chat/skill-selection/useActiveSkill";
import { skillsApi, type Skill } from "@/lib/api/skills";
import { useGlobalMediaGenerationDefaults } from "@/hooks/useGlobalMediaGenerationDefaults";
import { resolveMediaGenerationPreference } from "@/lib/mediaGeneration";
import type { Page, PageParams } from "@/types/page";
import { SettingsTabs } from "@/types/settings";

export interface AiImageGenTabProps {
  /** 目标项目 ID（可选） */
  projectId?: string | null;
  /** 导航回调 */
  onNavigate?: (page: Page, params?: PageParams) => void;
}

type ResolutionPreset = "1k" | "2k" | "4k";

interface ReferenceImageItem {
  id: string;
  name: string;
  url: string;
}

const RESOLUTION_OPTIONS: Array<{
  label: string;
  value: ResolutionPreset;
  longEdge: number;
}> = [
  { label: "1K", value: "1k", longEdge: 1024 },
  { label: "2K", value: "2k", longEdge: 2048 },
  { label: "4K", value: "4k", longEdge: 4096 },
];

const ASPECT_RATIO_OPTIONS = [
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "9:16",
  "5:4",
  "4:5",
  "16:9",
  "21:9",
];

const IMAGE_COUNT_PRESETS = [1, 2, 4, 8];

const FALLBACK_SUPPORTED_SIZES = [
  "1024x1024",
  "768x1344",
  "864x1152",
  "1344x768",
  "1152x864",
];

function parseSize(size: string): { width: number; height: number } | null {
  const [rawWidth, rawHeight] = size.split("x");
  const width = Number(rawWidth);
  const height = Number(rawHeight);

  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }

  return { width, height };
}

function parseAspectRatio(ratio: string): number {
  const [rawWidth, rawHeight] = ratio.split(":");
  const width = Number(rawWidth);
  const height = Number(rawHeight);

  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return 1;
  }

  return width / height;
}

function chooseClosestSize(
  supportedSizes: string[],
  aspectRatio: string,
  resolutionPreset: ResolutionPreset,
): string {
  const candidates = supportedSizes
    .map((size) => ({
      raw: size,
      parsed: parseSize(size),
    }))
    .filter(
      (
        candidate,
      ): candidate is {
        raw: string;
        parsed: { width: number; height: number };
      } => candidate.parsed !== null,
    );

  if (candidates.length === 0) {
    return FALLBACK_SUPPORTED_SIZES[0];
  }

  const ratioValue = parseAspectRatio(aspectRatio);
  const longEdge =
    RESOLUTION_OPTIONS.find((option) => option.value === resolutionPreset)
      ?.longEdge || 1024;

  const targetWidth =
    ratioValue >= 1 ? longEdge : Math.max(1, Math.round(longEdge * ratioValue));
  const targetHeight =
    ratioValue >= 1 ? Math.max(1, Math.round(longEdge / ratioValue)) : longEdge;

  const targetArea = targetWidth * targetHeight;

  const best = candidates.reduce(
    (current, candidate) => {
      const candidateRatio = candidate.parsed.width / candidate.parsed.height;
      const candidateArea = candidate.parsed.width * candidate.parsed.height;

      const ratioScore = Math.abs(Math.log(candidateRatio / ratioValue));
      const areaScore = Math.abs(candidateArea - targetArea) / targetArea;
      const totalScore = ratioScore * 3 + areaScore;

      if (totalScore < current.score) {
        return { score: totalScore, size: candidate.raw };
      }

      return current;
    },
    { score: Number.POSITIVE_INFINITY, size: candidates[0].raw },
  );

  return best.size;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("文件读取失败"));
    };

    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });
}

function resolveBatchImages(
  images: GeneratedImage[],
  selectedImageId: string | null,
): GeneratedImage[] {
  if (!selectedImageId) {
    return [];
  }

  const batchMatch = selectedImageId.match(/^img-(\d+)-\d+$/);
  if (!batchMatch) {
    const single = images.find((item) => item.id === selectedImageId);
    return single ? [single] : [];
  }

  const batchPrefix = `img-${batchMatch[1]}-`;
  return images
    .filter((item) => item.id.startsWith(batchPrefix))
    .sort((left, right) => left.createdAt - right.createdAt);
}

function getStatusText(status: GeneratedImage["status"]): string {
  switch (status) {
    case "complete":
      return "已完成";
    case "error":
      return "失败";
    case "generating":
      return "生成中";
    default:
      return "待生成";
  }
}

// ==================== Styled Components ====================

const Container = styled.div`
  height: 100%;
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 10px;
  overflow: hidden;
  padding: 10px;
  background: linear-gradient(180deg, hsl(210 40% 98%) 0%, hsl(0 0% 100%) 100%);
  color: hsl(var(--foreground));

  @media (max-width: 1180px) {
    gap: 8px;
    padding: 10px;
  }

  @media (max-width: 980px) {
    flex-direction: column;
    overflow: auto;
  }
`;

const ControlPanel = styled.aside`
  width: 272px;
  min-width: 272px;
  padding: 12px;
  border-radius: 24px;
  border: 1px solid hsl(var(--border) / 0.78);
  background: linear-gradient(
    180deg,
    hsl(var(--background) / 0.84),
    hsl(201 42% 98% / 0.72)
  );
  box-shadow:
    0 16px 40px hsl(215 32% 12% / 0.06),
    inset 0 1px 0 hsl(0 0% 100% / 0.72);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;

  @media (max-width: 1180px) {
    width: 252px;
    min-width: 252px;
  }

  @media (max-width: 980px) {
    width: 100%;
    min-width: 0;
    max-height: none;
  }
`;

const PanelIntro = styled.div`
  border-radius: 24px;
  border: 1px solid hsl(152 30% 86%);
  background: linear-gradient(
    135deg,
    hsl(154 48% 96%) 0%,
    hsl(0 0% 100%) 48%,
    hsl(201 62% 97%) 100%
  );
  padding: 18px;
  box-shadow:
    0 14px 32px hsl(200 38% 16% / 0.06),
    inset 0 1px 0 hsl(0 0% 100% / 0.78);
`;

const PanelEyebrow = styled.span`
  display: inline-flex;
  align-items: center;
  width: fit-content;
  border-radius: 999px;
  border: 1px solid hsl(154 36% 82%);
  background: hsl(0 0% 100% / 0.8);
  padding: 5px 10px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: hsl(154 50% 28%);
`;

const PanelTitle = styled.h2`
  margin: 10px 0 6px;
  font-size: 22px;
  line-height: 1.2;
  font-weight: 700;
  color: hsl(var(--foreground));
`;

const PanelDescription = styled.p`
  margin: 0;
  font-size: 13px;
  line-height: 1.65;
  color: hsl(var(--muted-foreground));
`;

const PanelMetaGrid = styled.div`
  margin-top: 14px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
`;

const PanelMetaCard = styled.div`
  border-radius: 18px;
  border: 1px solid hsl(var(--border) / 0.8);
  background: hsl(var(--background) / 0.86);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 5px;
`;

const PanelMetaLabel = styled.span`
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: hsl(var(--muted-foreground));
`;

const PanelMetaValue = styled.span`
  font-size: 14px;
  line-height: 1.45;
  font-weight: 600;
  color: hsl(var(--foreground));
  word-break: break-word;
`;

const Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: 12px;
  border-radius: 22px;
  border: 1px solid hsl(var(--border) / 0.78);
  background: hsl(var(--background) / 0.86);
  padding: 14px;
  box-shadow:
    0 10px 28px hsl(215 30% 14% / 0.04),
    inset 0 1px 0 hsl(0 0% 100% / 0.75);
`;

const SectionTitle = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 14px;
  font-weight: 700;
  color: hsl(var(--foreground));
`;

const Hint = styled.div`
  font-size: 12px;
  line-height: 1.6;
  color: hsl(var(--muted-foreground));
`;

const Select = styled.select`
  width: 100%;
  height: 42px;
  border: 1px solid hsl(var(--border));
  border-radius: 14px;
  background: linear-gradient(
    180deg,
    hsl(var(--background)),
    hsl(var(--muted) / 0.12)
  );
  padding: 0 12px;
  font-size: 13px;
  font-weight: 600;
  color: hsl(var(--foreground));
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    transform 0.2s ease;

  &:hover {
    border-color: hsl(214 68% 38% / 0.28);
    transform: translateY(-1px);
  }

  &:focus {
    outline: none;
    border-color: hsl(214 68% 38% / 0.32);
    box-shadow: 0 0 0 4px hsl(211 100% 96%);
  }
`;

const FullButton = styled.button<{ $disabled?: boolean }>`
  width: 100%;
  height: 38px;
  border-radius: 14px;
  border: 1px solid hsl(var(--border));
  background: linear-gradient(
    180deg,
    hsl(var(--background)),
    hsl(var(--muted) / 0.12)
  );
  color: hsl(var(--foreground));
  font-size: 13px;
  font-weight: 700;
  cursor: ${({ $disabled }) => ($disabled ? "not-allowed" : "pointer")};
  opacity: ${({ $disabled }) => ($disabled ? 0.65 : 1)};
  transition:
    border-color 0.2s ease,
    transform 0.2s ease,
    box-shadow 0.2s ease;

  &:hover {
    border-color: ${({ $disabled }) =>
      $disabled ? "hsl(var(--border))" : "hsl(214 68% 38% / 0.3)"};
    background: ${({ $disabled }) =>
      $disabled
        ? "linear-gradient(180deg, hsl(var(--background)), hsl(var(--muted) / 0.12))"
        : "hsl(var(--background))"};
    transform: ${({ $disabled }) => ($disabled ? "none" : "translateY(-1px)")};
    box-shadow: ${({ $disabled }) =>
      $disabled ? "none" : "0 12px 24px hsl(215 30% 14% / 0.08)"};
  }
`;

const SmallButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 1px solid hsl(var(--border));
  border-radius: 10px;
  background: hsl(var(--background));
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    transform 0.2s ease,
    color 0.2s ease;

  &:hover {
    color: hsl(var(--foreground));
    border-color: hsl(214 68% 38% / 0.32);
    transform: translateY(-1px);
  }
`;

const UploadBox = styled.div<{ $dragging: boolean }>`
  border: 1px dashed
    ${({ $dragging }) =>
      $dragging ? "hsl(214 68% 38% / 0.42)" : "hsl(var(--border))"};
  border-radius: 18px;
  min-height: 126px;
  background: ${({ $dragging }) =>
    $dragging
      ? "hsl(211 100% 96%)"
      : "linear-gradient(180deg, hsl(var(--muted) / 0.18), hsl(var(--background)))"};
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 12px;
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    background 0.2s ease,
    transform 0.2s ease;

  &:hover {
    border-color: hsl(214 68% 38% / 0.3);
    transform: translateY(-1px);
  }
`;

const UploadText = styled.div`
  font-size: 12px;
  line-height: 1.6;
  color: hsl(var(--muted-foreground));
`;

const Thumbs = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
`;

const ThumbItem = styled.div`
  position: relative;
  border-radius: 14px;
  overflow: hidden;
  border: 1px solid hsl(var(--border));
  aspect-ratio: 1;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
`;

const RemoveThumb = styled.button`
  position: absolute;
  top: 6px;
  right: 6px;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 999px;
  background: hsl(var(--background) / 0.9);
  color: hsl(var(--destructive));
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
`;

const Segment = styled.div`
  display: flex;
  gap: 6px;
`;

const SegmentButton = styled.button<{ $active: boolean }>`
  flex: 1;
  height: 36px;
  border-radius: 14px;
  border: 1px solid
    ${({ $active }) =>
      $active ? "hsl(221 39% 16%)" : "hsl(var(--border) / 0.8)"};
  background: ${({ $active }) =>
    $active
      ? "linear-gradient(180deg, hsl(221 39% 16%), hsl(216 34% 12%))"
      : "hsl(var(--muted) / 0.18)"};
  color: ${({ $active }) =>
    $active ? "hsl(var(--background))" : "hsl(var(--muted-foreground))"};
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition:
    transform 0.2s ease,
    border-color 0.2s ease,
    box-shadow 0.2s ease;

  &:hover {
    transform: translateY(-1px);
    border-color: hsl(214 68% 38% / 0.28);
  }
`;

const RatioGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
`;

const RatioButton = styled.button<{ $active: boolean }>`
  height: 46px;
  border-radius: 14px;
  border: 1px solid
    ${({ $active }) =>
      $active ? "hsl(214 68% 38% / 0.3)" : "hsl(var(--border) / 0.82)"};
  background: ${({ $active }) =>
    $active ? "hsl(211 100% 96%)" : "hsl(var(--background))"};
  color: ${({ $active }) =>
    $active ? "hsl(211 58% 38%)" : "hsl(var(--muted-foreground))"};
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition:
    transform 0.2s ease,
    border-color 0.2s ease,
    background 0.2s ease;

  &:hover {
    transform: translateY(-1px);
    border-color: hsl(214 68% 38% / 0.25);
  }
`;

const CountRow = styled.div`
  display: flex;
  gap: 6px;
`;

const CountButton = styled.button<{ $active: boolean }>`
  flex: 1;
  height: 36px;
  border-radius: 14px;
  border: 1px solid
    ${({ $active }) =>
      $active ? "hsl(214 68% 38% / 0.3)" : "hsl(var(--border) / 0.8)"};
  background: ${({ $active }) =>
    $active ? "hsl(211 100% 96%)" : "hsl(var(--muted) / 0.18)"};
  color: ${({ $active }) =>
    $active ? "hsl(211 58% 38%)" : "hsl(var(--muted-foreground))"};
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition:
    transform 0.2s ease,
    border-color 0.2s ease;

  &:hover {
    transform: translateY(-1px);
    border-color: hsl(214 68% 38% / 0.25);
  }
`;

const CountInput = styled.input`
  width: 100%;
  height: 40px;
  border: 1px solid hsl(var(--border));
  border-radius: 14px;
  background: hsl(var(--background));
  padding: 0 12px;
  font-size: 13px;

  &:focus {
    outline: none;
    border-color: hsl(214 68% 38% / 0.32);
    box-shadow: 0 0 0 4px hsl(211 100% 96%);
  }
`;

const Workspace = styled.main`
  flex: 1;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  gap: 8px;
  min-height: 0;
  min-width: 0;
`;

const Eyebrow = styled.span`
  display: inline-flex;
  align-items: center;
  width: fit-content;
  border-radius: 999px;
  border: 1px solid hsl(203 82% 88%);
  background: hsl(200 100% 97%);
  padding: 4px 8px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: hsl(211 58% 38%);
`;

const CanvasPanel = styled.section`
  min-height: 0;
  overflow: hidden;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-radius: 24px;
  border: 1px solid hsl(var(--border) / 0.78);
  background: linear-gradient(
    180deg,
    hsl(var(--background) / 0.96),
    hsl(201 46% 98% / 0.96)
  );
  padding: 6px;
  box-shadow:
    0 18px 42px hsl(215 32% 12% / 0.06),
    inset 0 1px 0 hsl(0 0% 100% / 0.72);
`;

const CanvasHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;

  @media (max-width: 960px) {
    align-items: flex-start;
  }
`;

const CanvasHeaderCopy = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-width: 560px;
`;

const CanvasLabel = styled.h2`
  margin: 0;
  font-size: clamp(18px, 2vw, 24px);
  line-height: 1.1;
  font-weight: 700;
  color: hsl(var(--foreground));
`;

const CanvasMetaRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
`;

const CanvasMetaChip = styled.span`
  display: inline-flex;
  align-items: center;
  height: 26px;
  border-radius: 999px;
  border: 1px solid hsl(var(--border) / 0.86);
  background: hsl(var(--background) / 0.84);
  padding: 0 10px;
  font-size: 11px;
  font-weight: 600;
  color: hsl(var(--muted-foreground));
`;

const Canvas = styled.div`
  flex: 1;
  min-height: 260px;
  border: 1px solid hsl(var(--border) / 0.8);
  border-radius: 24px;
  background:
    radial-gradient(circle at top, hsl(200 100% 97%), transparent 34%),
    linear-gradient(180deg, hsl(0 0% 100%), hsl(210 20% 98%));
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
`;

const PreviewStage = styled.div`
  width: 100%;
  height: 100%;
  padding: 6px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const Empty = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
  color: hsl(var(--muted-foreground));

  h2 {
    margin: 0;
    font-size: 30px;
    font-weight: 700;
    letter-spacing: 0;
    color: hsl(var(--foreground));
  }

  div {
    max-width: 420px;
    line-height: 1.65;
  }
`;

const PreviewImage = styled.img`
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  border-radius: 14px;
`;

const BatchGrid = styled.div`
  width: 100%;
  height: 100%;
  padding: 8px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  align-content: start;
  overflow: auto;
`;

const BatchItem = styled.button<{ $active: boolean }>`
  border: 1px solid
    ${({ $active }) =>
      $active ? "hsl(214 68% 38% / 0.32)" : "hsl(var(--border) / 0.84)"};
  border-radius: 18px;
  background: ${({ $active }) =>
    $active ? "hsl(203 100% 97%)" : "hsl(var(--background))"};
  cursor: pointer;
  display: flex;
  flex-direction: column;
  padding: 10px;
  gap: 8px;
  transition:
    transform 0.2s ease,
    border-color 0.2s ease,
    box-shadow 0.2s ease;

  &:hover {
    transform: translateY(-1px);
    border-color: hsl(214 68% 38% / 0.28);
    box-shadow: 0 12px 24px hsl(215 30% 14% / 0.08);
  }
`;

const BatchPreviewWrap = styled.div`
  border-radius: 14px;
  background: hsl(var(--muted) / 0.18);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;

  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
`;

const BatchPlaceholder = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 8px;
  color: hsl(var(--muted-foreground));
`;

const BatchMeta = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
  font-weight: 600;
`;

const CanvasActions = styled.div`
  position: absolute;
  top: 12px;
  right: 12px;
  display: flex;
  gap: 6px;
`;

const CanvasActionButton = styled.button`
  width: 36px;
  height: 36px;
  border-radius: 12px;
  border: 1px solid hsl(var(--border) / 0.88);
  background: hsl(var(--background) / 0.92);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  box-shadow: 0 10px 24px hsl(215 30% 14% / 0.08);
  transition:
    transform 0.2s ease,
    border-color 0.2s ease,
    color 0.2s ease;

  &:hover {
    color: hsl(var(--foreground));
    border-color: hsl(214 68% 38% / 0.28);
    transform: translateY(-1px);
  }
`;

const SkillRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
`;

const PromptDock = styled.div`
  flex-shrink: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const PromptSurface = styled.div`
  position: relative;
  border-radius: 18px;
  border: 1px solid hsl(var(--border) / 0.8);
  background: linear-gradient(
    180deg,
    hsl(var(--background)),
    hsl(var(--muted) / 0.12)
  );
  padding: 9px 50px 8px 12px;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease;

  &:focus-within {
    border-color: hsl(214 68% 38% / 0.34);
    box-shadow: 0 0 0 4px hsl(211 100% 96%);
  }
`;

const PromptInput = styled.textarea`
  width: 100%;
  min-height: 42px;
  max-height: 92px;
  border: none;
  resize: none;
  background: transparent;
  font-size: 13px;
  line-height: 1.5;
  color: hsl(var(--foreground));
  padding: 0;
  font-family: inherit;

  &:focus {
    outline: none;
  }

  &::placeholder {
    color: hsl(var(--muted-foreground));
  }
`;

const GenerateButton = styled.button<{ $disabled: boolean }>`
  position: absolute;
  right: 8px;
  bottom: 8px;
  width: 34px;
  height: 34px;
  border: 1px solid
    ${({ $disabled }) =>
      $disabled ? "hsl(var(--border))" : "hsl(215 28% 17% / 0.92)"};
  border-radius: 12px;
  background: ${({ $disabled }) =>
    $disabled
      ? "hsl(var(--muted) / 0.75)"
      : "linear-gradient(180deg, hsl(221 39% 16%), hsl(216 34% 12%))"};
  color: ${({ $disabled }) =>
    $disabled ? "hsl(var(--muted-foreground))" : "hsl(var(--background))"};
  cursor: ${({ $disabled }) => ($disabled ? "not-allowed" : "pointer")};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease,
    opacity 0.2s ease;
  box-shadow: ${({ $disabled }) =>
    $disabled ? "none" : "0 16px 32px hsl(220 40% 12% / 0.16)"};

  &:hover {
    transform: ${({ $disabled }) => ($disabled ? "none" : "translateY(-1px)")};
    box-shadow: ${({ $disabled }) =>
      $disabled ? "none" : "0 18px 36px hsl(220 40% 12% / 0.2)"};
  }
`;

const PromptHistoryDock = styled.div`
  display: none;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  flex-wrap: wrap;
`;

const PromptHistoryLabel = styled.div`
  color: hsl(var(--muted-foreground));
  white-space: nowrap;
  font-weight: 600;
`;

const PromptHistoryChip = styled.button<{ $active: boolean }>`
  max-width: min(100%, 520px);
  border: 1px solid
    ${({ $active }) =>
      $active ? "hsl(214 68% 38% / 0.3)" : "hsl(var(--border))"};
  border-radius: 999px;
  background: ${({ $active }) =>
    $active ? "hsl(211 100% 96%)" : "hsl(var(--muted) / 0.2)"};
  color: ${({ $active }) =>
    $active ? "hsl(211 58% 38%)" : "hsl(var(--muted-foreground))"};
  padding: 4px 10px;
  font-size: 11px;
  line-height: 1.4;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: left;

  &:hover {
    border-color: hsl(214 68% 38% / 0.3);
    color: hsl(211 58% 38%);
  }
`;

const Status = styled.div`
  border-radius: 18px;
  border: 1px solid hsl(var(--border) / 0.82);
  background: hsl(var(--background) / 0.82);
  padding: 10px 12px;
  font-size: 12px;
  line-height: 1.6;
  color: hsl(var(--muted-foreground));
`;

const HistorySidebar = styled.aside`
  width: 80px;
  min-width: 80px;
  border-radius: 24px;
  border: 1px solid hsl(var(--border) / 0.78);
  background: linear-gradient(
    180deg,
    hsl(var(--background) / 0.84),
    hsl(201 42% 98% / 0.72)
  );
  box-shadow:
    0 16px 40px hsl(215 32% 12% / 0.06),
    inset 0 1px 0 hsl(0 0% 100% / 0.72);
  padding: 10px 8px;
  display: flex;
  flex-direction: column;
  gap: 10px;

  @media (max-width: 980px) {
    width: 100%;
    min-width: 0;
  }
`;

const HistoryHeader = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const HistoryTitle = styled.div`
  font-size: 12px;
  font-weight: 700;
  text-align: center;
  color: hsl(var(--muted-foreground));
  letter-spacing: 0.08em;
`;

const HistoryNewButton = styled.button`
  width: 100%;
  height: 46px;
  border: 1px dashed hsl(var(--border));
  border-radius: 16px;
  background: hsl(var(--background) / 0.72);
  color: hsl(var(--muted-foreground));
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition:
    transform 0.2s ease,
    border-color 0.2s ease,
    background 0.2s ease;

  &:hover {
    border-color: hsl(214 68% 38% / 0.3);
    color: hsl(211 58% 38%);
    background: hsl(211 100% 96%);
    transform: translateY(-1px);
  }
`;

const HistoryList = styled.div`
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-right: 2px;

  @media (max-width: 980px) {
    flex-direction: row;
    overflow-x: auto;
    overflow-y: hidden;
    padding-right: 0;
    padding-bottom: 2px;
  }
`;

const HistoryItem = styled.div<{ $active: boolean }>`
  width: 100%;
  aspect-ratio: 1;
  border-radius: 16px;
  border: 1px solid
    ${({ $active }) =>
      $active ? "hsl(214 68% 38% / 0.3)" : "hsl(var(--border))"};
  background: ${({ $active }) =>
    $active ? "hsl(211 100% 96%)" : "hsl(var(--background))"};
  overflow: hidden;
  cursor: pointer;
  position: relative;
  transition:
    transform 0.2s ease,
    border-color 0.2s ease,
    box-shadow 0.2s ease;

  &:hover {
    border-color: hsl(214 68% 38% / 0.3);
    transform: translateY(-1px);
    box-shadow: 0 12px 24px hsl(215 30% 14% / 0.08);
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  @media (max-width: 980px) {
    width: 84px;
    min-width: 84px;
  }
`;

const HistoryPlaceholder = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: hsl(var(--muted-foreground));
`;

const HistoryDeleteButton = styled.button`
  position: absolute;
  top: 6px;
  right: 6px;
  width: 22px;
  height: 22px;
  border: 1px solid hsl(var(--destructive) / 0.35);
  border-radius: 50%;
  background: hsl(var(--background) / 0.92);
  color: hsl(var(--destructive));
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  transition: all 0.15s;

  ${HistoryItem}:hover & {
    opacity: 1;
  }

  &:hover {
    background: hsl(var(--destructive));
    color: hsl(var(--destructive-foreground));
  }
`;

const HistoryEmpty = styled.div`
  margin-top: 10px;
  font-size: 12px;
  line-height: 1.6;
  color: hsl(var(--muted-foreground));
  text-align: center;
`;

// ==================== Component ====================

export function AiImageGenTab({ projectId, onNavigate }: AiImageGenTabProps) {
  const { project } = useProject(projectId ?? null);
  const { mediaDefaults } = useGlobalMediaGenerationDefaults();
  const effectiveImagePreference = useMemo(
    () =>
      resolveMediaGenerationPreference(
        project?.settings?.imageGeneration,
        mediaDefaults.image,
      ),
    [mediaDefaults.image, project?.settings?.imageGeneration],
  );
  const {
    availableProviders,
    selectedProvider,
    selectedProviderId,
    setSelectedProviderId,
    providersLoading,
    availableModels,
    selectedModel,
    selectedModelId,
    setSelectedModelId,
    selectedSize,
    setSelectedSize,
    images,
    selectedImage,
    selectedImageId,
    setSelectedImageId,
    generating,
    savingToResource,
    generateImage,
    cancelGeneration,
    backfillImagesToResource,
    deleteImage,
    newImage,
  } = useImageGen({
    preferredProviderId: effectiveImagePreference.preferredProviderId,
    preferredModelId: effectiveImagePreference.preferredModelId,
    allowFallback: effectiveImagePreference.allowFallback,
  });

  const { projects, defaultProject, loading: projectsLoading } = useProjects();

  const [prompt, setPrompt] = useState("");
  const [skills, setSkills] = useState<Skill[]>([]);
  const { activeSkill, setActiveSkill, wrapTextWithSkill, clearActiveSkill } =
    useActiveSkill();
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [resolutionPreset, setResolutionPreset] =
    useState<ResolutionPreset>("1k");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [imageCount, setImageCount] = useState(1);
  const [isEditingCustomCount, setIsEditingCustomCount] = useState(false);
  const [customCountInput, setCustomCountInput] = useState("");
  const [referenceImages, setReferenceImages] = useState<ReferenceImageItem[]>(
    [],
  );
  const [isDraggingUpload, setIsDraggingUpload] = useState(false);
  const [targetProjectId, setTargetProjectId] = useState(projectId || "");

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 加载技能列表
  useEffect(() => {
    skillsApi
      .getAll("lime")
      .then(setSkills)
      .catch((err) => console.error("加载技能列表失败:", err));
  }, []);

  const availableProjects = useMemo(
    () => projects.filter((project) => !project.isArchived),
    [projects],
  );

  const selectedTargetProject = useMemo(
    () => availableProjects.find((project) => project.id === targetProjectId),
    [availableProjects, targetProjectId],
  );

  const supportedSizes = useMemo(() => {
    return selectedModel?.supportedSizes || FALLBACK_SUPPORTED_SIZES;
  }, [selectedModel]);

  const resolvedSize = useMemo(() => {
    return chooseClosestSize(supportedSizes, aspectRatio, resolutionPreset);
  }, [supportedSizes, aspectRatio, resolutionPreset]);

  useEffect(() => {
    if (resolvedSize !== selectedSize) {
      setSelectedSize(resolvedSize);
    }
  }, [resolvedSize, selectedSize, setSelectedSize]);

  // 初始化或更新目标项目 ID
  useEffect(() => {
    if (projectsLoading) {
      return;
    }

    setTargetProjectId((current) => {
      // 如果外部传入了 projectId 且不同于当前值，使用外部值
      if (projectId && projectId !== current) {
        return projectId;
      }

      // 如果当前值有效且在可用项目中，保持不变
      if (
        current &&
        availableProjects.some((project) => project.id === current)
      ) {
        return current;
      }

      // 尝试从存储中获取
      const storedProjectId = getStoredResourceProjectId({
        includeLegacy: true,
      });
      if (
        storedProjectId &&
        availableProjects.some((project) => project.id === storedProjectId)
      ) {
        return storedProjectId;
      }

      // 使用默认项目
      const preferredProject =
        (defaultProject && !defaultProject.isArchived
          ? defaultProject
          : null) ?? availableProjects[0];

      return preferredProject?.id || "";
    });
  }, [projectsLoading, availableProjects, defaultProject, projectId]);

  useEffect(() => {
    setStoredResourceProjectId(targetProjectId, {
      source: "image-gen-target",
      syncLegacy: true,
      emitEvent: true,
    });
  }, [targetProjectId]);

  useEffect(() => {
    return onResourceProjectChange((detail) => {
      if (detail.source !== "resources") {
        return;
      }

      const nextProjectId = detail.projectId;
      if (!nextProjectId || nextProjectId === targetProjectId) {
        return;
      }

      if (!availableProjects.some((project) => project.id === nextProjectId)) {
        return;
      }

      setTargetProjectId(nextProjectId);
    });
  }, [availableProjects, targetProjectId]);

  const canGenerate =
    !!prompt.trim() && !!selectedProvider && !!selectedModelId && !generating;

  const selectedBatchImages = useMemo(() => {
    return resolveBatchImages(images, selectedImageId);
  }, [images, selectedImageId]);

  const selectedPromptHistory = useMemo(() => {
    return selectedImage?.prompt.trim() || "";
  }, [selectedImage]);

  const isFalProvider =
    selectedProvider?.id === "fal" || selectedProvider?.type === "fal";

  const shouldShowBatchGrid = selectedBatchImages.length > 1;
  const completedImageCount = useMemo(
    () => images.filter((image) => image.status === "complete").length,
    [images],
  );
  const generatingImageCount = useMemo(
    () => images.filter((image) => image.status === "generating").length,
    [images],
  );
  const handleCountSelect = (count: number) => {
    setImageCount(count);
    setIsEditingCustomCount(false);
  };

  const handleCustomCountConfirm = () => {
    const next = Number(customCountInput);
    if (!Number.isFinite(next)) return;
    const normalized = Math.max(1, Math.min(8, Math.floor(next)));
    setImageCount(normalized);
    setIsEditingCustomCount(false);
    setCustomCountInput("");
  };

  const handleReferenceFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const remain = Math.max(0, 3 - referenceImages.length);
    if (remain === 0) return;

    const selectedFiles = Array.from(files)
      .filter((file) => file.type.startsWith("image/"))
      .slice(0, remain);

    if (selectedFiles.length === 0) return;

    const loaded = await Promise.all(
      selectedFiles.map(async (file) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: file.name,
        url: await fileToDataUrl(file),
      })),
    );

    setReferenceImages((prev) => [...prev, ...loaded].slice(0, 3));
  };

  const handleUploadChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    await handleReferenceFiles(event.target.files);
    event.target.value = "";
  };

  const handleGenerate = async () => {
    if (!canGenerate) return;

    const finalPrompt = activeSkill
      ? wrapTextWithSkill(prompt.trim())
      : prompt.trim();

    try {
      await generateImage(finalPrompt, {
        imageCount,
        referenceImages: referenceImages.map((item) => item.url),
        size: resolvedSize,
        targetProjectId: targetProjectId || undefined,
      });
      setPrompt("");
      clearActiveSkill();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (errorMessage !== IMAGE_GENERATION_CANCELED_MESSAGE) {
        console.error("图片生成失败:", error);
      }
    }
  };

  const handleCancelGeneration = () => {
    if (!generating) {
      return;
    }
    cancelGeneration();
    toast.info(IMAGE_GENERATION_CANCELED_MESSAGE);
  };

  const handleBackfillToResource = async () => {
    if (!targetProjectId) {
      toast.error("请先选择目标资源库");
      return;
    }

    try {
      const result = await backfillImagesToResource(targetProjectId);
      if (result.failed > 0) {
        toast.error(`补录完成：成功 ${result.saved}，失败 ${result.failed}`);
      } else {
        toast.success(`补录完成：新增 ${result.saved}，跳过 ${result.skipped}`);
      }

      if (result.errors.length > 0) {
        console.warn("[ImageGen] 历史补录失败详情:", result.errors);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`补录失败: ${message}`);
    }
  };

  const handlePromptKeyDown = (
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleGenerate();
    }
  };

  const goCredentialManagement = () => {
    onNavigate?.("settings", { tab: SettingsTabs.Providers });
  };

  return (
    <Container data-testid="ai-image-gen-layout">
      <ControlPanel>
        <PanelIntro>
          <PanelEyebrow>IMAGE STUDIO</PanelEyebrow>
          <PanelTitle>生成参数</PanelTitle>
          <PanelDescription>
            左侧集中管理模型、参考图与输出规格；主画布负责预览结果与继续迭代。
          </PanelDescription>
          <PanelMetaGrid>
            <PanelMetaCard>
              <PanelMetaLabel>当前服务</PanelMetaLabel>
              <PanelMetaValue>
                {selectedProvider?.name || "待配置"}
              </PanelMetaValue>
            </PanelMetaCard>
            <PanelMetaCard>
              <PanelMetaLabel>当前模型</PanelMetaLabel>
              <PanelMetaValue>{selectedModel?.name || "待选择"}</PanelMetaValue>
            </PanelMetaCard>
            <PanelMetaCard>
              <PanelMetaLabel>目标资源库</PanelMetaLabel>
              <PanelMetaValue>
                {selectedTargetProject?.name || "不自动入库"}
              </PanelMetaValue>
            </PanelMetaCard>
            <PanelMetaCard>
              <PanelMetaLabel>输出规格</PanelMetaLabel>
              <PanelMetaValue>{resolvedSize}</PanelMetaValue>
            </PanelMetaCard>
          </PanelMetaGrid>
        </PanelIntro>

        {availableProviders.length > 1 && (
          <Section>
            <SectionTitle>服务商</SectionTitle>
            <Select
              value={selectedProviderId || availableProviders[0]?.id || ""}
              onChange={(event) => setSelectedProviderId(event.target.value)}
              disabled={providersLoading}
            >
              {availableProviders.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </Select>
          </Section>
        )}

        <Section>
          <SectionTitle>
            模型
            <SmallButton onClick={goCredentialManagement} title="去凭证管理">
              <Settings size={14} />
            </SmallButton>
          </SectionTitle>
          <Select
            value={selectedModelId || availableModels[0]?.id || ""}
            onChange={(event) => setSelectedModelId(event.target.value)}
            disabled={!selectedProvider || availableModels.length === 0}
          >
            {availableModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </Select>
          <Hint>当前服务商：{selectedProvider?.name || "未选择"}</Hint>
        </Section>

        <Section>
          <SectionTitle>目标资源库</SectionTitle>
          <Select
            value={targetProjectId}
            onChange={(event) => setTargetProjectId(event.target.value)}
            disabled={projectsLoading}
          >
            <option value="">不自动入库</option>
            {availableProjects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </Select>
          <Hint>
            {targetProjectId
              ? `生成成功后会自动写入「${selectedTargetProject?.name || "已选项目"}」资源库`
              : "未启用自动入库，生成结果仅保存在当前页面历史"}
          </Hint>
          <FullButton
            type="button"
            onClick={() => {
              void handleBackfillToResource();
            }}
            $disabled={
              savingToResource || !targetProjectId || images.length === 0
            }
            disabled={
              savingToResource || !targetProjectId || images.length === 0
            }
          >
            {savingToResource ? "补录中..." : "补录历史到资源库"}
          </FullButton>
        </Section>

        <Section>
          <SectionTitle>参考图</SectionTitle>
          {referenceImages.length > 0 ? (
            <Thumbs>
              {referenceImages.map((item) => (
                <ThumbItem key={item.id} title={item.name}>
                  <img src={item.url} alt={item.name} />
                  <RemoveThumb
                    onClick={() => {
                      setReferenceImages((prev) =>
                        prev.filter((current) => current.id !== item.id),
                      );
                    }}
                  >
                    <X size={12} />
                  </RemoveThumb>
                </ThumbItem>
              ))}
            </Thumbs>
          ) : (
            <UploadBox
              $dragging={isDraggingUpload}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDraggingUpload(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                setIsDraggingUpload(false);
              }}
              onDrop={async (event) => {
                event.preventDefault();
                setIsDraggingUpload(false);
                await handleReferenceFiles(event.dataTransfer.files);
              }}
            >
              <UploadText>
                <ImagePlus size={24} style={{ marginBottom: 6 }} />
                <div>点击或拖拽上传图片</div>
                <div>支持最多 3 张图片</div>
              </UploadText>
            </UploadBox>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={handleUploadChange}
          />
          <Hint>
            {isFalProvider
              ? "Fal 上传参考图会启用图片编辑参数；Nano Banana 会优先尝试 /edit 接口。"
              : "上传参考图会随请求发送给模型，是否执行编辑由模型能力决定。"}
          </Hint>
        </Section>

        <Section>
          <SectionTitle>分辨率</SectionTitle>
          <Segment>
            {RESOLUTION_OPTIONS.map((option) => (
              <SegmentButton
                key={option.value}
                $active={resolutionPreset === option.value}
                onClick={() => setResolutionPreset(option.value)}
              >
                {option.label}
              </SegmentButton>
            ))}
          </Segment>
        </Section>

        <Section>
          <SectionTitle>宽高比</SectionTitle>
          <RatioGrid>
            {ASPECT_RATIO_OPTIONS.map((ratio) => (
              <RatioButton
                key={ratio}
                $active={aspectRatio === ratio}
                onClick={() => setAspectRatio(ratio)}
              >
                {ratio}
              </RatioButton>
            ))}
          </RatioGrid>
        </Section>

        <Section>
          <SectionTitle>图片数量</SectionTitle>
          {isEditingCustomCount ? (
            <CountInput
              type="number"
              min={1}
              max={8}
              value={customCountInput}
              onChange={(event) => setCustomCountInput(event.target.value)}
              onBlur={handleCustomCountConfirm}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  handleCustomCountConfirm();
                }
              }}
              autoFocus
            />
          ) : (
            <CountRow>
              {IMAGE_COUNT_PRESETS.map((count) => (
                <CountButton
                  key={count}
                  $active={imageCount === count}
                  onClick={() => handleCountSelect(count)}
                >
                  {count}
                </CountButton>
              ))}
              <CountButton
                $active={!IMAGE_COUNT_PRESETS.includes(imageCount)}
                onClick={() => {
                  setCustomCountInput(String(imageCount));
                  setIsEditingCustomCount(true);
                }}
              >
                +
              </CountButton>
            </CountRow>
          )}
        </Section>

        <Status>实际输出尺寸：{resolvedSize}</Status>
        {selectedImage?.status === "complete" && targetProjectId && (
          <Status>
            {selectedImage.resourceMaterialId &&
            selectedImage.resourceProjectId === targetProjectId
              ? "当前图片已同步到资源库"
              : selectedImage.resourceSaveError
                ? `当前图片入库失败：${selectedImage.resourceSaveError}`
                : savingToResource
                  ? "当前图片正在同步到资源库..."
                  : "当前图片尚未同步到资源库"}
          </Status>
        )}
      </ControlPanel>

      <Workspace>
        <CanvasPanel>
          <CanvasHeader>
            <CanvasHeaderCopy>
              <Eyebrow>AI IMAGE</Eyebrow>
              <CanvasLabel>生成结果</CanvasLabel>
            </CanvasHeaderCopy>
            <CanvasMetaRow>
              <CanvasMetaChip>{completedImageCount} 张已完成</CanvasMetaChip>
              {generatingImageCount > 0 && (
                <CanvasMetaChip>{generatingImageCount} 张生成中</CanvasMetaChip>
              )}
              <CanvasMetaChip>
                {selectedProvider?.name || "未配置服务"}
              </CanvasMetaChip>
            </CanvasMetaRow>
          </CanvasHeader>

          <Canvas>
            {shouldShowBatchGrid ? (
              <BatchGrid>
                {selectedBatchImages.map((item, index) => {
                  const parsedSize = parseSize(item.size);
                  const previewStyle = parsedSize
                    ? {
                        aspectRatio: `${parsedSize.width}/${parsedSize.height}`,
                      }
                    : undefined;

                  return (
                    <BatchItem
                      key={item.id}
                      $active={item.id === selectedImageId}
                      onClick={() => setSelectedImageId(item.id)}
                    >
                      <BatchPreviewWrap style={previewStyle}>
                        {item.status === "complete" && item.url ? (
                          <img
                            src={item.url}
                            alt={item.prompt || `生成图片 ${index + 1}`}
                          />
                        ) : (
                          <BatchPlaceholder>
                            {item.status === "error" ? (
                              <ImageIcon size={28} />
                            ) : (
                              <Loader2 size={28} className="animate-spin" />
                            )}
                            <span>{getStatusText(item.status)}</span>
                          </BatchPlaceholder>
                        )}
                      </BatchPreviewWrap>

                      <BatchMeta>
                        <span>第 {index + 1} 张</span>
                        <span>{getStatusText(item.status)}</span>
                      </BatchMeta>
                    </BatchItem>
                  );
                })}
              </BatchGrid>
            ) : selectedImage?.status === "complete" && selectedImage.url ? (
              <>
                <PreviewStage>
                  <PreviewImage
                    src={selectedImage.url}
                    alt={selectedImage.prompt}
                  />
                </PreviewStage>
                <CanvasActions>
                  <CanvasActionButton
                    title="在浏览器打开"
                    onClick={() => window.open(selectedImage.url, "_blank")}
                  >
                    <ExternalLink size={16} />
                  </CanvasActionButton>
                  <CanvasActionButton
                    title="删除"
                    onClick={() => deleteImage(selectedImage.id)}
                  >
                    <Trash2 size={16} />
                  </CanvasActionButton>
                </CanvasActions>
              </>
            ) : selectedImage?.status === "error" ? (
              <Empty>
                <ImageIcon size={52} />
                <h2>生成失败</h2>
                <div>{selectedImage.error || "请重试"}</div>
              </Empty>
            ) : (
              <Empty>
                {generating || selectedImage?.status === "generating" ? (
                  <Loader2 size={56} className="animate-spin" />
                ) : (
                  <Sparkles size={56} />
                )}
                <h2>
                  {generating || selectedImage?.status === "generating"
                    ? "正在生成图片"
                    : "等待生成结果"}
                </h2>
                <div>
                  {generating || selectedImage?.status === "generating"
                    ? "图片生成完成后会自动出现在这里，你可以继续修改提示词准备下一轮。"
                    : "提交图片任务后，最新结果会优先显示在这里。"}
                </div>
              </Empty>
            )}

            {shouldShowBatchGrid &&
              selectedImage?.status === "complete" &&
              selectedImage.url && (
                <CanvasActions>
                  <CanvasActionButton
                    title="在浏览器打开"
                    onClick={() => window.open(selectedImage.url, "_blank")}
                  >
                    <ExternalLink size={16} />
                  </CanvasActionButton>
                  <CanvasActionButton
                    title="删除"
                    onClick={() => deleteImage(selectedImage.id)}
                  >
                    <Trash2 size={16} />
                  </CanvasActionButton>
                </CanvasActions>
              )}
          </Canvas>
        </CanvasPanel>

        <PromptDock>
          {selectedPromptHistory && (
            <PromptHistoryDock>
              <PromptHistoryLabel>当前图片提示词</PromptHistoryLabel>
              <PromptHistoryChip
                $active={selectedPromptHistory === prompt.trim()}
                title={selectedPromptHistory}
                onClick={() => setPrompt(selectedPromptHistory)}
              >
                {selectedPromptHistory}
              </PromptHistoryChip>
            </PromptHistoryDock>
          )}

          {skills.length > 0 && (
            <CharacterMention
              characters={[]}
              skills={skills}
              inputRef={promptRef}
              value={prompt}
              onChange={setPrompt}
              onSelectSkill={setActiveSkill}
            />
          )}

          {activeSkill && (
            <SkillRow>
              <SkillBadge skill={activeSkill} onClear={clearActiveSkill} />
            </SkillRow>
          )}

          <PromptSurface>
            <PromptInput
              ref={promptRef}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={handlePromptKeyDown}
              placeholder="描述你想要生成的内容"
              disabled={!selectedProvider || !selectedModelId}
            />
            <GenerateButton
              $disabled={generating ? false : !canGenerate}
              onClick={generating ? handleCancelGeneration : handleGenerate}
              disabled={generating ? false : !canGenerate}
              aria-label={generating ? "停止生成" : "生成图片"}
              title={generating ? "停止当前任务" : "开始生成"}
            >
              {generating ? (
                <X size={18} />
              ) : (
                <Send size={18} />
              )}
            </GenerateButton>
          </PromptSurface>
        </PromptDock>

        {!selectedProvider && (
          <Status>
            当前没有可用绘画服务，请先到凭证管理添加可用 Provider。
          </Status>
        )}
      </Workspace>

      <HistorySidebar>
        <HistoryHeader>
          <HistoryTitle>历史</HistoryTitle>
        </HistoryHeader>

        <HistoryNewButton
          title="新建图片"
          onClick={() => {
            newImage();
          }}
        >
          <Plus size={18} />
        </HistoryNewButton>

        <HistoryList>
          {images.map((image) => (
            <HistoryItem
              key={image.id}
              $active={image.id === selectedImageId}
              role="button"
              tabIndex={0}
              title={image.prompt || "历史图片"}
              onClick={() => setSelectedImageId(image.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSelectedImageId(image.id);
                }
              }}
            >
              {image.status === "complete" && image.url ? (
                <img src={image.url} alt={image.prompt || "历史图片"} />
              ) : (
                <HistoryPlaceholder>
                  {image.status === "generating" ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <ImageIcon size={16} />
                  )}
                </HistoryPlaceholder>
              )}

              {image.status !== "generating" && (
                <HistoryDeleteButton
                  title="删除"
                  onClick={(event) => {
                    event.stopPropagation();
                    deleteImage(image.id);
                  }}
                >
                  <Trash2 size={10} />
                </HistoryDeleteButton>
              )}
            </HistoryItem>
          ))}

          {images.length === 0 && <HistoryEmpty>暂无历史</HistoryEmpty>}
        </HistoryList>
      </HistorySidebar>
    </Container>
  );
}

export default AiImageGenTab;
