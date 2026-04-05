import {
  useEffect,
  useState,
  type ImgHTMLAttributes,
  type ReactNode,
} from "react";

type TaskImageFallbackReason = "empty" | "error";

interface RenderableTaskImageProps extends Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "src" | "children"
> {
  src?: string | null;
  renderFallback: (reason: TaskImageFallbackReason) => ReactNode;
  renderImage?: (
    props: ImgHTMLAttributes<HTMLImageElement> & { src: string },
  ) => ReactNode;
}

export function RenderableTaskImage({
  src,
  renderFallback,
  renderImage,
  onError,
  ...imageProps
}: RenderableTaskImageProps) {
  const normalizedSrc = src?.trim() ?? "";
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    setLoadFailed(false);
  }, [normalizedSrc]);

  if (!normalizedSrc) {
    return <>{renderFallback("empty")}</>;
  }

  if (loadFailed) {
    return <>{renderFallback("error")}</>;
  }

  const resolvedImageProps: ImgHTMLAttributes<HTMLImageElement> & {
    src: string;
  } = {
    ...imageProps,
    src: normalizedSrc,
    onError: (event) => {
      setLoadFailed(true);
      onError?.(event);
    },
  };

  if (renderImage) {
    return <>{renderImage(resolvedImageProps)}</>;
  }

  return <img {...resolvedImageProps} />;
}
