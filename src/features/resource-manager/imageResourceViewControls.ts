import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
} from "react";

export interface Point {
  x: number;
  y: number;
}

export type ImageResourceFitMode = "fit" | "actual";
export type ImageResourceBackdropMode = "dark" | "light" | "checker";
export type ImageResourceNaturalSize = { width: number; height: number } | null;

export interface ImageResourceViewControls {
  scale: number;
  translate: Point;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
  fitMode: ImageResourceFitMode;
  backdropMode: ImageResourceBackdropMode;
  naturalSize: ImageResourceNaturalSize;
  isLoading: boolean;
  loadFailed: boolean;
  transform: string;
  stageStyle?: CSSProperties;
  setTranslate: (value: Point) => void;
  setFlipX: Dispatch<SetStateAction<boolean>>;
  setFlipY: Dispatch<SetStateAction<boolean>>;
  setNaturalSize: Dispatch<SetStateAction<ImageResourceNaturalSize>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setLoadFailed: Dispatch<SetStateAction<boolean>>;
  zoomBy: (delta: number) => void;
  resetView: () => void;
  rotateBy: (delta: number) => void;
  toggleFitMode: () => void;
  cycleBackdropMode: () => void;
}

const MIN_SCALE = 0.2;
const MAX_SCALE = 6;
export const IMAGE_RESOURCE_SCALE_STEP = 0.2;

function clampScale(scale: number): number {
  return Math.min(Math.max(scale, MIN_SCALE), MAX_SCALE);
}

export function useImageResourceViewControls(params: {
  itemKey?: string | null;
  enabled: boolean;
}): ImageResourceViewControls {
  const { itemKey, enabled } = params;
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState<Point>({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(0);
  const [flipX, setFlipX] = useState(false);
  const [flipY, setFlipY] = useState(false);
  const [fitMode, setFitMode] = useState<ImageResourceFitMode>("fit");
  const [backdropMode, setBackdropMode] =
    useState<ImageResourceBackdropMode>("light");
  const [naturalSize, setNaturalSize] =
    useState<ImageResourceNaturalSize>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
    setRotation(0);
    setFlipX(false);
    setFlipY(false);
    setFitMode("fit");
    setBackdropMode("light");
    setNaturalSize(null);
    setIsLoading(true);
    setLoadFailed(false);
  }, [itemKey]);

  const transform = useMemo(
    () =>
      `translate(${translate.x}px, ${translate.y}px) rotate(${rotation}deg) scale(${scale}) scaleX(${flipX ? -1 : 1}) scaleY(${flipY ? -1 : 1})`,
    [flipX, flipY, rotation, scale, translate.x, translate.y],
  );

  const zoomBy = (delta: number) => {
    setScale((current) => clampScale(current + delta));
  };

  const resetView = () => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
    setRotation(0);
    setFlipX(false);
    setFlipY(false);
    setFitMode("fit");
  };

  const rotateBy = (delta: number) => {
    setRotation((current) => (current + delta + 360) % 360);
  };

  const toggleFitMode = () => {
    setFitMode((current) => (current === "fit" ? "actual" : "fit"));
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  };

  const cycleBackdropMode = () => {
    setBackdropMode((current) => {
      if (current === "light") return "checker";
      if (current === "checker") return "dark";
      return "light";
    });
  };

  useEffect(() => {
    if (!enabled) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      ) {
        return;
      }

      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomBy(IMAGE_RESOURCE_SCALE_STEP);
        return;
      }
      if (event.key === "-") {
        event.preventDefault();
        zoomBy(-IMAGE_RESOURCE_SCALE_STEP);
        return;
      }
      if (event.key === "0") {
        event.preventDefault();
        resetView();
        return;
      }
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        setFitMode("fit");
        setScale(1);
        setTranslate({ x: 0, y: 0 });
        return;
      }
      if (event.key === "1") {
        event.preventDefault();
        setFitMode("actual");
        setScale(1);
        setTranslate({ x: 0, y: 0 });
        return;
      }
      if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        rotateBy(event.shiftKey ? -90 : 90);
        return;
      }
      if (event.key.toLowerCase() === "h") {
        event.preventDefault();
        setFlipX((current) => !current);
        return;
      }
      if (event.key.toLowerCase() === "v") {
        event.preventDefault();
        setFlipY((current) => !current);
        return;
      }
      if (event.key.toLowerCase() === "b") {
        event.preventDefault();
        cycleBackdropMode();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, flipX, flipY, rotation, scale, translate.x, translate.y]);

  const stageStyle: CSSProperties | undefined =
    backdropMode === "checker"
      ? {
          backgroundColor: "#e2e8f0",
          backgroundImage:
            "linear-gradient(45deg,rgba(100,116,139,0.22) 25%,transparent 25%),linear-gradient(-45deg,rgba(100,116,139,0.22) 25%,transparent 25%),linear-gradient(45deg,transparent 75%,rgba(100,116,139,0.22) 75%),linear-gradient(-45deg,transparent 75%,rgba(100,116,139,0.22) 75%)",
          backgroundPosition: "0 0,0 12px,12px -12px,-12px 0",
          backgroundSize: "24px 24px",
        }
      : undefined;

  return {
    scale,
    translate,
    rotation,
    flipX,
    flipY,
    fitMode,
    backdropMode,
    naturalSize,
    isLoading,
    loadFailed,
    transform,
    stageStyle,
    setTranslate,
    setFlipX,
    setFlipY,
    setNaturalSize,
    setIsLoading,
    setLoadFailed,
    zoomBy,
    resetView,
    rotateBy,
    toggleFitMode,
    cycleBackdropMode,
  };
}
