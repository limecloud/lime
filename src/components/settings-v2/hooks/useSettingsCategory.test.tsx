import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsGroupKey, SettingsTabs } from "@/types/settings";
import { useSettingsCategory, type CategoryGroup } from "./useSettingsCategory";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

interface Mounted {
  container: HTMLDivElement;
  root: Root;
}

const mounted: Mounted[] = [];

function renderHookProbe(onGroups: (groups: CategoryGroup[]) => void) {
  function Probe() {
    onGroups(useSettingsCategory());
    return null;
  }

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<Probe />);
  });

  mounted.push({ container, root });
}

afterEach(() => {
  while (mounted.length > 0) {
    const current = mounted.pop();
    if (!current) {
      break;
    }

    act(() => {
      current.root.unmount();
    });
    current.container.remove();
  }
});

describe("useSettingsCategory", () => {
  it("系统导航应只保留开发者与实验功能合并入口", () => {
    let groups: CategoryGroup[] = [];

    renderHookProbe((nextGroups) => {
      groups = nextGroups;
    });

    const systemGroup = groups.find(
      (group) => group.key === SettingsGroupKey.System,
    );
    const systemKeys = systemGroup?.items.map((item) => item.key) ?? [];
    const developerItem = systemGroup?.items.find(
      (item) => item.key === SettingsTabs.Developer,
    );

    expect(systemKeys).toContain(SettingsTabs.Developer);
    expect(systemKeys).not.toContain(SettingsTabs.Experimental);
    expect(developerItem?.label).toBe("开发者与实验功能");
    expect(developerItem?.experimental).toBe(true);
  });
});
