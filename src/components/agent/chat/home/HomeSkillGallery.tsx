import styled from "styled-components";
import type { HomeSkillSurfaceItem } from "./homeSurfaceTypes";
import { resolveHomeCoverAsset } from "./homeCoverAssets";

const GallerySection = styled.section`
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.95rem;
  padding-top: 1.15rem;
`;

const GalleryHeader = styled.div`
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 0.9rem;
`;

const HeaderText = styled.div`
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.16rem;
`;

const Title = styled.h2`
  margin: 0;
  color: var(--lime-text-strong, rgb(15 23 42));
  font-size: 18px;
  font-weight: 760;
  line-height: 1.35;
`;

const Description = styled.p`
  margin: 0;
  color: var(--lime-text-muted, rgb(100 116 139));
  font-size: 12px;
  line-height: 1.6;
`;

const Grid = styled.div`
  display: grid;
  min-width: 0;
  gap: 0.8rem;
  grid-template-columns: repeat(3, minmax(0, 1fr));

  @media (max-width: 1120px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  @media (max-width: 720px) {
    grid-template-columns: minmax(0, 1fr);
  }
`;

const Card = styled.button`
  display: flex;
  min-width: 0;
  flex-direction: column;
  overflow: hidden;
  border-radius: 24px;
  border: 1px solid var(--lime-surface-border, rgba(226, 232, 240, 0.92));
  background: var(--lime-surface, #fff);
  padding: 0;
  text-align: left;
  transition:
    border-color 160ms ease,
    box-shadow 160ms ease,
    transform 160ms ease;

  &:hover {
    border-color: var(--lime-surface-border-strong, rgba(203, 213, 225, 0.98));
    box-shadow: 0 18px 44px -36px
      var(--lime-shadow-color, rgba(15, 23, 42, 0.3));
    transform: translateY(-1px);
  }
`;

const Cover = styled.span<{ $token: string }>`
  display: block;
  overflow: hidden;
  height: 112px;
  background: ${({ $token }) =>
    `radial-gradient(circle at 18% 18%, rgba(255, 255, 255, 0.36), transparent 20%), ${resolveCoverGradient($token)}`};
`;

const CoverImage = styled.img`
  display: block;
  height: 100%;
  width: 100%;
  object-fit: cover;
`;

const Body = styled.span`
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.32rem;
  padding: 0.85rem 0.95rem 0.95rem;
`;

const CardTitle = styled.span`
  color: var(--lime-text-strong, rgb(15 23 42));
  font-size: 14px;
  font-weight: 780;
  line-height: 1.45;
`;

const CardSummary = styled.span`
  display: -webkit-box;
  overflow: hidden;
  color: var(--lime-text-muted, rgb(100 116 139));
  font-size: 12px;
  line-height: 1.55;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
`;

function resolveCoverGradient(token: string): string {
  switch (token) {
    case "trend":
      return "linear-gradient(135deg, #d9d27c, #59633d)";
    case "viral":
      return "linear-gradient(135deg, #9ed6cd, #2d4a52)";
    case "voice":
      return "linear-gradient(135deg, #bce8ff, #18384f)";
    case "review":
      return "linear-gradient(135deg, #bdccb2, #27392f)";
    case "rewrite":
      return "linear-gradient(135deg, #f2bf88, #3d261f)";
    case "draft":
      return "linear-gradient(135deg, #f6dfb8, #99613d)";
    default:
      return "linear-gradient(135deg, #d8e8d0, #5f705b)";
  }
}

interface HomeSkillGalleryProps {
  items: HomeSkillSurfaceItem[];
  onSelectItem: (item: HomeSkillSurfaceItem) => void;
}

export function HomeSkillGallery({
  items,
  onSelectItem,
}: HomeSkillGalleryProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <GallerySection data-testid="home-skill-gallery">
      <GalleryHeader>
        <HeaderText>
          <Title>你可以从这些任务开始</Title>
          <Description>
            往下看更多任务样例；真正执行仍会回到生成里继续补充。
          </Description>
        </HeaderText>
      </GalleryHeader>
      <Grid>
        {items.map((item) => {
          const imageUrl = resolveHomeCoverAsset(item.coverToken);

          return (
            <Card
              key={`${item.sourceKind}-${item.id}`}
              type="button"
              data-testid={
                item.testId ? `home-gallery-${item.testId}` : undefined
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
              <Body>
                <CardTitle>{item.title}</CardTitle>
                <CardSummary>{item.summary}</CardSummary>
              </Body>
            </Card>
          );
        })}
      </Grid>
    </GallerySection>
  );
}
