import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronDown } from "lucide-react";
import styled from "styled-components";

export interface A2UISubmissionNoticeData {
  title: string;
  summary: string;
}

interface A2UISubmissionNoticeProps {
  notice: A2UISubmissionNoticeData;
  visible: boolean;
}

const Container = styled.div<{ $visible: boolean }>`
  margin: 0 8px 8px;
  box-sizing: border-box;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 9px 10px;
  border-radius: 10px;
  border: 1px solid hsl(var(--primary) / 0.18);
  background: linear-gradient(
    180deg,
    hsl(var(--background) / 0.96) 0%,
    hsl(var(--primary) / 0.06) 100%
  );
  box-shadow: 0 6px 18px hsl(var(--foreground) / 0.05);
  opacity: ${({ $visible }) => ($visible ? 1 : 0)};
  transform: translateY(${({ $visible }) => ($visible ? "0" : "-4px")});
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
  pointer-events: ${({ $visible }) => ($visible ? "auto" : "none")};
  will-change: opacity, transform;
`;

const IconWrap = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: hsl(var(--primary));
  flex-shrink: 0;
  margin-top: 1px;
`;

const Content = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const Title = styled.div`
  font-size: 12px;
  line-height: 1.3;
  font-weight: 600;
  color: hsl(var(--foreground));
`;

const Summary = styled.div<{ $expanded?: boolean }>`
  font-size: 11px;
  line-height: 1.4;
  color: hsl(var(--muted-foreground));

  ${({ $expanded }) =>
    $expanded
      ? `
    display: block;
    white-space: normal;
  `
      : `
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
  `}
`;

const ToggleButton = styled.button<{ $expanded?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  width: fit-content;
  padding: 0;
  border: none;
  background: transparent;
  color: hsl(var(--primary));
  font-size: 11px;
  line-height: 1.2;
  cursor: pointer;

  &:hover {
    color: hsl(var(--primary) / 0.82);
  }

  svg {
    width: 12px;
    height: 12px;
    transition: transform 0.18s ease;
    transform: rotate(${({ $expanded }) => ($expanded ? "180deg" : "0deg")});
  }
`;

export function A2UISubmissionNotice({
  notice,
  visible,
}: A2UISubmissionNoticeProps) {
  const [expanded, setExpanded] = useState(false);

  const canExpand = useMemo(() => notice.summary.length > 42, [notice.summary]);

  useEffect(() => {
    setExpanded(false);
  }, [notice.summary]);

  return (
    <Container $visible={visible}>
      <IconWrap>
        <CheckCircle2 size={15} />
      </IconWrap>
      <Content>
        <Title>{notice.title}</Title>
        <Summary $expanded={expanded}>{notice.summary}</Summary>
        {canExpand ? (
          <ToggleButton
            type="button"
            $expanded={expanded}
            onClick={() => setExpanded((prev) => !prev)}
          >
            <span>{expanded ? "收起" : "展开"}</span>
            <ChevronDown />
          </ToggleButton>
        ) : null}
      </Content>
    </Container>
  );
}
