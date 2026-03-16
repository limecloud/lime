/**
 * 启动画面组件
 *
 * 应用启动时显示 Logo 动画，然后淡出进入主界面
 */

import { useEffect, useState } from "react";
import styled, { keyframes } from "styled-components";

const sceneEnter = keyframes`
  from { opacity: 0; transform: scale(0.985); }
  to { opacity: 1; transform: scale(1); }
`;

const sceneExit = keyframes`
  from { opacity: 1; transform: scale(1); }
  to { opacity: 0; transform: scale(1.015); }
`;

const panelFloat = keyframes`
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
`;

const pulse = keyframes`
  0%, 100% { opacity: 0.56; }
  50% { opacity: 1; }
`;

const progress = keyframes`
  0% { transform: translateX(-42%) scaleX(0.72); opacity: 0.55; }
  50% { transform: translateX(12%) scaleX(1); opacity: 1; }
  100% { transform: translateX(78%) scaleX(0.82); opacity: 0.55; }
`;

const orbShift = keyframes`
  0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
  50% { transform: translate3d(10px, -12px, 0) scale(1.06); }
`;

const Container = styled.div<{ $isExiting: boolean }>`
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background:
    radial-gradient(circle at 16% 18%, rgba(56, 189, 248, 0.12), transparent 32%),
    radial-gradient(circle at 84% 12%, rgba(16, 185, 129, 0.1), transparent 30%),
    radial-gradient(circle at 72% 82%, rgba(245, 158, 11, 0.08), transparent 26%),
    linear-gradient(
      135deg,
      hsl(var(--background)) 0%,
      hsl(var(--muted) / 0.84) 48%,
      hsl(var(--background)) 100%
    );
  z-index: 9999;
  animation: ${({ $isExiting }) => ($isExiting ? sceneExit : sceneEnter)} 0.55s
    ease-out forwards;
`;

const AmbientOrb = styled.div<{
  $size: number;
  $top?: string;
  $right?: string;
  $bottom?: string;
  $left?: string;
  $color: string;
  $delay?: string;
}>`
  position: absolute;
  width: ${({ $size }) => `${$size}px`};
  height: ${({ $size }) => `${$size}px`};
  top: ${({ $top }) => $top ?? "auto"};
  right: ${({ $right }) => $right ?? "auto"};
  bottom: ${({ $bottom }) => $bottom ?? "auto"};
  left: ${({ $left }) => $left ?? "auto"};
  border-radius: 999px;
  background: ${({ $color }) => $color};
  filter: blur(26px);
  opacity: 0.8;
  animation: ${orbShift} 11s ease-in-out infinite;
  animation-delay: ${({ $delay }) => $delay ?? "0s"};
  pointer-events: none;
`;

const Stage = styled.div`
  position: relative;
  z-index: 1;
  width: min(560px, calc(100vw - 32px));
`;

const Panel = styled.div`
  position: relative;
  overflow: hidden;
  border: 1px solid hsl(var(--border) / 0.78);
  border-radius: 32px;
  padding: 32px;
  background:
    linear-gradient(
      180deg,
      hsl(var(--card) / 0.94) 0%,
      hsl(var(--card) / 0.84) 100%
    );
  backdrop-filter: blur(18px);
  box-shadow:
    0 26px 80px rgba(15, 23, 42, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.36);
  animation: ${panelFloat} 5.5s ease-in-out infinite;

  @media (max-width: 640px) {
    padding: 24px 20px;
    border-radius: 28px;
  }
`;

const PanelGlow = styled.div`
  position: absolute;
  inset: auto -120px -120px auto;
  width: 240px;
  height: 240px;
  border-radius: 999px;
  background: radial-gradient(circle, rgba(56, 189, 248, 0.12), transparent 66%);
  pointer-events: none;
`;

const HeaderPill = styled.div`
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  border: 1px solid hsl(var(--border) / 0.72);
  background: hsl(var(--card) / 0.92);
  padding: 6px 12px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.18em;
  color: hsl(var(--muted-foreground));
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.04);
`;

const Hero = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  gap: 20px;
  margin-top: 18px;

  @media (max-width: 640px) {
    flex-direction: column;
    align-items: flex-start;
  }
`;

const LogoWrap = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 108px;
  height: 108px;
  border-radius: 28px;
  border: 1px solid hsl(var(--border) / 0.75);
  background:
    linear-gradient(
      180deg,
      hsl(var(--card)) 0%,
      hsl(var(--muted) / 0.74) 100%
    );
  box-shadow:
    0 18px 34px rgba(15, 23, 42, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.42);

  @media (max-width: 640px) {
    width: 96px;
    height: 96px;
    border-radius: 24px;
  }
`;

const Logo = styled.img`
  width: 72px;
  height: 72px;
  object-fit: contain;
  filter: drop-shadow(0 16px 28px rgba(15, 23, 42, 0.16));

  @media (max-width: 640px) {
    width: 64px;
    height: 64px;
  }
`;

const CopyBlock = styled.div`
  flex: 1;
  min-width: 0;
`;

const AppName = styled.h1`
  margin: 0;
  font-size: 38px;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: hsl(var(--foreground));

  @media (max-width: 640px) {
    font-size: 32px;
  }
`;

const Subtitle = styled.p`
  margin: 10px 0 0;
  font-size: 14px;
  line-height: 1.7;
  color: hsl(var(--muted-foreground));
`;

const MetaRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 24px;
`;

const MetaPill = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border-radius: 999px;
  border: 1px solid hsl(var(--border) / 0.72);
  background: hsl(var(--card) / 0.88);
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
`;

const Dot = styled.span`
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: rgba(14, 165, 233, 0.85);
  animation: ${pulse} 1.5s ease-in-out infinite;
`;

const LoadingArea = styled.div`
  margin-top: 26px;
  padding-top: 22px;
  border-top: 1px solid hsl(var(--border) / 0.7);
`;

const ProgressTrack = styled.div`
  position: relative;
  overflow: hidden;
  width: 100%;
  height: 6px;
  border-radius: 999px;
  background: hsl(var(--muted) / 0.92);
`;

const ProgressBar = styled.div`
  position: absolute;
  inset: 0 auto 0 0;
  width: 46%;
  border-radius: inherit;
  background:
    linear-gradient(
      90deg,
      rgba(56, 189, 248, 0.82) 0%,
      rgba(16, 185, 129, 0.72) 100%
    );
  animation: ${progress} 1.8s ease-in-out infinite;
`;

const LoadingRow = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-top: 14px;

  @media (max-width: 640px) {
    flex-direction: column;
    align-items: flex-start;
  }
`;

const LoadingText = styled.p`
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: hsl(var(--foreground));
`;

const LoadingHint = styled.p`
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: hsl(var(--muted-foreground));
  animation: ${pulse} 1.8s ease-in-out infinite;
`;

interface SplashScreenProps {
  onComplete: () => void;
  duration?: number;
}

export function SplashScreen({
  onComplete,
  duration = 1500,
}: SplashScreenProps) {
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    const exitTimer = setTimeout(() => {
      setIsExiting(true);
    }, duration);

    const completeTimer = setTimeout(() => {
      onComplete();
    }, duration + 500);

    return () => {
      clearTimeout(exitTimer);
      clearTimeout(completeTimer);
    };
  }, [duration, onComplete]);

  return (
    <Container $isExiting={isExiting}>
      <AmbientOrb
        $size={220}
        $top="-40px"
        $left="-28px"
        $color="rgba(56, 189, 248, 0.22)"
      />
      <AmbientOrb
        $size={260}
        $top="8%"
        $right="-60px"
        $color="rgba(16, 185, 129, 0.18)"
        $delay="-2.2s"
      />
      <AmbientOrb
        $size={220}
        $bottom="-54px"
        $left="18%"
        $color="rgba(245, 158, 11, 0.14)"
        $delay="-4.1s"
      />

      <Stage>
        <Panel>
          <PanelGlow />
          <HeaderPill>CREATIVE WORKBENCH</HeaderPill>

          <Hero>
            <LogoWrap>
              <Logo src="/logo.png" alt="ProxyCast" />
            </LogoWrap>

            <CopyBlock>
              <AppName>ProxyCast</AppName>
              <Subtitle>
                正在准备创作工作台与本地运行状态，保持当前节奏，不打断你的上下文。
              </Subtitle>
            </CopyBlock>
          </Hero>

          <MetaRow>
            <MetaPill>
              <Dot />
              本地优先
            </MetaPill>
            <MetaPill>
              <Dot />
              创作工作台
            </MetaPill>
            <MetaPill>
              <Dot />
              启动中
            </MetaPill>
          </MetaRow>

          <LoadingArea>
            <ProgressTrack>
              <ProgressBar />
            </ProgressTrack>

            <LoadingRow>
              <LoadingText>正在加载...</LoadingText>
              <LoadingHint>首次启动或更新后进入时间可能稍长</LoadingHint>
            </LoadingRow>
          </LoadingArea>
        </Panel>
      </Stage>
    </Container>
  );
}
