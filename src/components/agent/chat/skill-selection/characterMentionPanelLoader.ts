import { lazy } from "react";

export const preloadCharacterMentionPanel = () =>
  import("./CharacterMentionPanel");

export const LazyCharacterMentionPanel = lazy(async () => {
  const module = await preloadCharacterMentionPanel();
  return { default: module.CharacterMentionPanel };
});
