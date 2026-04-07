/**
 * 初次安装引导 - 完成页
 */

import styled from "styled-components";
import { Button } from "@/components/ui/button";
import { PartyPopper } from "lucide-react";

const Container = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px 24px;
  text-align: center;
`;

const IconContainer = styled.div`
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: hsl(142.1 76.2% 36.3% / 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 24px;

  svg {
    width: 40px;
    height: 40px;
    color: hsl(142.1 76.2% 36.3%);
  }
`;

const Title = styled.h2`
  font-size: 24px;
  font-weight: 600;
  color: hsl(var(--foreground));
  margin-bottom: 8px;
`;

const Subtitle = styled.p`
  font-size: 14px;
  color: hsl(var(--muted-foreground));
  margin-bottom: 32px;
  max-width: 400px;
`;

const TipsMessage = styled.p`
  font-size: 14px;
  color: hsl(var(--muted-foreground));
  margin-bottom: 32px;
`;

interface CompleteStepProps {
  onFinish: () => void;
}

export function CompleteStep({ onFinish }: CompleteStepProps) {
  return (
    <Container>
      <IconContainer>
        <PartyPopper />
      </IconContainer>

      <Title>设置完成！</Title>
      <Subtitle>Lime 已准备就绪，您可以开始使用了。</Subtitle>

      <TipsMessage>提示：后续可在设置中继续调整语音输入和快捷键。</TipsMessage>

      <Button size="lg" onClick={onFinish}>
        开始使用
      </Button>
    </Container>
  );
}
