/**
 * @file 内容评审侧栏
 * @description 提供专家选择和自定义专家弹层
 * @module components/workspace/document/ContentReviewPanel
 */

import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import styled from "styled-components";
import { ArrowLeft, Check, Plus, Upload, X } from "lucide-react";
import { Modal } from "@/components/Modal";
import { parseAIResponse } from "@/components/workspace/a2ui/parser";
import type { A2UIResponse } from "@/components/workspace/a2ui/types";
import { REVIEW_A2UI_TASK_CARD_PRESET } from "@/components/workspace/a2ui/taskCardPresets";
import {
  A2UITaskCard,
  A2UITaskLoadingCard,
} from "@/components/agent/chat/components/A2UITaskCard";
import type {
  ContentReviewExpert,
  CustomContentReviewExpertInput,
} from "./types";

const SIDEBAR_WIDTH = 320;

const SidebarShell = styled.aside<{ $open: boolean }>`
  width: ${({ $open }) => ($open ? `${SIDEBAR_WIDTH}px` : "0")};
  min-width: ${({ $open }) => ($open ? `${SIDEBAR_WIDTH}px` : "0")};
  border-left: ${({ $open }) =>
    $open ? "1px solid hsl(var(--border))" : "1px solid transparent"};
  background: hsl(var(--background));
  overflow: hidden;
  transition:
    width 0.22s ease,
    min-width 0.22s ease,
    border-color 0.22s ease;
`;

const SidebarInner = styled.div<{ $open: boolean }>`
  display: flex;
  flex-direction: column;
  width: ${SIDEBAR_WIDTH}px;
  height: 100%;
  opacity: ${({ $open }) => ($open ? 1 : 0)};
  pointer-events: ${({ $open }) => ($open ? "auto" : "none")};
  transition: opacity 0.16s ease;
`;

const SidebarHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 20px 18px 14px;
  border-bottom: 1px solid hsl(var(--border));
`;

const HeaderContent = styled.div`
  min-width: 0;
`;

const HeaderTitle = styled.h3`
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: hsl(var(--foreground));
`;

const HeaderSubtitle = styled.p`
  margin: 4px 0 0;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
`;

const HeaderActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const LinkButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 0;
  padding: 0;
  background: transparent;
  color: hsl(var(--primary));
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;

  &:hover {
    opacity: 0.88;
  }
`;

const CloseButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: hsl(var(--muted-foreground));
  cursor: pointer;

  &:hover {
    background: hsl(var(--muted) / 0.6);
    color: hsl(var(--foreground));
  }
`;

const ExpertList = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const ExpertCard = styled.button<{ $selected: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  padding: 14px;
  border-radius: 16px;
  border: 1px solid
    ${({ $selected }) =>
      $selected ? "hsl(var(--primary))" : "hsl(var(--border))"};
  background: ${({ $selected }) =>
    $selected ? "hsl(var(--primary) / 0.04)" : "hsl(var(--background))"};
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    background 0.2s ease,
    box-shadow 0.2s ease,
    transform 0.2s ease;

  &:hover {
    border-color: hsl(var(--primary) / 0.55);
    box-shadow: 0 10px 24px rgba(59, 130, 246, 0.08);
    transform: translateY(-1px);
  }
`;

const ExpertHeader = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 12px;
`;

const Avatar = styled.div<{ $color: string }>`
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: ${({ $color }) => $color};
  color: #fff;
  font-size: 16px;
  font-weight: 700;
  overflow: hidden;
`;

const AvatarImage = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
`;

const ExpertMeta = styled.div`
  flex: 1;
  min-width: 0;
`;

const ExpertNameRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
`;

const ExpertName = styled.span`
  display: inline-block;
  max-width: 100%;
  font-size: 14px;
  font-weight: 700;
  color: hsl(var(--foreground));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Badge = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
`;

const ExpertTitle = styled.p`
  margin: 4px 0 0;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
`;

const SelectIndicator = styled.span<{ $selected: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 999px;
  border: 1px solid
    ${({ $selected }) =>
      $selected ? "hsl(var(--primary))" : "hsl(var(--border))"};
  background: ${({ $selected }) =>
    $selected ? "hsl(var(--primary))" : "transparent"};
  color: ${({ $selected }) =>
    $selected ? "hsl(var(--primary-foreground))" : "transparent"};
  transition: all 0.2s ease;
  flex-shrink: 0;
`;

const TagList = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`;

const Tag = styled.span`
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: hsl(var(--muted) / 0.72);
  color: hsl(var(--primary));
  font-size: 11px;
  font-weight: 500;
`;

const ExpertDescription = styled.p`
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: hsl(var(--muted-foreground));
`;

const ReviewStateCard = styled.div<{ $tone?: "default" | "error" }>`
  margin: 0 14px 14px;
  padding: 14px;
  border-radius: 14px;
  border: 1px solid
    ${({ $tone }) =>
      $tone === "error" ? "hsl(0 84% 60% / 0.24)" : "hsl(var(--border))"};
  background: ${({ $tone }) =>
    $tone === "error" ? "hsl(0 84% 60% / 0.06)" : "hsl(var(--muted) / 0.32)"};
`;

const ReviewStateTitle = styled.div`
  font-size: 13px;
  font-weight: 700;
  color: hsl(var(--foreground));
`;

const ReviewStateText = styled.div`
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.7;
  color: hsl(var(--muted-foreground));
  white-space: pre-wrap;
  word-break: break-word;
`;

const ReviewStateContent = styled.div`
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const ReviewStructuredHint = styled.div`
  padding: 8px 10px;
  border-radius: 10px;
  background: hsl(var(--primary) / 0.08);
  color: hsl(var(--primary));
  font-size: 12px;
  line-height: 1.5;
`;

const ReviewA2UIPreview = styled.div`
  overflow: hidden;
`;

const SidebarFooter = styled.div`
  padding: 14px 14px 18px;
  border-top: 1px solid hsl(var(--border));
  background: hsl(var(--background));
`;

const StartButton = styled.button`
  width: 100%;
  height: 42px;
  border: 0;
  border-radius: 12px;
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: opacity 0.2s ease;

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
`;

const DialogBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 18px 20px 20px;
  background: hsl(var(--background));
`;

const BackButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: fit-content;
  border: 0;
  padding: 0;
  background: transparent;
  color: hsl(var(--muted-foreground));
  font-size: 14px;
  cursor: pointer;

  &:hover {
    color: hsl(var(--foreground));
  }
`;

const UploadArea = styled.button<{ $hasImage: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 120px;
  height: 120px;
  margin: 0 auto;
  border-radius: 18px;
  border: 1.5px dashed hsl(var(--primary));
  background: ${({ $hasImage }) =>
    $hasImage ? "hsl(var(--muted) / 0.24)" : "transparent"};
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  overflow: hidden;
`;

const UploadIconWrap = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 12px;
  background: hsl(var(--muted) / 0.7);
  color: hsl(var(--primary));
`;

const UploadHint = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
`;

const UploadTitle = styled.span`
  font-size: 14px;
  font-weight: 600;
  color: hsl(var(--muted-foreground));
`;

const UploadDesc = styled.span`
  font-size: 12px;
  color: hsl(var(--muted-foreground));
`;

const HiddenInput = styled.input`
  display: none;
`;

const FormGroup = styled.label`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const FieldLabel = styled.span`
  font-size: 14px;
  font-weight: 600;
  color: hsl(var(--foreground));
`;

const TextInput = styled.input`
  height: 44px;
  border: 1px solid hsl(var(--border));
  border-radius: 12px;
  padding: 0 14px;
  font-size: 14px;
  background: hsl(var(--background));
  color: hsl(var(--foreground));

  &::placeholder {
    color: hsl(var(--muted-foreground));
  }

  &:focus {
    outline: none;
    border-color: hsl(var(--primary));
    box-shadow: 0 0 0 3px hsl(var(--primary) / 0.12);
  }
`;

const TextArea = styled.textarea`
  min-height: 112px;
  resize: none;
  border: 1px solid hsl(var(--border));
  border-radius: 12px;
  padding: 12px 14px;
  font-size: 14px;
  line-height: 1.6;
  background: hsl(var(--background));
  color: hsl(var(--foreground));

  &::placeholder {
    color: hsl(var(--muted-foreground));
  }

  &:focus {
    outline: none;
    border-color: hsl(var(--primary));
    box-shadow: 0 0 0 3px hsl(var(--primary) / 0.12);
  }
`;

const DialogActions = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
`;

const SecondaryButton = styled.button`
  height: 42px;
  border-radius: 12px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
`;

const PrimaryButton = styled.button`
  height: 42px;
  border: 0;
  border-radius: 12px;
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: opacity 0.2s ease;

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
`;

interface CustomReviewExpertDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (input: CustomContentReviewExpertInput) => void;
}

const CustomReviewExpertDialog: React.FC<CustomReviewExpertDialogProps> = memo(
  ({ open, onClose, onConfirm }) => {
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [avatarImageUrl, setAvatarImageUrl] = useState<string | undefined>(
      undefined,
    );
    const inputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
      if (open) {
        return;
      }
      setName("");
      setDescription("");
      setAvatarImageUrl(undefined);
    }, [open]);

    const handleUploadClick = useCallback(() => {
      inputRef.current?.click();
    }, []);

    const handleFileChange = useCallback(
      (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) {
          return;
        }

        if (!["image/jpeg", "image/png"].includes(file.type)) {
          return;
        }

        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === "string") {
            setAvatarImageUrl(reader.result);
          }
        };
        reader.readAsDataURL(file);
      },
      [],
    );

    const formValid = name.trim().length > 0 && description.trim().length > 0;

    const handleConfirm = useCallback(() => {
      if (!formValid) {
        return;
      }

      onConfirm({
        name,
        description,
        avatarImageUrl,
      });
    }, [avatarImageUrl, description, formValid, name, onConfirm]);

    return (
      <Modal
        isOpen={open}
        onClose={onClose}
        showCloseButton={false}
        maxWidth="max-w-[360px]"
        className="overflow-hidden rounded-3xl p-0"
      >
        <DialogBody>
          <BackButton type="button" onClick={onClose}>
            <ArrowLeft size={16} />
            返回列表
          </BackButton>

          <UploadArea
            type="button"
            onClick={handleUploadClick}
            $hasImage={Boolean(avatarImageUrl)}
          >
            {avatarImageUrl ? (
              <AvatarImage src={avatarImageUrl} alt="自定义专家头像" />
            ) : (
              <>
                <UploadIconWrap>
                  <Upload size={18} />
                </UploadIconWrap>
                <UploadHint>
                  <UploadTitle>设定形象</UploadTitle>
                  <UploadDesc>支持 JPG、PNG 格式</UploadDesc>
                </UploadHint>
              </>
            )}
          </UploadArea>
          <HiddenInput
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png"
            onChange={handleFileChange}
          />

          <FormGroup>
            <FieldLabel>评审人名称</FieldLabel>
            <TextInput
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：资深产品经理"
            />
          </FormGroup>

          <FormGroup>
            <FieldLabel>背景描述</FieldLabel>
            <TextArea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="描述专家的专业背景或评审侧重点..."
            />
          </FormGroup>

          <DialogActions>
            <SecondaryButton type="button" onClick={onClose}>
              取消
            </SecondaryButton>
            <PrimaryButton
              type="button"
              onClick={handleConfirm}
              disabled={!formValid}
            >
              确认使用
            </PrimaryButton>
          </DialogActions>
        </DialogBody>
      </Modal>
    );
  },
);

CustomReviewExpertDialog.displayName = "CustomReviewExpertDialog";

export interface ContentReviewPanelProps {
  /** 是否展示侧栏 */
  open: boolean;
  /** 专家列表 */
  experts: ContentReviewExpert[];
  /** 已选中的专家 ID */
  selectedExpertIds: string[];
  /** 专家切换 */
  onToggleExpert: (expertId: string) => void;
  /** 关闭侧栏 */
  onClose: () => void;
  /** 创建自定义专家 */
  onCreateExpert: (input: CustomContentReviewExpertInput) => void;
  /** 开始深度评审 */
  onStartReview?: () => void;
  /** 是否正在评审 */
  reviewRunning?: boolean;
  /** 评审结果 */
  reviewResult?: string;
  /** 评审错误 */
  reviewError?: string;
}

export const ContentReviewPanel: React.FC<ContentReviewPanelProps> = memo(
  ({
    open,
    experts,
    selectedExpertIds,
    onToggleExpert,
    onClose,
    onCreateExpert,
    onStartReview,
    reviewRunning = false,
    reviewResult = "",
    reviewError = "",
  }) => {
    const [dialogOpen, setDialogOpen] = useState(false);
    const selectedSet = useMemo(
      () => new Set(selectedExpertIds),
      [selectedExpertIds],
    );
    const parsedReviewResult = useMemo(() => {
      if (!reviewResult.trim()) {
        return null;
      }
      return parseAIResponse(reviewResult, false);
    }, [reviewResult]);

    useEffect(() => {
      if (!open) {
        setDialogOpen(false);
      }
    }, [open]);

    const handleCreateExpert = useCallback(
      (input: CustomContentReviewExpertInput) => {
        onCreateExpert(input);
        setDialogOpen(false);
      },
      [onCreateExpert],
    );

    const selectedCount = selectedExpertIds.length;

    const renderReviewResult = useCallback(() => {
      if (
        !parsedReviewResult ||
        (!parsedReviewResult.hasA2UI && !parsedReviewResult.hasPending)
      ) {
        return <ReviewStateText>{reviewResult}</ReviewStateText>;
      }

      return (
        <ReviewStateContent>
          <ReviewStructuredHint>
            检测到结构化补充信息，右侧栏已按结构化内容展示，不再直接输出原始
            A2UI 代码块。
          </ReviewStructuredHint>
          {parsedReviewResult.parts.map((part, index) => {
            if (part.type === "a2ui" && typeof part.content !== "string") {
              const readonlyResponse: A2UIResponse = {
                ...part.content,
                submitAction: undefined,
              };
              return (
                <ReviewA2UIPreview key={`review-a2ui-${index}`}>
                  <A2UITaskCard
                    response={readonlyResponse}
                    compact={true}
                    preview={true}
                    preset={REVIEW_A2UI_TASK_CARD_PRESET}
                  />
                </ReviewA2UIPreview>
              );
            }

            if (part.type === "pending_a2ui") {
              return (
                <A2UITaskLoadingCard
                  key={`review-pending-a2ui-${index}`}
                  compact={true}
                  preset={REVIEW_A2UI_TASK_CARD_PRESET}
                  subtitle="评审结果正在解析结构化字段。"
                />
              );
            }

            const textContent =
              typeof part.content === "string" ? part.content.trim() : "";
            if (!textContent) {
              return null;
            }

            return (
              <ReviewStateText key={`review-text-${index}`}>
                {textContent}
              </ReviewStateText>
            );
          })}
        </ReviewStateContent>
      );
    }, [parsedReviewResult, reviewResult]);

    return (
      <>
        <SidebarShell $open={open} aria-hidden={!open}>
          <SidebarInner $open={open}>
            <SidebarHeader>
              <HeaderContent>
                <HeaderTitle>评审专家团</HeaderTitle>
                <HeaderSubtitle>评审模式</HeaderSubtitle>
              </HeaderContent>
              <HeaderActions>
                <LinkButton type="button" onClick={() => setDialogOpen(true)}>
                  <Plus size={14} />
                  自定义专家角色
                </LinkButton>
                <CloseButton
                  type="button"
                  onClick={onClose}
                  aria-label="关闭评审专家团"
                >
                  <X size={16} />
                </CloseButton>
              </HeaderActions>
            </SidebarHeader>

            <ExpertList>
              {experts.map((expert) => {
                const selected = selectedSet.has(expert.id);

                return (
                  <ExpertCard
                    key={expert.id}
                    type="button"
                    $selected={selected}
                    onClick={() => onToggleExpert(expert.id)}
                  >
                    <ExpertHeader>
                      <Avatar $color={expert.avatarColor}>
                        {expert.avatarImageUrl ? (
                          <AvatarImage
                            src={expert.avatarImageUrl}
                            alt={`${expert.name} 头像`}
                          />
                        ) : (
                          expert.avatarLabel
                        )}
                      </Avatar>
                      <ExpertMeta>
                        <ExpertNameRow>
                          <ExpertName>{expert.name}</ExpertName>
                          {expert.badgeText ? (
                            <Badge>{expert.badgeText}</Badge>
                          ) : null}
                        </ExpertNameRow>
                        <ExpertTitle>{expert.title}</ExpertTitle>
                      </ExpertMeta>
                      <SelectIndicator $selected={selected}>
                        <Check size={14} />
                      </SelectIndicator>
                    </ExpertHeader>

                    <TagList>
                      {expert.tags.map((tag) => (
                        <Tag key={`${expert.id}-${tag}`}>{tag}</Tag>
                      ))}
                    </TagList>

                    <ExpertDescription>{expert.description}</ExpertDescription>
                  </ExpertCard>
                );
              })}
            </ExpertList>

            {reviewRunning ? (
              <ReviewStateCard>
                <ReviewStateTitle>评审进行中</ReviewStateTitle>
                <ReviewStateText>
                  正在组织专家视角并生成深度评审，请稍候...
                </ReviewStateText>
              </ReviewStateCard>
            ) : null}

            {!reviewRunning && reviewError ? (
              <ReviewStateCard $tone="error">
                <ReviewStateTitle>评审失败</ReviewStateTitle>
                <ReviewStateText>{reviewError}</ReviewStateText>
              </ReviewStateCard>
            ) : null}

            {!reviewRunning && !reviewError && reviewResult ? (
              <ReviewStateCard>
                <ReviewStateTitle>评审结果</ReviewStateTitle>
                {renderReviewResult()}
              </ReviewStateCard>
            ) : null}

            <SidebarFooter>
              <StartButton
                type="button"
                onClick={onStartReview}
                disabled={selectedCount === 0 || reviewRunning}
              >
                {reviewRunning
                  ? "深度评审中..."
                  : `开始深度评审 (${selectedCount})`}
              </StartButton>
            </SidebarFooter>
          </SidebarInner>
        </SidebarShell>

        <CustomReviewExpertDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          onConfirm={handleCreateExpert}
        />
      </>
    );
  },
);

ContentReviewPanel.displayName = "ContentReviewPanel";
