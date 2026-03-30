import { useEffect, useRef, useState } from "react";
import type { A2UIResponse } from "@/lib/workspace/a2ui";

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
  const [isStale, setIsStale] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibleFormRef = useRef<A2UIResponse | null>(visibleForm);

  visibleFormRef.current = visibleForm;

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
      setIsStale(false);
      return;
    }

    if (clearImmediately) {
      setVisibleForm(null);
      setIsStale(false);
      return;
    }

    if (!visibleFormRef.current) {
      setVisibleForm(null);
      setIsStale(false);
      return;
    }

    setIsStale(true);
    hideTimerRef.current = setTimeout(() => {
      setVisibleForm(null);
      setIsStale(false);
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
    isStale,
  };
}
