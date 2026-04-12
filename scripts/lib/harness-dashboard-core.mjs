function normalizeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : fallback;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatTimestamp(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return normalizeString(value, "-");
  }
  return parsed.toLocaleString("zh-CN", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function renderStatCard(label, value, tone = "neutral") {
  return `
    <article class="stat-card ${tone}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
    </article>
  `;
}

function renderSignalList(signals) {
  const items = Array.isArray(signals) ? signals.filter(Boolean) : [];
  if (items.length === 0) {
    return `<p class="empty">当前没有额外信号。</p>`;
  }

  return `
    <ul class="signal-list">
      ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
    </ul>
  `;
}

function renderRecommendationList(recommendations) {
  const items = Array.isArray(recommendations) ? recommendations : [];
  if (items.length === 0) {
    return `<p class="empty">当前没有新的治理建议。</p>`;
  }

  return items
    .map(
      (entry) => {
        const focusVerificationFailureOutcomes = Array.isArray(
          entry.focusVerificationFailureOutcomes,
        )
          ? entry.focusVerificationFailureOutcomes
          : [];
        const focusVerificationRecoveredOutcomes = Array.isArray(
          entry.focusVerificationRecoveredOutcomes,
        )
          ? entry.focusVerificationRecoveredOutcomes
          : [];

        return `
        <article class="recommendation-card">
          <div class="recommendation-head">
            <span class="priority">${escapeHtml(normalizeString(entry.priority, "P?"))}</span>
            <h3>${escapeHtml(normalizeString(entry.title, "未命名建议"))}</h3>
          </div>
          <p>${escapeHtml(
            Array.isArray(entry.rationale) ? entry.rationale.join(" ") : "",
          )}</p>
          ${
            focusVerificationFailureOutcomes.length > 0
              ? `
                <p class="recommendation-meta">
                  <strong>关注 failure outcome：</strong>${escapeHtml(
                    focusVerificationFailureOutcomes.join("、"),
                  )}
                </p>
              `
              : ""
          }
          ${
            focusVerificationRecoveredOutcomes.length > 0
              ? `
                <p class="recommendation-meta">
                  <strong>关注 recovered outcome：</strong>${escapeHtml(
                    focusVerificationRecoveredOutcomes.join("、"),
                  )}
                </p>
              `
              : ""
          }
          ${
            Array.isArray(entry.backlogTools) && entry.backlogTools.length > 0
              ? `
                <div class="recommendation-subsection">
                  <strong>后续动作</strong>
                  <ul class="backlog-list">
                    ${entry.backlogTools
                      .map((item) => `<li>${escapeHtml(item)}</li>`)
                      .join("")}
                  </ul>
                </div>
              `
              : ""
          }
          ${
            Array.isArray(entry.commands) && entry.commands.length > 0
              ? `
                <div class="recommendation-subsection">
                  <strong>推荐命令</strong>
                  <div class="command-list">
                  ${entry.commands
                    .map((command) => `<code>${escapeHtml(command)}</code>`)
                    .join("")}
                </div>
                </div>
              `
              : ""
          }
        </article>
      `;
      },
    )
    .join("");
}

function describeVerificationOutcome(entry) {
  const signal = normalizeString(entry?.signal, "unknown");
  const outcome = normalizeString(entry?.outcome, "unknown");

  if (signal === "artifactValidator" && outcome === "issues_present") {
    return "当前 evidence 已记录 artifact 校验问题，优先回看 validator issue 明细。";
  }
  if (signal === "artifactValidator" && outcome === "fallback_used") {
    return "当前 artifact 导出仍触发 fallback，说明产物结构或修复链未完全稳定。";
  }
  if (signal === "browserVerification" && outcome === "failure") {
    return "浏览器验证已有明确失败结果，优先回挂到 replay 或 smoke 断言。";
  }
  if (signal === "browserVerification" && outcome === "unknown") {
    return "浏览器验证结果仍不明确，需要先补 outcome 再继续扩分析。";
  }
  if (signal === "guiSmoke" && outcome === "failed") {
    return "GUI smoke 已明确失败，应优先收敛到受影响主路径。";
  }
  if (signal === "guiSmoke" && outcome === "passed") {
    return "GUI smoke 已通过，可继续把注意力放回 gap 与其它失败面。";
  }
  if (signal === "artifactValidator" && outcome === "repaired") {
    return "artifact validator 已执行修复，可结合 issues/fallback 判断是否还需继续治理。";
  }
  if (signal === "browserVerification" && outcome === "success") {
    return "浏览器验证已有成功样本，可作为 current 主线路径的正向基线。";
  }

  return "当前 verification outcome 已进入 cleanup 主线，可直接据此定位先修哪层。";
}

const RECOVERED_VERIFICATION_OUTCOMES = new Set([
  "repaired",
  "success",
  "passed",
  "clean",
]);

function isRecoveredVerificationOutcome(entry) {
  return RECOVERED_VERIFICATION_OUTCOMES.has(
    normalizeString(entry?.outcome, "unknown"),
  );
}

function renderFocusTable(title, entries, columns) {
  const rows = Array.isArray(entries) ? entries : [];
  if (rows.length === 0) {
    return `
      <section class="panel">
        <div class="section-header">
          <h2>${escapeHtml(title)}</h2>
        </div>
        <p class="empty">当前没有数据。</p>
      </section>
    `;
  }

  return `
    <section class="panel">
      <div class="section-header">
        <h2>${escapeHtml(title)}</h2>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              ${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${rows
              .map(
                (entry) => `
                  <tr>
                    ${columns
                      .map((column) => `<td>${escapeHtml(String(column.render(entry)))}</td>`)
                      .join("")}
                  </tr>
                `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

export function renderHarnessDashboardHtml({
  summaryReport,
  trendReport,
  cleanupReport,
  title = "Lime Harness Dashboard",
}) {
  const summaryTotals =
    summaryReport && typeof summaryReport === "object" && summaryReport.totals
      ? summaryReport.totals
      : {};
  const trendSummary =
    cleanupReport &&
    typeof cleanupReport === "object" &&
    cleanupReport.summary &&
    cleanupReport.summary.trend
      ? cleanupReport.summary.trend
      : {};
  const governanceSummary =
    cleanupReport &&
    typeof cleanupReport === "object" &&
    cleanupReport.summary &&
    cleanupReport.summary.governance
      ? cleanupReport.summary.governance
      : {};
  const verificationSummary =
    cleanupReport &&
    typeof cleanupReport === "object" &&
    cleanupReport.summary &&
    cleanupReport.summary.verificationOutcomes
      ? cleanupReport.summary.verificationOutcomes
      : {};
  const currentVerificationSummary =
    verificationSummary &&
    typeof verificationSummary.current === "object" &&
    !Array.isArray(verificationSummary.current)
      ? verificationSummary.current
      : {};
  const degradedVerificationSummary =
    verificationSummary &&
    typeof verificationSummary.degraded === "object" &&
    !Array.isArray(verificationSummary.degraded)
      ? verificationSummary.degraded
      : {};
  const trendSignals = Array.isArray(trendReport?.signals) ? trendReport.signals : [];
  const cleanupSignals = Array.isArray(cleanupReport?.signals)
    ? cleanupReport.signals
    : [];
  const recommendations = Array.isArray(cleanupReport?.recommendations)
    ? cleanupReport.recommendations
    : [];
  const sampleRows = Array.isArray(trendReport?.samples) ? trendReport.samples : [];
  const currentVerificationFocusRows = Array.isArray(
    cleanupReport?.focus?.currentObservabilityVerificationOutcomes,
  )
    ? cleanupReport.focus.currentObservabilityVerificationOutcomes.map((entry) => ({
        ...entry,
        role: "current",
      }))
    : [];
  const degradedVerificationFocusRows = Array.isArray(
    cleanupReport?.focus?.degradedObservabilityVerificationOutcomes,
  )
    ? cleanupReport.focus.degradedObservabilityVerificationOutcomes.map(
        (entry) => ({
          ...entry,
          role: "degraded",
        }),
      )
    : [];
  const fallbackVerificationFocusRows = Array.isArray(
    cleanupReport?.focus?.observabilityVerificationOutcomes,
  )
    ? cleanupReport.focus.observabilityVerificationOutcomes.map((entry) => ({
        ...entry,
        role: "mixed",
      }))
    : [];
  const explicitCurrentRecoveredVerificationRows = Array.isArray(
    cleanupReport?.focus?.currentRecoveredObservabilityVerificationOutcomes,
  )
    ? cleanupReport.focus.currentRecoveredObservabilityVerificationOutcomes.map(
        (entry) => ({
          ...entry,
          role: "current",
        }),
      )
    : [];
  const verificationFocusRows =
    currentVerificationFocusRows.length > 0 ||
    degradedVerificationFocusRows.length > 0
      ? [...currentVerificationFocusRows, ...degradedVerificationFocusRows]
      : fallbackVerificationFocusRows;
  const currentRecoveredVerificationRows =
    explicitCurrentRecoveredVerificationRows.length > 0
      ? explicitCurrentRecoveredVerificationRows
      : currentVerificationFocusRows.length > 0
      ? currentVerificationFocusRows.filter((entry) =>
          isRecoveredVerificationOutcome(entry),
        )
      : fallbackVerificationFocusRows.filter((entry) =>
          isRecoveredVerificationOutcome(entry),
        );
  const currentRecoveredVerificationSummary = currentRecoveredVerificationRows
    .slice(0, 3)
    .map(
      (entry) =>
        `${normalizeString(entry?.signal, "-")} (${normalizeString(entry?.outcome, "-")})`,
    )
    .join("、");

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f3f6f4;
        --panel: #ffffff;
        --panel-muted: #f8faf8;
        --border: #d8e1dc;
        --text: #112118;
        --muted: #5f6d64;
        --accent: #0f4c5c;
        --success: #177245;
        --warning: #b45309;
        --danger: #b42318;
        --shadow: 0 16px 32px rgba(17, 33, 24, 0.08);
      }

      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family:
          "SF Pro Display",
          "Segoe UI",
          "PingFang SC",
          "Hiragino Sans GB",
          "Microsoft YaHei",
          sans-serif;
        color: var(--text);
        background:
          radial-gradient(circle at top left, rgba(15, 76, 92, 0.12), transparent 32%),
          radial-gradient(circle at top right, rgba(23, 114, 69, 0.1), transparent 28%),
          var(--bg);
      }

      .page {
        max-width: 1440px;
        margin: 0 auto;
        padding: 28px 22px 42px;
      }

      .hero,
      .panel {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 24px;
        box-shadow: var(--shadow);
      }

      .hero {
        padding: 24px 26px;
        display: grid;
        grid-template-columns: minmax(0, 1.5fr) minmax(280px, 0.9fr);
        gap: 18px;
      }

      .eyebrow {
        display: inline-flex;
        align-items: center;
        padding: 6px 12px;
        border-radius: 999px;
        background: #e8f7ef;
        color: var(--success);
        font-size: 13px;
        font-weight: 700;
      }

      h1, h2, h3, p {
        margin: 0;
      }

      h1 {
        margin-top: 14px;
        font-size: 32px;
        line-height: 1.12;
      }

      .hero p {
        margin-top: 12px;
        color: var(--muted);
        line-height: 1.7;
      }

      .meta-grid,
      .stat-grid,
      .panel-grid {
        display: grid;
        gap: 14px;
      }

      .meta-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .meta-card,
      .stat-card {
        border: 1px solid var(--border);
        border-radius: 18px;
        background: var(--panel-muted);
        padding: 14px 16px;
      }

      .meta-card span,
      .stat-card span {
        display: block;
        font-size: 12px;
        color: var(--muted);
        margin-bottom: 8px;
      }

      .meta-card strong,
      .stat-card strong {
        font-size: 20px;
      }

      .stat-grid {
        margin-top: 18px;
        grid-template-columns: repeat(6, minmax(0, 1fr));
      }

      .stat-card.warning strong { color: var(--warning); }
      .stat-card.danger strong { color: var(--danger); }
      .stat-card.success strong { color: var(--success); }

      .panel-grid {
        margin-top: 20px;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .panel {
        padding: 20px 22px;
      }

      .section-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 14px;
      }

      .section-header p {
        color: var(--muted);
        line-height: 1.6;
      }

      .signal-list {
        margin: 0;
        padding-left: 18px;
        display: grid;
        gap: 10px;
        color: var(--muted);
      }

      .empty {
        color: var(--muted);
        line-height: 1.6;
      }

      .table-wrap {
        overflow-x: auto;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 14px;
      }

      th, td {
        padding: 10px 12px;
        border-bottom: 1px solid var(--border);
        text-align: left;
        vertical-align: top;
      }

      th {
        font-size: 12px;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }

      tr:last-child td {
        border-bottom: none;
      }

      .recommendation-stack {
        display: grid;
        gap: 12px;
      }

      .recommendation-card {
        border: 1px solid var(--border);
        border-radius: 18px;
        padding: 16px;
        background: var(--panel-muted);
      }

      .recommendation-head {
        display: flex;
        gap: 10px;
        align-items: center;
        margin-bottom: 10px;
      }

      .priority {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 44px;
        height: 28px;
        padding: 0 10px;
        border-radius: 999px;
        background: #fff3e8;
        color: var(--warning);
        font-size: 12px;
        font-weight: 700;
      }

      .recommendation-card p {
        color: var(--muted);
        line-height: 1.7;
      }

      .recommendation-meta {
        margin-top: 12px;
        font-size: 14px;
      }

      .recommendation-subsection {
        margin-top: 14px;
      }

      .recommendation-subsection strong {
        display: block;
        margin-bottom: 8px;
        font-size: 13px;
      }

      .backlog-list {
        margin: 0;
        padding-left: 18px;
        display: grid;
        gap: 8px;
        color: var(--muted);
      }

      .command-list {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }

      code {
        display: inline-flex;
        padding: 8px 10px;
        border-radius: 10px;
        background: #102a2c;
        color: #ecfeff;
        font-size: 12px;
        white-space: pre-wrap;
      }

      @media (max-width: 1120px) {
        .hero,
        .panel-grid {
          grid-template-columns: 1fr;
        }

        .stat-grid {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
      }

      @media (max-width: 720px) {
        .page {
          padding: 18px 14px 30px;
        }

        .meta-grid,
        .stat-grid {
          grid-template-columns: 1fr 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <section class="hero">
        <div>
          <span class="eyebrow">Harness Engine Nightly Dashboard</span>
          <h1>${escapeHtml(title)}</h1>
          <p>同一份 evidence-first 主线下的 summary、trend、cleanup 视图。当前面板会明确区分主线 current 缺口与故意保留的 degraded 诊断基线，避免治理优先级被误导。</p>
          <div class="stat-grid">
            ${renderStatCard("Ready Case", normalizeNumber(summaryTotals.readyCount), "success")}
            ${renderStatCard("Invalid Case", normalizeNumber(summaryTotals.invalidCount), normalizeNumber(summaryTotals.invalidCount) > 0 ? "danger" : "neutral")}
            ${renderStatCard("Current Gap", normalizeNumber(trendSummary.latestCurrentObservabilityGapCaseCount), normalizeNumber(trendSummary.latestCurrentObservabilityGapCaseCount) > 0 ? "danger" : "success")}
            ${renderStatCard("Degraded Gap", normalizeNumber(trendSummary.latestDegradedObservabilityGapCaseCount), "warning")}
            ${renderStatCard("Current Blocking", normalizeNumber(currentVerificationSummary.blockingFailureCaseCount), normalizeNumber(currentVerificationSummary.blockingFailureCaseCount) > 0 ? "danger" : "success")}
            ${renderStatCard("Current Advisory", normalizeNumber(currentVerificationSummary.advisoryFailureCaseCount), normalizeNumber(currentVerificationSummary.advisoryFailureCaseCount) > 0 ? "warning" : "neutral")}
            ${renderStatCard("Current Recovered", normalizeNumber(currentVerificationSummary.recoveredCaseCount), normalizeNumber(currentVerificationSummary.recoveredCaseCount) > 0 ? "success" : "neutral")}
            ${renderStatCard("Degraded Blocking", normalizeNumber(degradedVerificationSummary.blockingFailureCaseCount), normalizeNumber(degradedVerificationSummary.blockingFailureCaseCount) > 0 ? "warning" : "neutral")}
            ${renderStatCard("Recovered Outcomes", normalizeNumber(verificationSummary.recoveredCaseCount), normalizeNumber(verificationSummary.recoveredCaseCount) > 0 ? "success" : "neutral")}
            ${renderStatCard("Trend Samples", normalizeNumber(trendSummary.sampleCount))}
            ${renderStatCard("Governance Violations", normalizeNumber(governanceSummary.violationCount), normalizeNumber(governanceSummary.violationCount) > 0 ? "danger" : "neutral")}
          </div>
        </div>
        <div class="meta-grid">
          <div class="meta-card">
            <span>Summary 生成时间</span>
            <strong>${escapeHtml(formatTimestamp(summaryReport?.generatedAt))}</strong>
          </div>
          <div class="meta-card">
            <span>Trend 生成时间</span>
            <strong>${escapeHtml(formatTimestamp(trendReport?.generatedAt))}</strong>
          </div>
          <div class="meta-card">
            <span>Cleanup 生成时间</span>
            <strong>${escapeHtml(formatTimestamp(cleanupReport?.generatedAt))}</strong>
          </div>
          <div class="meta-card">
            <span>当前事实源</span>
            <strong>summary - history - trend - cleanup</strong>
          </div>
          <div class="meta-card">
            <span>当前 Recovered 基线</span>
            <strong>${escapeHtml(
              currentRecoveredVerificationSummary ||
                "当前没有额外的 recovered baseline",
            )}</strong>
          </div>
        </div>
      </section>

      <section class="panel-grid">
        <section class="panel">
          <div class="section-header">
            <div>
              <h2>Trend 信号</h2>
              <p>只把 current gap 当主线风险，degraded gap 仅作为诊断基线保留。</p>
            </div>
          </div>
          ${renderSignalList(trendSignals)}
        </section>
        <section class="panel">
          <div class="section-header">
            <div>
              <h2>Cleanup 信号</h2>
              <p>nightly 治理建议与当前风险摘要。</p>
            </div>
          </div>
          ${renderSignalList(cleanupSignals)}
        </section>
      </section>

      ${renderFocusTable("Observability Gap 角色", [
        {
          role: "current",
          latest: normalizeNumber(trendSummary.latestCurrentObservabilityGapCaseCount),
          delta: normalizeNumber(trendSummary.currentObservabilityGapCaseDelta),
          meaning: "主线样本里的证据缺口，必须优先治理。",
        },
        {
          role: "degraded",
          latest: normalizeNumber(trendSummary.latestDegradedObservabilityGapCaseCount),
          delta: normalizeNumber(trendSummary.degradedObservabilityGapCaseDelta),
          meaning: "刻意保留的诊断基线，不应直接抬高主线优先级。",
        },
      ], [
        { label: "角色", render: (entry) => entry.role },
        { label: "latest case", render: (entry) => entry.latest },
        { label: "delta case", render: (entry) => entry.delta },
        { label: "说明", render: (entry) => entry.meaning },
      ])}

      ${renderFocusTable("Verification Outcome 焦点", verificationFocusRows, [
        { label: "Role", render: (entry) => normalizeString(entry.role, "-") },
        { label: "Signal", render: (entry) => normalizeString(entry.signal, "-") },
        { label: "Outcome", render: (entry) => normalizeString(entry.outcome, "-") },
        { label: "State", render: (entry) => normalizeString(entry.state, "-") },
        { label: "Latest Case", render: (entry) => normalizeNumber(entry?.latest?.caseCount) },
        { label: "Delta Case", render: (entry) => normalizeNumber(entry?.delta?.caseCount) },
        { label: "说明", render: (entry) => describeVerificationOutcome(entry) },
      ])}

      ${renderFocusTable("Current Recovered Baseline", currentRecoveredVerificationRows, [
        { label: "Signal", render: (entry) => normalizeString(entry.signal, "-") },
        { label: "Outcome", render: (entry) => normalizeString(entry.outcome, "-") },
        { label: "Latest Case", render: (entry) => normalizeNumber(entry?.latest?.caseCount) },
        { label: "Delta Case", render: (entry) => normalizeNumber(entry?.delta?.caseCount) },
        { label: "说明", render: (entry) => describeVerificationOutcome(entry) },
      ])}

      ${renderFocusTable("历史窗口样本", sampleRows, [
        { label: "时间", render: (entry) => formatTimestamp(entry.generatedAt) },
        { label: "来源", render: (entry) => normalizeString(entry.sourcePath, "-") },
        { label: "case", render: (entry) => normalizeNumber(entry?.totals?.caseCount) },
        { label: "ready", render: (entry) => normalizeNumber(entry?.totals?.readyCount) },
        { label: "invalid", render: (entry) => normalizeNumber(entry?.totals?.invalidCount) },
        { label: "current gap", render: (entry) => normalizeNumber(entry?.totals?.currentObservabilityGapCaseCount) },
        { label: "degraded gap", render: (entry) => normalizeNumber(entry?.totals?.degradedObservabilityGapCaseCount) },
      ])}

      <section class="panel">
        <div class="section-header">
          <div>
            <h2>Cleanup 建议</h2>
            <p>当前 nightly 建议按已有优先级排序展示，直接复用 cleanup 报告事实源。</p>
          </div>
        </div>
        <div class="recommendation-stack">
          ${renderRecommendationList(recommendations)}
        </div>
      </section>
    </main>
  </body>
</html>`;
}
