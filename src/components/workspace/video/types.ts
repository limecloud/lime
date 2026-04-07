export type VideoAspectRatio =
  | "adaptive"
  | "16:9"
  | "9:16"
  | "1:1"
  | "4:3"
  | "3:4"
  | "21:9";
export type VideoResolution = "480p" | "720p" | "1080p";
export type VideoStatus = "idle" | "generating" | "success" | "error";

export interface VideoCanvasState {
  type: "video";
  prompt: string;
  providerId: string;
  model: string;
  duration: number;
  seed?: number;
  generateAudio: boolean;
  cameraFixed: boolean;
  startImage?: string;
  endImage?: string;
  aspectRatio: VideoAspectRatio;
  resolution: VideoResolution;
  status: VideoStatus;
  selectedTaskId?: string;
  videoUrl?: string;
  errorMessage?: string;
}

export interface VideoCanvasProps {
  state: VideoCanvasState;
  onStateChange: (state: VideoCanvasState) => void;
  projectId?: string | null;
  contentId?: string | null;
  onClose?: () => void;
  onBackHome?: () => void;
}

export const createInitialVideoState = (
  content?: string,
): VideoCanvasState => ({
  type: "video",
  prompt: content || "",
  providerId: "",
  model: "",
  duration: 5,
  seed: undefined,
  generateAudio: false,
  cameraFixed: false,
  aspectRatio: "adaptive",
  resolution: "720p",
  status: "idle",
  selectedTaskId: undefined,
});
