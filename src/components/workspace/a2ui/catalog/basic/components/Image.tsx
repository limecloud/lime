import { cn } from "@/lib/utils";
import type { ImageComponent } from "../../../types";
import { resolveDynamicValue } from "../../../parser";
import { A2UI_RENDERER_TOKENS } from "../../../rendererTokens";

interface ImageRendererProps {
  component: ImageComponent;
  data: Record<string, unknown>;
  scopePath?: string;
}

export function ImageRenderer({
  component,
  data,
  scopePath = "/",
}: ImageRendererProps) {
  const resolvedUrl = resolveDynamicValue(component.url, data, "", scopePath);
  const url = typeof resolvedUrl === "string" ? resolvedUrl : "";
  const variant = component.variant || "mediumFeature";

  if (!url) {
    return (
      <div
        className={cn(
          A2UI_RENDERER_TOKENS.imagePlaceholder,
          A2UI_RENDERER_TOKENS.imageVariants[variant] ||
            A2UI_RENDERER_TOKENS.imageVariants.default,
        )}
      >
        暂无图片
      </div>
    );
  }

  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      className={cn(
        A2UI_RENDERER_TOKENS.imageBase,
        A2UI_RENDERER_TOKENS.imageVariants[variant] ||
          A2UI_RENDERER_TOKENS.imageVariants.default,
        A2UI_RENDERER_TOKENS.imageFit[component.fit || "cover"],
      )}
    />
  );
}

export const Image = ImageRenderer;
