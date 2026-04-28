/**
 * 启动画面组件
 *
 * 应用启动时显示专用 Logo、Slogan 与进度动画，然后淡出进入主界面。
 */

import { useEffect, useState } from "react";
import styled, { keyframes } from "styled-components";
import { LIME_BRAND_LOGO_SRC, LIME_BRAND_NAME } from "@/lib/branding";

const sceneEnter = keyframes`
  from { opacity: 0; transform: scale(0.985); }
  to { opacity: 1; transform: scale(1); }
`;

const sceneExit = keyframes`
  from { opacity: 1; transform: scale(1); }
  to { opacity: 0; transform: scale(1.02); }
`;

const orbFloat = keyframes`
  0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
  50% { transform: translate3d(0, -16px, 0) scale(1.06); }
`;

const logoFloat = keyframes`
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-8px); }
`;

const progressShift = keyframes`
  0% { transform: translateX(-38%) scaleX(0.78); opacity: 0.56; }
  50% { transform: translateX(10%) scaleX(1); opacity: 1; }
  100% { transform: translateX(76%) scaleX(0.82); opacity: 0.56; }
`;

const glowPulse = keyframes`
  0%, 100% { opacity: 0.58; transform: scale(0.96); }
  50% { opacity: 1; transform: scale(1.04); }
`;

const Container = styled.div<{ $isExiting: boolean }>`
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background:
    radial-gradient(
      circle at 20% 18%,
      rgba(132, 204, 22, 0.18),
      transparent 30%
    ),
    radial-gradient(
      circle at 78% 12%,
      rgba(250, 204, 21, 0.14),
      transparent 28%
    ),
    radial-gradient(circle at 50% 84%, rgba(34, 197, 94, 0.1), transparent 28%),
    linear-gradient(
      180deg,
      hsl(var(--background)) 0%,
      hsl(var(--muted) / 0.72) 48%,
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
  filter: blur(40px);
  animation: ${orbFloat} 10s ease-in-out infinite;
  animation-delay: ${({ $delay }) => $delay ?? "0s"};
  pointer-events: none;
`;

const Stage = styled.div`
  position: relative;
  z-index: 1;
  width: min(860px, calc(100vw - 40px));
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
`;

const LogoStack = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: min(360px, 78vw);
  height: min(360px, 78vw);
`;

const LogoGlow = styled.div`
  position: absolute;
  inset: 12% 12% 16%;
  border-radius: 999px;
  background: radial-gradient(
    circle,
    rgba(163, 230, 53, 0.4) 0%,
    rgba(163, 230, 53, 0.16) 38%,
    rgba(250, 204, 21, 0.1) 60%,
    transparent 78%
  );
  filter: blur(26px);
  animation: ${glowPulse} 2.8s ease-in-out infinite;
`;

const Logo = styled.img`
  position: relative;
  width: clamp(240px, 34vw, 320px);
  height: clamp(240px, 34vw, 320px);
  object-fit: contain;
  animation: ${logoFloat} 4.2s ease-in-out infinite;
  filter: drop-shadow(0 28px 44px rgba(15, 23, 42, 0.16));

  @media (max-width: 640px) {
    width: min(260px, 72vw);
    height: min(260px, 72vw);
  }
`;

const CopyBlock = styled.div`
  position: relative;
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
`;

const CopyGlow = styled.div`
  position: absolute;
  inset: 0 auto auto;
  width: min(420px, 92vw);
  height: 112px;
  border-radius: 999px;
  background: radial-gradient(
    circle,
    rgba(163, 230, 53, 0.24) 0%,
    rgba(250, 204, 21, 0.18) 36%,
    transparent 74%
  );
  filter: blur(26px);
  pointer-events: none;
`;

const Slogan = styled.h1`
  position: relative;
  margin: 22px 0 0;
  max-width: 18em;
  font-size: clamp(28px, 4vw, 38px);
  line-height: 1.16;
  font-weight: 700;
  letter-spacing: -0.04em;
  color: hsl(var(--foreground));
  text-wrap: balance;
  text-shadow:
    0 0 18px rgba(163, 230, 53, 0.26),
    0 10px 30px rgba(15, 23, 42, 0.1),
    0 0 42px rgba(250, 204, 21, 0.14);

  &::before {
    content: "";
    position: absolute;
    inset: 12% -10% -18%;
    z-index: -1;
    border-radius: 999px;
    background: radial-gradient(
      circle,
      rgba(163, 230, 53, 0.36) 0%,
      rgba(250, 204, 21, 0.2) 34%,
      rgba(255, 255, 255, 0.12) 52%,
      transparent 76%
    );
    filter: blur(30px);
    transform: scale(1.02);
  }

  &::after {
    content: "";
    position: absolute;
    inset: auto 12% -6% 12%;
    z-index: -1;
    height: 18px;
    border-radius: 999px;
    background: linear-gradient(
      90deg,
      rgba(132, 204, 22, 0) 0%,
      rgba(132, 204, 22, 0.42) 18%,
      rgba(250, 204, 21, 0.45) 50%,
      rgba(132, 204, 22, 0.42) 82%,
      rgba(132, 204, 22, 0) 100%
    );
    filter: blur(16px);
    opacity: 0.95;
  }

  @media (max-width: 640px) {
    margin-top: 16px;
  }
`;

const Subtitle = styled.p`
  margin: 0;
  max-width: min(33em, calc(100vw - 56px));
  font-size: clamp(15px, 2vw, 18px);
  line-height: 1.72;
  font-weight: 500;
  letter-spacing: -0.02em;
  color: hsl(var(--muted-foreground));
  text-wrap: balance;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.35);
`;

const ProgressTrack = styled.div`
  position: relative;
  overflow: hidden;
  margin-top: 30px;
  width: min(320px, 72vw);
  height: 8px;
  border-radius: 999px;
  background: linear-gradient(
    90deg,
    hsl(var(--muted) / 0.82) 0%,
    hsl(var(--muted) / 0.96) 100%
  );
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.32),
    0 12px 28px rgba(15, 23, 42, 0.08);
`;

const ProgressBar = styled.div`
  position: absolute;
  inset: 0 auto 0 0;
  width: 44%;
  border-radius: inherit;
  background: linear-gradient(
    90deg,
    rgba(132, 204, 22, 0.96) 0%,
    rgba(250, 204, 21, 0.9) 100%
  );
  box-shadow: 0 0 24px rgba(163, 230, 53, 0.35);
  animation: ${progressShift} 1.6s ease-in-out infinite;
`;

interface SplashScreenProps {
  onComplete: () => void;
  duration?: number;
  exitDuration?: number;
}

export function SplashScreen({
  onComplete,
  duration = 420,
  exitDuration = 160,
}: SplashScreenProps) {
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    const exitTimer = setTimeout(() => {
      setIsExiting(true);
    }, duration);

    const completeTimer = setTimeout(() => {
      onComplete();
    }, duration + exitDuration);

    return () => {
      clearTimeout(exitTimer);
      clearTimeout(completeTimer);
    };
  }, [duration, exitDuration, onComplete]);

  return (
    <Container $isExiting={isExiting}>
      <AmbientOrb
        $size={280}
        $top="-72px"
        $left="-56px"
        $color="rgba(132, 204, 22, 0.22)"
      />
      <AmbientOrb
        $size={340}
        $top="8%"
        $right="-96px"
        $color="rgba(250, 204, 21, 0.14)"
        $delay="-2.2s"
      />
      <AmbientOrb
        $size={260}
        $bottom="-84px"
        $left="18%"
        $color="rgba(34, 197, 94, 0.14)"
        $delay="-4s"
      />

      <Stage>
        <LogoStack>
          <LogoGlow />
          <Logo src={LIME_BRAND_LOGO_SRC} alt={LIME_BRAND_NAME} />
        </LogoStack>
        <CopyBlock>
          <CopyGlow />
          <Slogan>青柠一下，灵感即来</Slogan>
          <Subtitle>从一句想法，到成稿、成图、成片、成事</Subtitle>
        </CopyBlock>
        <ProgressTrack aria-hidden>
          <ProgressBar />
        </ProgressTrack>
      </Stage>
    </Container>
  );
}
