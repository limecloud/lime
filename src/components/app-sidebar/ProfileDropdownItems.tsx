import * as Menu from "@radix-ui/react-dropdown-menu";
import { useLayoutEffect, useRef, useState } from "react";
import {
  BarChart3,
  BookOpen,
  ChevronRight,
  CircleHelp,
  Keyboard,
  LogIn,
  LogOut,
  Megaphone,
  Settings,
  UserRound,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CloudAccountView } from "@/lib/cloudAccount";
import { SettingsTabs } from "@/types/settings";

const itemClassName =
  "flex min-h-[30px] cursor-pointer items-center gap-2 rounded-[10px] px-2 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&>svg]:size-4";

// 安装包明确导出此名称；账号操作继续委托共享 owner。
export function ProfileDropdownItems({
  account,
  displayName,
  pending,
  onNavigate,
  onLogin,
  onLogout,
  onOpenReleases,
  onOpenUserGuide,
  onOpenKeyboardShortcuts,
}: {
  account: CloudAccountView | null;
  displayName: string;
  pending: boolean;
  onNavigate: (tab: SettingsTabs) => void;
  onLogin: () => void;
  onLogout: () => void;
  onOpenReleases: () => void;
  onOpenUserGuide: () => void;
  onOpenKeyboardShortcuts: () => void;
}) {
  const { t } = useTranslation("navigation");
  const helpTriggerRef = useRef<HTMLDivElement>(null);
  const [helpContent, setHelpContent] = useState<HTMLDivElement | null>(null);
  const [helpAlignOffset, setHelpAlignOffset] = useState(0);
  useLayoutEffect(() => {
    const trigger = helpTriggerRef.current;
    const parent = trigger?.closest<HTMLElement>('[role="menu"]');
    if (!helpContent || !trigger || !parent) return;
    const alignToParentBottom = () => {
      setHelpAlignOffset(
        parent.getBoundingClientRect().bottom -
          trigger.getBoundingClientRect().top -
          helpContent.getBoundingClientRect().height,
      );
    };
    alignToParentBottom();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(alignToParentBottom);
    for (const element of [parent, trigger, helpContent])
      observer?.observe(element);
    window.addEventListener("resize", alignToParentBottom);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", alignToParentBottom);
    };
  }, [helpContent]);
  return (
    <>
      {account ? (
        <>
          <Menu.Label className="px-2 py-1.5">
            <div className="truncate text-sm font-medium">{displayName}</div>
            {account.session.user.email ? (
              <div className="truncate text-xs text-muted-foreground">
                {account.session.user.email}
              </div>
            ) : null}
          </Menu.Label>
          <Menu.Item
            className={itemClassName}
            onSelect={() => onNavigate(SettingsTabs.Profile)}
          >
            <UserRound />
            {t("navigation.sidebar.account.profile")}
          </Menu.Item>
          <Menu.Item
            className={itemClassName}
            onSelect={() => onNavigate(SettingsTabs.Stats)}
          >
            <BarChart3 />
            {t("navigation.sidebar.account.usage")}
          </Menu.Item>
        </>
      ) : null}
      <Menu.Item
        className={itemClassName}
        onSelect={() => onNavigate(SettingsTabs.General)}
      >
        <Settings />
        {t("navigation.sidebar.items.settings")}
      </Menu.Item>
      <Menu.Separator className="my-1 h-px bg-border" />
      <Menu.Sub>
        <Menu.SubTrigger ref={helpTriggerRef} className={itemClassName}>
          <CircleHelp />
          {t("help.title")}
          <ChevronRight className="ml-auto" />
        </Menu.SubTrigger>
        <Menu.Portal>
          <Menu.SubContent
            ref={setHelpContent}
            alignOffset={helpAlignOffset}
            sticky="always"
            sideOffset={4}
            className="z-50 w-56 rounded-xl border bg-popover p-1 text-popover-foreground shadow-md outline-none"
          >
            <Menu.Item className={itemClassName} onSelect={onOpenReleases}>
              <Megaphone />
              {t("help.whatsNew")}
            </Menu.Item>
            <Menu.Item className={itemClassName} onSelect={onOpenUserGuide}>
              <BookOpen />
              {t("help.userGuide")}
            </Menu.Item>
            <Menu.Item
              className={itemClassName}
              onSelect={onOpenKeyboardShortcuts}
            >
              <Keyboard />
              {t("help.keyboardShortcuts")}
            </Menu.Item>
          </Menu.SubContent>
        </Menu.Portal>
      </Menu.Sub>
      <Menu.Separator className="my-1 h-px bg-border" />
      {account ? (
        <Menu.Item
          className={itemClassName}
          disabled={pending}
          onSelect={onLogout}
        >
          <LogOut />
          {t("navigation.sidebar.account.logout")}
        </Menu.Item>
      ) : (
        <Menu.Item
          className={itemClassName}
          disabled={pending}
          onSelect={onLogin}
        >
          <LogIn />
          {t("navigation.sidebar.account.login.action")}
        </Menu.Item>
      )}
    </>
  );
}
