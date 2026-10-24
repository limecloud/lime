import { useCallback, useLayoutEffect, useRef, useState } from "react";

const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 64;
const USER_SCROLL_IDLE_MS = 500;

function isNearScrollBottom(container: HTMLDivElement): boolean {
  const { scrollTop, scrollHeight, clientHeight } = container;
  return (
    scrollHeight - scrollTop - clientHeight <= AUTO_SCROLL_BOTTOM_THRESHOLD_PX
  );
}

export function useMessageListScrollController(sessionId?: string | null) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const shouldAutoScrollRef = useRef(true);
  const programmaticTopRef = useRef<number | null>(null);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setAutoScrollEnabled = useCallback((value: boolean) => {
    shouldAutoScrollRef.current = value;
    setShouldAutoScroll(value);
  }, []);

  const markUserScrolling = useCallback(() => {
    setIsUserScrolling(true);

    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }

    scrollTimeoutRef.current = setTimeout(() => {
      setIsUserScrolling(false);
      scrollTimeoutRef.current = null;
    }, USER_SCROLL_IDLE_MS);
  }, []);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    // 会话切换会替换带 key 的容器；监听和尾随状态必须属于当前容器。
    programmaticTopRef.current = null;
    setAutoScrollEnabled(true);
    setIsUserScrolling(false);

    const handleScroll = () => {
      markUserScrolling();
      if (
        programmaticTopRef.current !== null &&
        Math.abs(programmaticTopRef.current - container.scrollTop) < 1
      ) {
        programmaticTopRef.current = null;
        return;
      }
      programmaticTopRef.current = null;
      setAutoScrollEnabled(isNearScrollBottom(container));
    };

    const handleWheel = (event: WheelEvent) => {
      markUserScrolling();
      if (event.deltaY < 0) {
        setAutoScrollEnabled(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("input,textarea,[contenteditable=true]")) return;
      if (
        ["ArrowUp", "PageUp", "Home"].includes(event.key) ||
        (event.key === " " && event.shiftKey)
      ) {
        markUserScrolling();
        setAutoScrollEnabled(false);
      }
    };
    let touchY: number | null = null;
    const handleTouchStart = (event: TouchEvent) => {
      touchY = event.touches[0]?.clientY ?? null;
    };
    const handleTouchMove = (event: TouchEvent) => {
      const nextY = event.touches[0]?.clientY;
      if (touchY !== null && nextY !== undefined && nextY > touchY)
        setAutoScrollEnabled(false);
      touchY = nextY ?? null;
      markUserScrolling();
    };
    container.addEventListener("keydown", handleKeyDown);
    container.addEventListener("touchstart", handleTouchStart, {
      passive: true,
    });
    container.addEventListener("touchmove", handleTouchMove, { passive: true });
    container.addEventListener("scroll", handleScroll, { passive: true });
    container.addEventListener("wheel", handleWheel, { passive: true });

    return () => {
      container.removeEventListener("keydown", handleKeyDown);
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("scroll", handleScroll);
      container.removeEventListener("wheel", handleWheel);

      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = null;
      }
    };
  }, [sessionId, markUserScrolling, setAutoScrollEnabled]);

  const scrollToTail = useCallback((behavior: "auto" | "smooth") => {
    const container = containerRef.current;
    if (container && typeof container.scrollTo === "function") {
      programmaticTopRef.current = Math.max(
        0,
        container.scrollHeight - container.clientHeight,
      );
      container.scrollTo({
        behavior,
        top: container.scrollHeight,
      });
      return;
    }

    scrollRef.current?.scrollIntoView({
      behavior,
      block: "end",
    });
  }, []);

  const handleStreamingOverlayUpdate = useCallback(() => {
    if (!scrollRef.current) {
      return;
    }

    if (!shouldAutoScrollRef.current) {
      return;
    }

    setAutoScrollEnabled(true);

    const run = () => {
      if (shouldAutoScrollRef.current) scrollToTail("auto");
    };

    if (typeof window !== "undefined" && window.requestAnimationFrame) {
      window.requestAnimationFrame(run);
      return;
    }

    run();
  }, [scrollToTail, setAutoScrollEnabled]);

  const setScrollTop = useCallback((top: number) => {
    const container = containerRef.current;
    if (!container) return;
    container.scrollTop = Math.max(0, top);
    programmaticTopRef.current = container.scrollTop;
  }, []);
  const isFollowingTail = useCallback(() => shouldAutoScrollRef.current, []);
  const holdViewport = useCallback(
    () => setAutoScrollEnabled(false),
    [setAutoScrollEnabled],
  );

  return {
    containerRef,
    isFollowingTail,
    holdViewport,
    setScrollTop,
    scrollToTail,
    handleStreamingOverlayUpdate,
    isUserScrolling,
    scrollRef,
    shouldAutoScroll,
  };
}
