import styled from "styled-components";
import type {
  HomeSkillSection,
  HomeSkillSurfaceItem,
} from "./homeSurfaceTypes";
import { resolveHomeCoverAsset } from "./homeCoverAssets";

const Drawer = styled.div`
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.9rem;
  border-radius: 26px;
  border: 1px solid var(--lime-surface-border, rgba(226, 232, 240, 0.92));
  background: var(--lime-surface, #fff);
  padding: 1rem;
  box-shadow: 0 22px 54px -40px var(--lime-shadow-color, rgba(15, 23, 42, 0.28));
`;

const Section = styled.section`
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.45rem;
`;

const SectionTitle = styled.h3`
  margin: 0;
  padding: 0 0.35rem;
  color: var(--lime-text, rgb(71 85 105));
  font-size: 13px;
  font-weight: 750;
  line-height: 1.4;
`;

const ItemGrid = styled.div`
  display: grid;
  min-width: 0;
  gap: 0.5rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));

  @media (max-width: 760px) {
    grid-template-columns: minmax(0, 1fr);
  }
`;

const DrawerItem = styled.button`
  display: grid;
  min-width: 0;
  grid-template-columns: 46px minmax(0, 1fr);
  align-items: center;
  gap: 0.62rem;
  border-radius: 18px;
  border: 1px solid var(--lime-surface-border, rgba(226, 232, 240, 0.92));
  background: var(--lime-surface-soft, rgba(248, 250, 252, 0.98));
  padding: 0.45rem;
  text-align: left;
  transition:
    border-color 160ms ease,
    background-color 160ms ease,
    transform 160ms ease;

  &:hover {
    border-color: var(--lime-surface-border-strong, rgba(203, 213, 225, 0.96));
    background: var(--lime-surface, #fff);
    transform: translateY(-1px);
  }
`;

const Cover = styled.span<{ $token: string }>`
  display: block;
  overflow: hidden;
  width: 46px;
  height: 46px;
  border-radius: 15px;
  background: ${({ $token }) => resolveCoverGradient($token)};
`;

const CoverImage = styled.img`
  display: block;
  height: 100%;
  width: 100%;
  object-fit: cover;
`;

const ItemText = styled.span`
  display: block;
  min-width: 0;
`;

const ItemTitle = styled.span`
  display: block;
  overflow: hidden;
  color: var(--lime-text-strong, rgb(15 23 42));
  font-size: 13px;
  font-weight: 780;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ItemSummary = styled.span`
  display: block;
  margin-top: 0.12rem;
  overflow: hidden;
  color: var(--lime-text-muted, rgb(100 116 139));
  font-size: 11px;
  line-height: 1.45;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

function resolveCoverGradient(token: string): string {
  switch (token) {
    case "trend":
      return "linear-gradient(135deg, #dad78d, #55613d)";
    case "viral":
      return "linear-gradient(135deg, #99c8c3, #34535a)";
    case "voice":
      return "linear-gradient(135deg, #bfe9ff, #1f3d53)";
    case "review":
      return "linear-gradient(135deg, #c9d7bb, #334136)";
    case "rewrite":
      return "linear-gradient(135deg, #f3c18d, #4a2f26)";
    case "draft":
      return "linear-gradient(135deg, #f5e0bd, #9a6542)";
    default:
      return "linear-gradient(135deg, #d9e5d2, #64745d)";
  }
}

interface HomeMoreSkillsDrawerProps {
  open: boolean;
  sections: HomeSkillSection[];
  onSelectItem: (item: HomeSkillSurfaceItem) => void;
}

export function HomeMoreSkillsDrawer({
  open,
  sections,
  onSelectItem,
}: HomeMoreSkillsDrawerProps) {
  if (!open) {
    return null;
  }

  return (
    <Drawer data-testid="home-more-skills-drawer" aria-label="更多做法">
      {sections.map((section) => (
        <Section key={section.id}>
          <SectionTitle>{section.title}</SectionTitle>
          <ItemGrid>
            {section.items.map((item) => {
              const imageUrl = resolveHomeCoverAsset(item.coverToken);

              return (
                <DrawerItem
                  key={`${item.sourceKind}-${item.id}`}
                  type="button"
                  data-testid={
                    item.testId ? `home-drawer-${item.testId}` : undefined
                  }
                  title={`${item.title} · ${item.summary}`}
                  onClick={() => onSelectItem(item)}
                >
                  <Cover $token={item.coverToken} aria-hidden>
                    {imageUrl ? (
                      <CoverImage
                        src={imageUrl}
                        alt=""
                        decoding="async"
                        draggable={false}
                        onError={(event) => {
                          event.currentTarget.style.display = "none";
                        }}
                      />
                    ) : null}
                  </Cover>
                  <ItemText>
                    <ItemTitle>/{item.title}</ItemTitle>
                    <ItemSummary>{item.summary}</ItemSummary>
                  </ItemText>
                </DrawerItem>
              );
            })}
          </ItemGrid>
        </Section>
      ))}
    </Drawer>
  );
}
