import { useRef, useState, useSyncExternalStore } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  getCloudAccount,
  logoutCloudAccount,
  subscribeCloudAccount,
  startCloudAuthorization,
} from "@/lib/cloudAccount";

import type { Page, PageParams } from "@/types/page";
import { openExternalUrlWithSystemBrowser } from "@/lib/api/externalUrl";
import { runCommand } from "@/lib/commands/registry";
import { PRODUCT_LINKS } from "@/lib/productLinks";
import { NavigationRailButton } from "./AppNavigationRail";
import { ProfileDropdownItems } from "./ProfileDropdownItems";
import {
  resolveAccountDisplayName,
  resolveAccountInitial,
} from "./sidebarAccount";

export function SidebarProfileFooter({
  onNavigate,
}: {
  onNavigate: (page: Page, params?: PageParams) => void;
}) {
  const { t, i18n } = useTranslation("navigation");
  const account = useSyncExternalStore(
    subscribeCloudAccount,
    getCloudAccount,
    getCloudAccount,
  );
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const hasOpenSurfaceRef = useRef(false);
  hasOpenSurfaceRef.current = open;
  const openProductLink = async (url: string) => {
    try {
      await openExternalUrlWithSystemBrowser(url);
    } catch {
      toast.error(t("help.openLinkFailed"));
    }
  };
  const displayName = resolveAccountDisplayName(
    account,
    t("navigation.sidebar.items.settings"),
  );
  const brand = "Lime Cloud";
  const login = async () => {
    if (pending) return;
    setPending(true);
    try {
      await startCloudAuthorization({ language: i18n.language });
      toast.success(t("navigation.sidebar.account.login.opened", { brand }));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("navigation.sidebar.account.login.failed", { brand }),
      );
    } finally {
      setPending(false);
    }
  };
  const logout = async () => {
    if (pending) return;
    setPending(true);
    try {
      await logoutCloudAccount();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("navigation.sidebar.account.logoutFailed"),
      );
    } finally {
      setPending(false);
    }
  };
  return (
    <div
      data-testid="app-sidebar-account-slot"
      className="relative w-9 shrink-0"
    >
      <Menu.Root open={open} onOpenChange={setOpen} modal={false}>
        <Menu.Trigger asChild>
          <NavigationRailButton
            ref={accountButtonRef}
            type="button"
            $active={open}
            aria-label={t("navigation.sidebar.account.openMenu")}
            title={displayName}
            disabled={pending}
            data-testid="app-sidebar-account-button"
          >
            {account ? (
              <span
                aria-hidden="true"
                className="flex size-6 items-center justify-center rounded-full bg-accent text-xs font-medium text-accent-foreground"
              >
                {resolveAccountInitial(displayName)}
              </span>
            ) : (
              <UserRound />
            )}
          </NavigationRailButton>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content
            onCloseAutoFocus={(event) => {
              // 旧菜单的延迟清理不得夺走新菜单或快捷键弹窗的焦点。
              if (
                hasOpenSurfaceRef.current ||
                document.querySelector("[data-keyboard-shortcuts-dialog]")
              )
                event.preventDefault();
            }}
            side="right"
            align="end"
            sideOffset={4}
            alignOffset={-4}
            aria-label={t("navigation.sidebar.account.openMenu")}
            data-testid="app-sidebar-account-menu"
            className="z-50 w-64 rounded-lg border-[0.5px] border-border bg-popover p-1 text-popover-foreground outline-none"
          >
            <ProfileDropdownItems
              account={account}
              displayName={displayName}
              pending={pending}
              onNavigate={(tab) => onNavigate("settings", { tab })}
              onLogin={() => void login()}
              onLogout={() => void logout()}
              onOpenReleases={() =>
                void openProductLink(PRODUCT_LINKS.releases)
              }
              onOpenUserGuide={() =>
                void openProductLink(PRODUCT_LINKS.userGuide)
              }
              onOpenKeyboardShortcuts={() => {
                setOpen(false);
                accountButtonRef.current?.focus();
                runCommand("showKeyboardShortcuts");
              }}
            />
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
    </div>
  );
}
