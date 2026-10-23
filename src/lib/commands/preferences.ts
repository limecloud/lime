import {
  getConfig,
  subscribeAppConfigChanged,
  updateConfig,
} from "@/lib/api/appConfig";
import { setCommandBindingOverrides } from "./registry";

export function observeCommandBindings(): () => void {
  let active = true;
  let revision = 0;
  const refresh = async () => {
    const current = ++revision;
    try {
      const config = await getConfig();
      if (active && revision === current)
        setCommandBindingOverrides(
          config.desktop?.["keyboard-shortcuts"] ?? {},
        );
    } catch {
      // 读取失败保留最后有效投影；设置页使用同一配置owner呈现可重试错误。
    }
  };
  const unsubscribe = subscribeAppConfigChanged(() => void refresh());
  void refresh();
  return () => {
    active = false;
    revision += 1;
    unsubscribe();
    setCommandBindingOverrides({});
  };
}

export async function updateCommandBinding(
  id: string,
  bindings: string[] | null,
) {
  return updateConfig((current) => {
    const overrides = { ...current.desktop?.["keyboard-shortcuts"] };
    if (bindings === null) delete overrides[id];
    else overrides[id] = bindings;
    return {
      ...current,
      desktop: { ...current.desktop, "keyboard-shortcuts": overrides },
    };
  });
}

export async function resetCommandBindings() {
  return updateConfig((current) => ({
    ...current,
    desktop: {
      ...current.desktop,
      "keyboard-shortcuts": {},
      "external-browser-link-shortcut": "primary",
    },
  }));
}
