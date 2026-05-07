import { safeInvoke } from "@/lib/dev-bridge";
import type { LayeredDesignFlatImageStructuredAnalyzerResult } from "@/lib/layered-design/analyzer";

export interface LayeredDesignTextBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayeredDesignRecognizedTextBlock {
  text: string;
  boundingBox?: LayeredDesignTextBoundingBox;
  confidence?: number;
}

export interface RecognizeLayeredDesignTextRequest {
  imageSrc: string;
  width: number;
  height: number;
  candidateId?: string;
}

export interface RecognizeLayeredDesignTextOutput {
  supported: boolean;
  engine: string;
  blocks: LayeredDesignRecognizedTextBlock[];
  message?: string;
}

export interface AnalyzeLayeredDesignFlatImageNativeRequest {
  image: {
    src: string;
    width: number;
    height: number;
    mimeType?: string;
    hasAlpha?: boolean;
  };
  createdAt?: string;
}

export interface AnalyzeLayeredDesignFlatImageNativeOutput {
  supported: boolean;
  engine: string;
  result?: LayeredDesignFlatImageStructuredAnalyzerResult;
  message?: string;
}

export async function recognizeLayeredDesignText(
  request: RecognizeLayeredDesignTextRequest,
): Promise<RecognizeLayeredDesignTextOutput> {
  return await safeInvoke<RecognizeLayeredDesignTextOutput>(
    "recognize_layered_design_text",
    { request },
  );
}

export async function analyzeLayeredDesignFlatImageNative(
  request: AnalyzeLayeredDesignFlatImageNativeRequest,
): Promise<AnalyzeLayeredDesignFlatImageNativeOutput> {
  return await safeInvoke<AnalyzeLayeredDesignFlatImageNativeOutput>(
    "analyze_layered_design_flat_image",
    { request },
  );
}
