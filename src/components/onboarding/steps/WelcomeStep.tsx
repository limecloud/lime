/**
 * 初次安装引导 - 欢迎页
 */

import styled from "styled-components";
import { Button } from "@/components/ui/button";
import { Cpu, LayoutDashboard, Mic } from "lucide-react";

const Container = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px 24px;
  min-height: 100%;
`;

const LogoContainer = styled.div`
  width: 80px;
  height: 80px;
  margin-bottom: 24px;
  animation: float 3s ease-in-out infinite;

  @keyframes float {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-10px);
    }
  }
`;

const Logo = styled.img`
  width: 100%;
  height: 100%;
  object-fit: contain;
`;

const Title = styled.h1`
  font-size: 28px;
  font-weight: 700;
  color: hsl(var(--foreground));
  margin-bottom: 12px;
  text-align: center;
`;

const Subtitle = styled.p`
  font-size: 14px;
  color: hsl(var(--muted-foreground));
  text-align: center;
  max-width: 400px;
  line-height: 1.6;
  margin-bottom: 32px;
`;

const FeatureGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  width: 100%;
  max-width: 600px;
  margin-bottom: auto;
`;

const FeatureCard = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px 12px;
  border-radius: 12px;
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
  transition: all 0.2s;

  &:hover {
    border-color: hsl(var(--primary) / 0.5);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }
`;

const FeatureIcon = styled.div`
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: hsl(var(--primary) / 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 12px;

  svg {
    width: 24px;
    height: 24px;
    color: hsl(var(--primary));
  }
`;

const FeatureTitle = styled.h3`
  font-size: 14px;
  font-weight: 600;
  color: hsl(var(--foreground));
  margin-bottom: 6px;
  text-align: center;
`;

const FeatureDescription = styled.p`
  font-size: 12px;
  color: hsl(var(--muted-foreground));
  text-align: center;
  line-height: 1.5;
`;

const Footer = styled.div`
  display: flex;
  justify-content: flex-end;
  width: 100%;
  max-width: 600px;
  padding-top: 16px;
`;

interface WelcomeStepProps {
  onNext: () => void;
  onSkip: () => void;
}

export function WelcomeStep({ onNext, onSkip }: WelcomeStepProps) {
  return (
    <Container>
      <LogoContainer>
        <Logo src="/logo.png" alt="Lime" />
      </LogoContainer>

      <Title>欢迎使用 Lime</Title>
      <Subtitle>
        Lime 是一款强大的 AI 客户端代理，帮助您轻松管理和使用多种 AI 服务。
      </Subtitle>

      <FeatureGrid>
        <FeatureCard>
          <FeatureIcon>
            <Cpu />
          </FeatureIcon>
          <FeatureTitle>多模型支持</FeatureTitle>
          <FeatureDescription>
            支持 Claude、OpenAI、Gemini 等主流 AI 模型
          </FeatureDescription>
        </FeatureCard>

        <FeatureCard>
          <FeatureIcon>
            <LayoutDashboard />
          </FeatureIcon>
          <FeatureTitle>持续工作区</FeatureTitle>
          <FeatureDescription>
            围绕同一目标持续整理对话、素材和结果，减少来回切换。
          </FeatureDescription>
        </FeatureCard>

        <FeatureCard>
          <FeatureIcon>
            <Mic />
          </FeatureIcon>
          <FeatureTitle>语音交互</FeatureTitle>
          <FeatureDescription>
            便捷的语音输入，提升对话效率
          </FeatureDescription>
        </FeatureCard>
      </FeatureGrid>

      <Footer>
        <Button variant="outline" onClick={onSkip}>
          跳过引导
        </Button>
        <Button onClick={onNext}>开始使用</Button>
      </Footer>
    </Container>
  );
}
