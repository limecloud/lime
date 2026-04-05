import React, { memo, KeyboardEvent, useMemo, useRef } from "react";
import styled from "styled-components";
import { Sparkles } from "lucide-react";
import { VideoCanvasState } from "./types";
import { CharacterMention } from "@/components/agent/chat/skill-selection/CharacterMention";
import { SkillBadge } from "@/components/agent/chat/skill-selection/SkillBadge";
import { useActiveSkill } from "@/components/agent/chat/skill-selection/useActiveSkill";
import type { Skill } from "@/lib/api/skills";

interface PromptInputProps {
  state: VideoCanvasState;
  onStateChange: (state: VideoCanvasState) => void;
  onGenerate: (textOverride?: string) => void;
  skills?: Skill[];
}

const PromptWrapper = styled.div`
  width: 100%;
`;

const InputShell = styled.div`
  width: 100%;
  border-radius: 28px;
  border: 1px solid hsl(var(--border) / 0.8);
  background: linear-gradient(
    180deg,
    hsl(var(--background) / 0.98),
    hsl(var(--background) / 0.94)
  );
  box-shadow:
    0 24px 60px hsl(215 40% 10% / 0.08),
    inset 0 1px 0 hsl(0 0% 100% / 0.75);
  padding: 18px 18px 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  backdrop-filter: blur(18px);
`;

const InputHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
`;

const HeaderContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const Eyebrow = styled.span`
  display: inline-flex;
  align-items: center;
  width: fit-content;
  border-radius: 999px;
  border: 1px solid hsl(203 82% 88%);
  background: hsl(200 100% 97%);
  padding: 6px 10px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: hsl(211 58% 38%);
`;

const InputTitle = styled.h2`
  margin: 0;
  font-size: clamp(22px, 3vw, 30px);
  line-height: 1.15;
  font-weight: 700;
  color: hsl(var(--foreground));
`;

const InputDescription = styled.p`
  margin: 0;
  font-size: 14px;
  line-height: 1.65;
  color: hsl(var(--muted-foreground));
  max-width: 720px;
`;

const MetaRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
`;

const MetaChip = styled.span`
  display: inline-flex;
  align-items: center;
  height: 32px;
  border-radius: 999px;
  border: 1px solid hsl(var(--border) / 0.85);
  background: hsl(var(--muted) / 0.18);
  padding: 0 12px;
  font-size: 12px;
  font-weight: 600;
  color: hsl(var(--muted-foreground));
`;

const ActiveSkillRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin: -4px 0 2px;
`;

const TextareaSurface = styled.div`
  border-radius: 22px;
  border: 1px solid hsl(var(--border) / 0.8);
  background: linear-gradient(
    180deg,
    hsl(var(--background)),
    hsl(var(--muted) / 0.12)
  );
  padding: 14px 16px 8px;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    transform 0.2s ease;

  &:focus-within {
    border-color: hsl(214 68% 38% / 0.35);
    box-shadow: 0 0 0 4px hsl(211 100% 96%);
  }
`;

const StyledTextarea = styled.textarea`
  width: 100%;
  min-height: 132px;
  max-height: 260px;
  border: none;
  background: transparent;
  resize: none;
  padding: 0;
  font-size: 15px;
  line-height: 1.8;
  color: hsl(var(--foreground));
  outline: none;

  &::placeholder {
    color: hsl(var(--muted-foreground));
  }
`;

const FooterRow = styled.div`
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
`;

const InputHint = styled.p`
  margin: 0;
  max-width: 560px;
  font-size: 13px;
  line-height: 1.6;
  color: hsl(var(--muted-foreground));
`;

const GenerateButton = styled.button<{ $generating?: boolean }>`
  flex-shrink: 0;
  min-width: 142px;
  height: 48px;
  border-radius: 16px;
  border: 1px solid
    ${(props) =>
      props.$generating ? "hsl(var(--border))" : "hsl(215 28% 17% / 0.92)"};
  background: ${(props) =>
    props.$generating
      ? "hsl(var(--muted) / 0.75)"
      : "linear-gradient(180deg, hsl(221 39% 16%), hsl(216 34% 12%))"};
  color: ${(props) =>
    props.$generating
      ? "hsl(var(--muted-foreground))"
      : "hsl(var(--background))"};
  padding: 0 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 700;
  cursor: ${(props) => (props.$generating ? "not-allowed" : "pointer")};
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease,
    opacity 0.2s ease;
  box-shadow: ${(props) =>
    props.$generating ? "none" : "0 14px 32px hsl(220 40% 12% / 0.16)"};

  &:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 18px 36px hsl(220 40% 12% / 0.2);
  }

  &:disabled {
    opacity: 0.72;
    cursor: not-allowed;
  }
`;

export const PromptInput: React.FC<PromptInputProps> = memo(
  ({ state, onStateChange, onGenerate, skills = [] }) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const { activeSkill, setActiveSkill, wrapTextWithSkill, clearActiveSkill } =
      useActiveSkill();

    const promptMeta = useMemo(() => {
      const referenceCount = [state.startImage, state.endImage].filter(
        Boolean,
      ).length;
      return [
        state.model ? `模型 ${state.model}` : "待选择模型",
        `${state.aspectRatio} · ${state.resolution}`,
        `${state.duration}s`,
        referenceCount > 0 ? `${referenceCount} 张参考图` : "纯文生视频",
      ];
    }, [
      state.aspectRatio,
      state.duration,
      state.endImage,
      state.model,
      state.resolution,
      state.startImage,
    ]);

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (state.prompt.trim() && state.status !== "generating") {
          handleGenerate();
        }
      }
    };

    const handleGenerate = () => {
      const text = activeSkill ? wrapTextWithSkill(state.prompt) : undefined;
      onGenerate(text);
      clearActiveSkill();
    };

    return (
      <PromptWrapper>
        <InputShell>
          <InputHeader>
            <HeaderContent>
              <Eyebrow>VIDEO STUDIO</Eyebrow>
              <InputTitle>描述你想生成的画面、镜头与节奏</InputTitle>
              <InputDescription>
                先写主体、场景和运动方式，再补充光线、氛围或镜头语言，生成结果会自动回流到项目素材。
              </InputDescription>
            </HeaderContent>
            <MetaRow>
              {promptMeta.map((item) => (
                <MetaChip key={item}>{item}</MetaChip>
              ))}
            </MetaRow>
          </InputHeader>

          {skills.length > 0 ? (
            <CharacterMention
              characters={[]}
              skills={skills}
              inputRef={textareaRef}
              value={state.prompt}
              onChange={(val) => onStateChange({ ...state, prompt: val })}
              onSelectSkill={setActiveSkill}
            />
          ) : null}

          {activeSkill ? (
            <ActiveSkillRow>
              <SkillBadge skill={activeSkill} onClear={clearActiveSkill} />
            </ActiveSkillRow>
          ) : null}

          <TextareaSurface>
            <StyledTextarea
              ref={textareaRef}
              value={state.prompt}
              onChange={(e) => {
                onStateChange({ ...state, prompt: e.target.value });
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(e.target.scrollHeight, 260)}px`;
              }}
              onKeyDown={handleKeyDown}
              placeholder="例如：黄昏海边，女孩沿着潮湿木栈道慢跑，镜头低机位跟拍后缓慢拉远，风吹起外套边角，整体偏电影感与暖金色。"
              rows={1}
            />
          </TextareaSurface>

          <FooterRow>
            <InputHint>
              按 Enter 直接生成，Shift + Enter 换行；输入 <code>@</code>{" "}
              可以插入技能辅助改写提示词。
            </InputHint>
            <GenerateButton
              disabled={!state.prompt.trim() || state.status === "generating"}
              $generating={state.status === "generating"}
              onClick={handleGenerate}
            >
              <Sparkles size={18} />
              {state.status === "generating" ? "生成中" : "生成视频"}
            </GenerateButton>
          </FooterRow>
        </InputShell>
      </PromptWrapper>
    );
  },
);

PromptInput.displayName = "PromptInput";
