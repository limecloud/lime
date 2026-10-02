import { useEffect, useRef } from "react";
import { ConversationListMoreButton } from "./AppSidebarConversationShelf.styles";

interface AppSidebarLoadMoreProps {
  itemCount: number;
  label: string;
  onLoadMore: () => void;
}

export function AppSidebarLoadMore({
  itemCount,
  label,
  onLoadMore,
}: AppSidebarLoadMoreProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const target = buttonRef.current;
    if (!target || typeof IntersectionObserver === "undefined") {
      return;
    }
    let requested = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!requested && entries.some((entry) => entry.isIntersecting)) {
          requested = true;
          onLoadMore();
        }
      },
      {
        root: target.closest('[data-testid="app-sidebar-menu-scroll"]'),
        rootMargin: "0px 0px 80px 0px",
      },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [itemCount, onLoadMore]);

  return (
    <ConversationListMoreButton
      ref={buttonRef}
      type="button"
      onClick={onLoadMore}
      data-testid="app-sidebar-load-more"
    >
      {label}
    </ConversationListMoreButton>
  );
}
