import { useEffect, useRef, useState } from "react";
import type { A2UIResponse } from "@/components/content-creator/a2ui/types";

interface UseStickyA2UIFormParams {
  form?: A2UIResponse | null;
  clearImmediately?: boolean;
  holdMs?: number;
}

export function useStickyA2UIForm({
  form,
  clearImmediately = false,
  holdMs = 1200,
}: UseStickyA2UIFormParams) {
  const [visibleForm, setVisibleForm] = useState<A2UIResponse | null>(
    form || null,
  );
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }

    if (form) {
      setVisibleForm(form);
      return;
    }

    if (clearImmediately) {
      setVisibleForm(null);
      return;
    }

    hideTimerRef.current = setTimeout(() => {
      setVisibleForm(null);
      hideTimerRef.current = null;
    }, holdMs);

    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };
  }, [clearImmediately, form, holdMs]);

  return {
    visibleForm,
  };
}
