import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useCommand } from "@/lib/commands/useCommand";
import { observeCommandBindings } from "@/lib/commands/preferences";

const KeyboardShortcutsDialog = lazy(() => import("./KeyboardShortcutsDialog"));

export function KeyboardShortcutsDialogHost() {
  useEffect(observeCommandBindings, []);
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const changeOpen = (next: boolean) => {
    openRef.current = next;
    setOpen(next);
  };
  useCommand({
    id: "showKeyboardShortcuts",
    titleKey: "commands.showKeyboardShortcuts.title",
    descriptionKey: "commands.showKeyboardShortcuts.description",
    section: "app",
    bindings: ["CommandOrControl+/"],
    allowInInput: true,
    allowInDialog: true,
    handler: () => {
      if (!openRef.current) {
        const active = document.activeElement;
        returnFocusRef.current =
          active instanceof HTMLElement && active !== document.body
            ? active
            : null;
      }
      changeOpen(!openRef.current);
    },
  });
  return open ? (
    <Suspense fallback={null}>
      <KeyboardShortcutsDialog
        open
        onOpenChange={changeOpen}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          // 旧弹窗的延迟清理不得夺走重新打开的弹窗焦点。
          if (openRef.current) return;
          const target = returnFocusRef.current;
          if (target?.isConnected) target.focus();
          else
            document
              .querySelector<HTMLElement>("[data-app-shell-content]")
              ?.focus();
        }}
      />
    </Suspense>
  ) : null;
}
