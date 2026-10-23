import assert from "node:assert/strict";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  openSettings,
  waitForPageCondition,
} from "../mcp-config-fixture-smoke.mjs";
import { invokeAppServerFromPage } from "../../agent-runtime/claw-chat-current-fixture-rpc.mjs";

export async function runSettingsExecutionPolicyNavigationScenario({
  page,
  options,
  evidenceDir,
  stage,
  waitForSession,
}) {
  const read = async () => {
    const response = await invokeAppServerFromPage(page, "config/read", {
      includeLayers: true,
    });
    assert.ok(response.result?.config);
    return response.result.config;
  };
  const initial = await read();
  const initialPlan =
    initial.agent?.tool_execution?.update_plan_enabled ?? false;
  const field = page.getByRole("switch", {
    name: "启用 update_plan 计划工具",
    exact: true,
  });
  const save = page.getByTestId("execution-policy-save");
  const dialog = page.getByTestId("settings-unsaved-changes-dialog");
  const keep = dialog.getByRole("button", { name: "继续编辑", exact: true });
  const discard = dialog.getByRole("button", { name: "放弃更改", exact: true });
  const clean = () =>
    waitForPageCondition(
      page,
      options,
      () => {
        const save = document.querySelector(
          '[data-testid="execution-policy-save"]',
        );
        return (
          save?.disabled === true && save.textContent.trim() === "保存策略"
        );
      },
      "Execution Policy save acknowledgement and clean draft",
    );
  const open = async () => {
    await openSettings(page, options);
    await page.getByTestId("settings-sidebar-tab-execution-policy").click();
    await field.waitFor({ state: "visible" });
    await clean();
    assert.equal(await field.getAttribute("aria-checked"), String(initialPlan));
  };
  const about = () =>
    waitForPageCondition(
      page,
      options,
      () =>
        document
          .querySelector('[data-testid="settings-sidebar-tab-about"]')
          ?.getAttribute("aria-current") === "page" &&
        !document.querySelector('[data-testid="settings-page-loading"]'),
      "Execution Policy committed About",
    );
  const sameConfig = async (expected, message) => {
    // Never write configuration values or credential-bearing Config to evidence.
    assert.equal(isDeepStrictEqual(await read(), expected), true, message);
  };
  const observations = [];
  for (const target of ["section", "back"]) {
    stage("unsaved-execution-policy-" + target);
    await open();
    await field.click();
    const trigger = {
      section: page.getByTestId("settings-sidebar-tab-about"),
      back: page.getByTestId("settings-back-button"),
    }[target];
    await trigger.click();
    await dialog.waitFor({ state: "visible" });
    await keep.click();
    assert.equal(
      await field.getAttribute("aria-checked"),
      String(!initialPlan),
    );
    await sameConfig(initial, "confirmation never persists Execution Policy");
    await trigger.click();
    await dialog.waitFor({ state: "visible" });
    if (target === "section")
      await page.screenshot({
        path: path.join(evidenceDir, "execution-policy-unsaved-dialog.png"),
      });
    await discard.click();
    await dialog.waitFor({ state: "detached" });
    if (target === "section") {
      await about();
      await page.getByTestId("settings-back-button").click();
    }
    await waitForSession();
    await sameConfig(initial, "discard never persists Execution Policy");
    observations.push({
      target,
      keptInput: true,
      discardedWithoutSave: true,
      sameSessionReturn: true,
    });
  }
  stage("execution-policy-rules-save-and-reopen");
  await open();
  const shellIndex =
    initial.agent?.tool_execution?.shell_command_rules?.length ?? 0;
  const networkIndex =
    initial.agent?.tool_execution?.network_rules?.length ?? 0;
  const shellRule = {
    rule_id: "fixture-shell",
    match_type: "prefix",
    pattern: "echo lime-policy-fixture",
    risk_level: "high",
    reason_code: "",
    reason: "",
  };
  const networkRule = {
    rule_id: "fixture-network",
    match_type: "prefix",
    target: "host",
    pattern: "policy.example.test",
    risk_level: "high",
    reason_code: "",
    reason: "",
  };
  await field.click();
  await page.getByRole("button", { name: "添加命令规则", exact: true }).click();
  const shell = page.getByTestId("shell-rule-" + shellIndex);
  await shell.getByLabel("规则 ID", { exact: true }).fill(shellRule.rule_id);
  await shell.getByLabel("匹配内容", { exact: true }).fill(shellRule.pattern);
  await page.getByRole("button", { name: "添加网络规则", exact: true }).click();
  const network = page.getByTestId("network-rule-" + networkIndex);
  await network
    .getByLabel("规则 ID", { exact: true })
    .fill("fixture-network-draft");
  await network
    .getByLabel("规则 ID", { exact: true })
    .fill(networkRule.rule_id);
  await network
    .getByLabel("匹配内容", { exact: true })
    .fill(networkRule.pattern);
  assert.equal(
    await network.getByLabel("规则 ID", { exact: true }).inputValue(),
    networkRule.rule_id,
  );
  const canonical = (config) => {
    const result = structuredClone(config);
    // Rust omits default ToolExecutionPolicyConfig and its false/empty fields.
    result.agent = {
      ...result.agent,
      tool_execution: {
        update_plan_enabled: false,
        tool_overrides: {},
        shell_command_rules: [],
        network_rules: [],
        ...result.agent?.tool_execution,
      },
    };
    return result;
  };
  const expected = canonical(initial);
  expected.agent.tool_execution.update_plan_enabled = !initialPlan;
  expected.agent.tool_execution.shell_command_rules.push(shellRule);
  expected.agent.tool_execution.network_rules.push(networkRule);
  await save.click();
  await clean();
  const saved = await read();
  assert.equal(
    isDeepStrictEqual(canonical(saved), expected),
    true,
    "full canonical config contains exactly the submitted fields",
  );
  await page.screenshot({
    path: path.join(evidenceDir, "execution-policy-saved.png"),
  });
  await page.getByTestId("settings-sidebar-tab-about").click();
  await about();
  assert.equal(await dialog.count(), 0);
  await page.getByTestId("settings-sidebar-tab-execution-policy").click();
  await field.waitFor({ state: "visible" });
  await clean();
  assert.equal(await field.getAttribute("aria-checked"), String(!initialPlan));
  assert.equal(
    await shell.getByLabel("匹配内容", { exact: true }).inputValue(),
    shellRule.pattern,
  );
  assert.equal(
    await network.getByLabel("匹配内容", { exact: true }).inputValue(),
    networkRule.pattern,
  );
  stage("execution-policy-theme-projection");
  const originalTheme = await page.evaluate(
    () => document.documentElement.dataset.limeTheme || "system",
  );
  const chooseTheme = async (mode) => {
    await page.getByTestId("settings-sidebar-tab-appearance").click();
    await page
      .getByRole("radio", {
        name: { light: "浅色", dark: "深色", system: "跟随系统" }[mode],
        exact: true,
      })
      .click();
    await page.getByTestId("settings-sidebar-tab-execution-policy").click();
    await field.waitFor({ state: "visible" });
    await clean();
  };
  const themes = [];
  for (const [mode, simulatedSystem] of [
    ["light", null],
    ["dark", null],
    ["system", "light"],
    ["system", "dark"],
  ]) {
    await page.emulateMedia({ colorScheme: simulatedSystem });
    await chooseTheme(mode);
    await network.scrollIntoViewIfNeeded();
    const projection = await waitForPageCondition(
      page,
      options,
      ({ mode, effective }) => {
        const root = document.documentElement;
        if (
          root.dataset.limeTheme !== mode ||
          root.dataset.limeThemeEffective !== effective
        )
          return null;
        const input = document.querySelector(
          '[data-testid="execution-policy-warning"]',
        );
        if (!(input instanceof HTMLSelectElement)) return null;
        const style = getComputedStyle(input);
        const rules = [
          ...document.querySelectorAll(
            '[data-testid^="shell-rule-"], [data-testid^="network-rule-"]',
          ),
        ];
        const ruleControlsOverflow = rules.some((rule) => {
          const bounds = rule.getBoundingClientRect();
          return [...rule.querySelectorAll("input, select, button")].some(
            (control) => {
              const rect = control.getBoundingClientRect();
              return (
                rect.left < bounds.left - 1 || rect.right > bounds.right + 1
              );
            },
          );
        });
        const parseColor = (value) => {
          const channels = value.match(/[\d.]+/g)?.map(Number) ?? [];
          return [
            channels[0] ?? 0,
            channels[1] ?? 0,
            channels[2] ?? 0,
            channels[3] ?? 1,
          ];
        };
        const over = (top, bottom) => {
          const alpha = top[3] + bottom[3] * (1 - top[3]);
          return [
            ...[0, 1, 2].map((i) =>
              alpha
                ? (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) /
                  alpha
                : 0,
            ),
            alpha,
          ];
        };
        const background = (element) => {
          let color = [0, 0, 0, 0];
          for (
            let node = element;
            node && color[3] < 1;
            node = node.parentElement
          )
            color = over(
              color,
              parseColor(getComputedStyle(node).backgroundColor),
            );
          return over(color, [255, 255, 255, 1]);
        };
        const luminance = (color) => {
          const linear = color.slice(0, 3).map((channel) => {
            const value = channel / 255;
            return value <= 0.04045
              ? value / 12.92
              : ((value + 0.055) / 1.055) ** 2.4;
          });
          return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
        };
        const controls = rules.flatMap((rule) => [
          ...rule.querySelectorAll("input, select, button"),
        ]);
        const minimumControlContrast = Math.min(
          ...controls.map((control) => {
            const bg = background(control);
            const fg = over(parseColor(getComputedStyle(control).color), bg);
            const values = [luminance(bg), luminance(fg)].sort((a, b) => a - b);
            return (values[1] + 0.05) / (values[0] + 0.05);
          }),
        );
        return {
          mode,
          effective,
          foreground: style.color,
          background: style.backgroundColor,
          viewportOverflow: document.documentElement.scrollWidth > innerWidth,
          ruleControlsOverflow,
          minimumControlContrast,
        };
      },
      "Execution Policy theme projection " + mode + "/" + simulatedSystem,
      { mode, effective: mode === "system" ? simulatedSystem : mode },
    );
    assert.notEqual(
      projection.foreground,
      projection.background,
      "execution-policy input remains legible",
    );
    assert.equal(
      projection.viewportOverflow,
      false,
      "execution-policy has no document horizontal overflow",
    );
    assert.equal(
      projection.ruleControlsOverflow,
      false,
      "rule controls fit inside their editor",
    );
    assert.ok(
      Number.isFinite(projection.minimumControlContrast) &&
        projection.minimumControlContrast >= 4.5,
      "enabled rule control text contrast meets 4.5:1",
    );
    themes.push(projection);
    await page.screenshot({
      path: path.join(
        evidenceDir,
        "execution-policy-theme-" +
          mode +
          (simulatedSystem ? "-" + simulatedSystem : "") +
          ".png",
      ),
    });
  }
  await page.emulateMedia({ colorScheme: null });
  await chooseTheme(originalTheme);
  await sameConfig(
    saved,
    "theme projection does not alter policy configuration",
  );
  stage("execution-policy-remove-rules-and-restore");
  await shell.getByRole("button", { name: "删除", exact: true }).click();
  await network.getByRole("button", { name: "删除", exact: true }).click();
  await field.click();
  await save.click();
  await clean();
  assert.equal(
    isDeepStrictEqual(canonical(await read()), canonical(initial)),
    true,
    "original policy configuration restored through GUI",
  );
  await page.getByTestId("settings-sidebar-tab-about").click();
  await about();
  await page.getByTestId("settings-sidebar-tab-execution-policy").click();
  await field.waitFor({ state: "visible" });
  await clean();
  assert.equal(await shell.count(), 0);
  assert.equal(await network.count(), 0);
  assert.equal(await field.getAttribute("aria-checked"), String(initialPlan));
  await page.getByTestId("settings-back-button").click();
  await waitForSession();
  return {
    observations,
    themes,
    savedAndReopened: true,
    originalConfigRestored: true,
    untouchedConfigurationPreserved: true,
    rules: {
      shellAddedEditedRemoved: true,
      networkAddedEditedRemoved: true,
      savedListsReadBack: true,
    },
    canonicalPolicyShape: {
      initialPresent: Object.hasOwn(initial.agent ?? {}, "tool_execution"),
      savedPresent: Object.hasOwn(saved.agent ?? {}, "tool_execution"),
      defaultOmissionNormalized: true,
    },
    componentOnlyNavigation: {
      target: "new",
      reason:
        "Settings unmounts AppSidebar; no native New entry is available. Canonical navigation is tested with the actual component.",
    },
    limitations:
      "Isolated real Electron/preload/App Server config; external backend bypasses production RuntimeBackend/provider. Diagnostic focus/suggestion, failures, duplicate/in-flight/late completion and five-language behavior use component evidence; this fixture has no policy-block diagnostic entry. System theme is media emulation, current skin only. No tool execution, live provider, Windows or reference runtime parity claim.",
  };
}
