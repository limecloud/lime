export type MediaServicesSection = "image" | "video" | "voice";

type MediaServicesSectionModule = Promise<unknown>;

const mediaServicesSectionLoaders: Record<
  MediaServicesSection,
  () => MediaServicesSectionModule
> = {
  image: () => import("../image-gen"),
  video: () => import("../video-gen"),
  voice: () => import("../voice"),
};

export function loadMediaServicesSection(section: MediaServicesSection) {
  return mediaServicesSectionLoaders[section]();
}

export function preloadMediaServicesSection(section: MediaServicesSection) {
  return loadMediaServicesSection(section);
}
