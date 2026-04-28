import { useEffect, useState } from "react";
import { readFilePreview } from "@/lib/api/fileBrowser";
import type { ResourceManagerItem } from "./types";

export interface ResourceTextPreviewState {
  loading: boolean;
  content: string | null;
  error: string | null;
}

interface UseResourceTextPreviewParams {
  item: ResourceManagerItem;
  maxSize: number;
  missingPathError: string;
  binaryError: string;
}

export function useResourceTextPreview({
  item,
  maxSize,
  missingPathError,
  binaryError,
}: UseResourceTextPreviewParams): ResourceTextPreviewState {
  const [state, setState] = useState<ResourceTextPreviewState>(() => ({
    loading: !item.content && Boolean(item.filePath),
    content: item.content ?? null,
    error: null,
  }));

  useEffect(() => {
    let cancelled = false;
    const inlineContent = item.content ?? null;
    if (inlineContent !== null) {
      setState({ loading: false, content: inlineContent, error: null });
      return () => {
        cancelled = true;
      };
    }

    const filePath = item.filePath?.trim();
    if (!filePath) {
      setState({
        loading: false,
        content: null,
        error: missingPathError,
      });
      return () => {
        cancelled = true;
      };
    }

    setState({ loading: true, content: null, error: null });
    void readFilePreview(filePath, maxSize)
      .then((preview) => {
        if (cancelled) return;
        if (preview.error) {
          setState({ loading: false, content: null, error: preview.error });
          return;
        }
        if (preview.isBinary) {
          setState({
            loading: false,
            content: null,
            error: binaryError,
          });
          return;
        }
        setState({ loading: false, content: preview.content ?? "", error: null });
      })
      .catch((error) => {
        if (cancelled) return;
        setState({
          loading: false,
          content: null,
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [binaryError, item.content, item.filePath, item.id, maxSize, missingPathError]);

  return state;
}
