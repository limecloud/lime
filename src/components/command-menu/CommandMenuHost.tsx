import { useCallback, useMemo, useRef, useState } from "react";
import { CommandMenu } from "./CommandMenu";
import { useCommand } from "@/lib/commands/useCommand";
import type { CommandRegistration } from "@/lib/commands/registry";

export function CommandMenuHost() {
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const changeOpen = useCallback((next: boolean) => {
    openRef.current = next;
    setOpen(next);
  }, []);

  const command = useMemo<CommandRegistration>(
    () => ({
      id: "app.openCommandMenu",
      titleKey: "commands.openCommandMenu.title",
      descriptionKey: "commands.openCommandMenu.description",
      section: "app",
      bindings: ["CommandOrControl+K", "CommandOrControl+Shift+P"],
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
    }),
    [changeOpen],
  );
  useCommand(command);

  return open ? (
    <CommandMenu
      open
      onOpenChange={changeOpen}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        // 旧弹窗的延迟清理不得夺走重新打开的命令菜单焦点。
        if (openRef.current) return;
        const target = returnFocusRef.current;
        if (target?.isConnected) target.focus();
        else
          document
            .querySelector<HTMLElement>("[data-app-shell-content]")
            ?.focus();
      }}
    />
  ) : null;
}
