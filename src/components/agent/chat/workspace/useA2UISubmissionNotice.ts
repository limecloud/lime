import { useEffect, useRef, useState } from "react";
import type { A2UISubmissionNoticeData } from "./A2UISubmissionNotice";

interface UseA2UISubmissionNoticeParams {
  notice?: A2UISubmissionNoticeData | null;
  enabled: boolean;
  displayMs?: number;
  fadeOutMs?: number;
}

export function useA2UISubmissionNotice({
  notice,
  enabled,
  displayMs = 3000,
  fadeOutMs = 180,
}: UseA2UISubmissionNoticeParams) {
  const [visibleNotice, setVisibleNotice] =
    useState<A2UISubmissionNoticeData | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
      }
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }

    if (enabled && notice) {
      setVisibleNotice(notice);
      const frameId = window.requestAnimationFrame(() => {
        setIsVisible(true);
      });
      dismissTimerRef.current = setTimeout(() => {
        setIsVisible(false);
        hideTimerRef.current = setTimeout(() => {
          setVisibleNotice((current) => (current === notice ? null : current));
          hideTimerRef.current = null;
        }, fadeOutMs);
        dismissTimerRef.current = null;
      }, displayMs);
      return () => {
        window.cancelAnimationFrame(frameId);
        if (dismissTimerRef.current) {
          clearTimeout(dismissTimerRef.current);
          dismissTimerRef.current = null;
        }
        if (hideTimerRef.current) {
          clearTimeout(hideTimerRef.current);
          hideTimerRef.current = null;
        }
      };
    }

    setIsVisible(false);
    hideTimerRef.current = setTimeout(() => {
      setVisibleNotice(null);
      hideTimerRef.current = null;
    }, fadeOutMs);

    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };
  }, [displayMs, enabled, fadeOutMs, notice]);

  return {
    visibleNotice,
    isVisible,
  };
}
