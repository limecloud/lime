import { describe, expect, it } from "vitest";
import { settingsSections } from "../../src/components/settings-v2/sections";

import {
  SETTINGS_GATE_A_CRITICAL_TABS,
  SETTINGS_GATE_A_LOCALES,
  SETTINGS_GATE_A_STATE_REQUIREMENTS,
  SETTINGS_GATE_A_TABS,
  SETTINGS_GATE_A_VIEWPORTS,
  buildSettingsGateAEvidence,
  validateSettingsGateARunId,
} from "./project-gate-settings-a-core.mjs";

function observation(viewport, locale, tab, overrides = {}) {
  return {
    viewport,
    locale,
    tab,
    settingsMounted: true,
    activeTabBound: true,
    contentVisible: true,
    contentHasText: true,
    documentLocaleBound: true,
    rawTranslationKeyCount: 0,
    problemTextCount: 0,
    visibleLoadingCount: 0,
    documentOverflow: false,
    navigationVisible: true,
    invokeErrorCount: 0,
    ...overrides,
  };
}

function completeRuntimeObservations() {
  const baseline = SETTINGS_GATE_A_VIEWPORTS.flatMap((viewport) =>
    SETTINGS_GATE_A_TABS.map((tab) =>
      observation(viewport.label, "zh-CN", tab),
    ),
  );
  const locales = SETTINGS_GATE_A_LOCALES.flatMap((locale) =>
    SETTINGS_GATE_A_CRITICAL_TABS.map((tab) =>
      observation("desktop", locale, tab),
    ),
  );
  return [...baseline, ...locales];
}

function completeStateObservations() {
  return SETTINGS_GATE_A_STATE_REQUIREMENTS.map((requirement) => ({
    state: requirement.state,
    tab: "archived-conversations",
    viewport: "desktop",
    locale: "zh-CN",
    fixtureMethod: "thread/list",
    fixtureOutcome: requirement.fixtureOutcome,
    testOnly: true,
    testId: requirement.testId,
    visible: true,
    contentHasText: true,
    role: requirement.role,
    ariaBusy: requirement.ariaBusy,
    retryVisible: requirement.retryVisible,
    rawTranslationKeyCount: 0,
    documentOverflow: false,
    screenshot: `state-${requirement.state}-zh-CN.png`,
  }));
}

function build(overrides = {}) {
  return buildSettingsGateAEvidence({
    candidateRunId: "settings-gate-a-test",
    startedAt: "2026-07-17T00:00:00.000Z",
    completedAt: "2026-07-17T00:01:00.000Z",
    observations: completeRuntimeObservations(),
    screenshots: [
      "desktop.png",
      "compact.png",
      "narrow.png",
      "zh-TW.png",
      "en-US.png",
      "ja-JP.png",
      "ko-KR.png",
      "state-loading-zh-CN.png",
      "state-empty-zh-CN.png",
      "state-error-zh-CN.png",
    ],
    navigationRecovered: true,
    stateObservations: completeStateObservations(),
    ...overrides,
  });
}

describe("project Gate SETTINGS-01 Gate A evidence", () => {
  it("covers every current section without retired navigation targets", () => {
    expect(SETTINGS_GATE_A_TABS).toEqual(
      settingsSections.map((section) => section.key),
    );
  });
  it("fails closed when component-state evidence is missing", () => {
    const evidence = build({ stateObservations: [] });

    expect(evidence.result).toBe("fail");
    expect(evidence.surfaceProof).toEqual({
      surfaceId: "SETTINGS-01",
      proof: "gate-a",
      complete: false,
    });
    expect(evidence.assertions.failed).toEqual([
      "componentStateCoverageComplete",
    ]);
    expect(evidence.missingScenarios).toEqual([
      "loading component-state evidence",
      "empty component-state evidence",
      "error component-state evidence",
    ]);
  });

  it("counts the proof only when structured runtime and state evidence are complete", () => {
    const evidence = build();

    expect(evidence.result).toBe("pass");
    expect(evidence.surfaceProof.complete).toBe(true);
    expect(evidence.missingScenarios).toEqual([]);
    expect(evidence.coverage.stateCoverage.checks).toEqual({
      loading: true,
      empty: true,
      error: true,
    });
  });

  it("rejects error state evidence without a visible retry action", () => {
    const stateObservations = completeStateObservations().map((entry) =>
      entry.state === "error" ? { ...entry, retryVisible: false } : entry,
    );
    const evidence = build({ stateObservations });

    expect(evidence.result).toBe("fail");
    expect(evidence.coverage.stateCoverage.checks.error).toBe(false);
    expect(evidence.missingScenarios).toContain(
      "error component-state evidence",
    );
  });

  it("fails when a required viewport observation is missing", () => {
    const observations = completeRuntimeObservations().filter(
      (entry) =>
        !(
          entry.viewport === "narrow" &&
          entry.locale === "zh-CN" &&
          entry.tab === "browser-extension"
        ),
    );
    const evidence = build({ observations });

    expect(evidence.result).toBe("fail");
    expect(evidence.surfaceProof.complete).toBe(false);
    expect(evidence.assertions.failed).toContain(
      "baselineViewportMatrixComplete",
    );
    expect(evidence.failureClass).toBe("gate-a-renderer-projection");
  });

  it("fails when a tab records an invoke error", () => {
    const observations = completeRuntimeObservations();
    observations[0] = { ...observations[0], invokeErrorCount: 1 };
    const evidence = build({ observations });

    expect(evidence.result).toBe("fail");
    expect(evidence.assertions.failed).toContain("noInvokeErrors");
  });

  it("rejects unsafe run ids", () => {
    expect(() => validateSettingsGateARunId("../escape")).toThrow(
      /invalid project Gate run-id/,
    );
  });
});
