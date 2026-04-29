// 首页封面走 public 绝对路径，保持与 logo 一致，避免桌面 WebView 中 CSS import URL 失效。
const HOME_COVER_ASSETS: Record<string, string> = {
  "account-performance-tracking":
    "/home-covers/home-cover-account-performance-tracking.jpg",
  "article-to-slide-video-outline":
    "/home-covers/home-cover-article-to-slide-video-outline.jpg",
  "carousel-post-replication":
    "/home-covers/home-cover-carousel-post-replication.jpg",
  "cloud-video-dubbing": "/home-covers/home-cover-cloud-video-dubbing.jpg",
  "daily-trend-briefing": "/home-covers/home-cover-trend.jpg",
  draft: "/home-covers/home-cover-draft.jpg",
  review: "/home-covers/home-cover-review.jpg",
  rewrite: "/home-covers/home-cover-rewrite.jpg",
  scene: "/home-covers/home-cover-short-video-script-replication.jpg",
  service: "/home-covers/home-cover-review.jpg",
  sky: "/home-covers/home-cover-article-to-slide-video-outline.jpg",
  "short-video-script-replication":
    "/home-covers/home-cover-short-video-script-replication.jpg",
  trend: "/home-covers/home-cover-trend.jpg",
  "video-dubbing-language":
    "/home-covers/home-cover-video-dubbing-language.jpg",
  viral: "/home-covers/home-cover-viral.jpg",
  voice: "/home-covers/home-cover-voice.jpg",
};

export function resolveHomeCoverAsset(token: string): string | undefined {
  const normalized = token.trim().toLowerCase();
  if (HOME_COVER_ASSETS[normalized]) {
    return HOME_COVER_ASSETS[normalized];
  }
  if (/carousel|post|social|xiaohongshu|内容/.test(normalized)) {
    return HOME_COVER_ASSETS["carousel-post-replication"];
  }
  if (/script|short-video|video/.test(normalized)) {
    return HOME_COVER_ASSETS["short-video-script-replication"];
  }
  if (/dub|voice|audio|language|配音/.test(normalized)) {
    return HOME_COVER_ASSETS["cloud-video-dubbing"];
  }
  if (/slide|article|outline|knowledge/.test(normalized)) {
    return HOME_COVER_ASSETS["article-to-slide-video-outline"];
  }
  if (/account|growth|tracking|review/.test(normalized)) {
    return HOME_COVER_ASSETS["account-performance-tracking"];
  }
  if (/trend|brief|report/.test(normalized)) {
    return HOME_COVER_ASSETS.trend;
  }
  return HOME_COVER_ASSETS.review;
}
