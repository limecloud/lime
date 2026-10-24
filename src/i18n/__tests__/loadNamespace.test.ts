import { describe, expect, it } from "vitest";

import { DEFAULT_SOUL_STYLE_PROFILE_REGISTRY } from "@/lib/soul/style-profiles";
import {
  CORE_NAMESPACES,
  hasBundledNamespace,
  loadBundledI18nResources,
  loadNamespaceResource,
} from "../loadNamespace";
import { SUPPORTED_LOCALES } from "../locales";

describe("i18n namespace loader", () => {
  it("五语资源不得恢复消息知识保存和 saveDraft 页面文案", () => {
    const resources = loadBundledI18nResources();
    const retiredKeys = new Set([
      "agentChat.messageList.actions.saveToKnowledge",
      "agentChat.messageList.artifact.saveDocument",
      "agentChat.messageList.artifact.saveableBadge",
      "knowledgePage.action.saveToMaterials",
      "knowledgePage.default.conversationResult",
    ]);
    for (const locale of SUPPORTED_LOCALES) {
      expect(
        Object.keys(resources[locale].agent).filter(
          (key) =>
            retiredKeys.has(key) || key.startsWith("knowledgePage.save."),
        ),
        locale,
      ).toEqual([]);
    }
  });
  it("Soul 内置风格包文案覆盖所有支持 locale", () => {
    const resources = loadBundledI18nResources();
    const requiredKeys = DEFAULT_SOUL_STYLE_PROFILE_REGISTRY.packs.flatMap(
      (pack) => [
        pack.nameKey,
        pack.descriptionKey,
        ...pack.profiles.flatMap((profile) => [
          profile.nameKey,
          profile.descriptionKey,
        ]),
      ],
    );

    for (const locale of SUPPORTED_LOCALES) {
      for (const key of requiredKeys) {
        expect(
          resources[locale].settings,
          `${locale}/settings should include ${key}`,
        ).toHaveProperty(key);
      }
    }
  });

  it("Soul 本地化不允许新增按 profile 展开的句库", () => {
    const resources = loadBundledI18nResources();
    const forbiddenKeyPattern =
      /^agentChat\.soulInteraction\.(cheeky|warm|cool|calm|cheeky_sassy|warm_supportive|cool_confident|calm_professional)\./u;

    for (const locale of SUPPORTED_LOCALES) {
      for (const [namespace, entries] of Object.entries(resources[locale])) {
        const forbiddenKeys = Object.keys(entries).filter((key) =>
          forbiddenKeyPattern.test(key),
        );
        expect(
          forbiddenKeys,
          `${locale}/${namespace} must keep Soul style out of i18n phrase libraries`,
        ).toEqual([]);
      }
    }
  });

  it("Scheduled Tasks 文案使用 current namespace 且旧 Automation key 不回流", () => {
    const resources = loadBundledI18nResources();

    for (const locale of SUPPORTED_LOCALES) {
      expect(resources[locale].workspace).toHaveProperty(
        "scheduledTasks.editor.validation.threadLineageRequired",
      );
      const retiredAutomationKeys = Object.keys(
        resources[locale].settings,
      ).filter((key) => key.startsWith("settings.automation."));
      expect(
        retiredAutomationKeys,
        `${locale}/settings must not restore retired Automation copy`,
      ).toEqual([]);
    }
  });

  it("普通本地化展示文案不暴露底层来源品牌", () => {
    const resources = loadBundledI18nResources();
    const forbiddenPattern = /\bcodex\b/i;
    const allowedValueFragments = [
      "gpt-5-codex",
      "gpt-5.2-codex",
      "gpt-5.3-codex",
    ];

    for (const locale of SUPPORTED_LOCALES) {
      for (const [namespace, entries] of Object.entries(resources[locale])) {
        for (const [key, value] of Object.entries(entries)) {
          if (
            allowedValueFragments.some((fragment) => value.includes(fragment))
          ) {
            continue;
          }

          expect(
            forbiddenPattern.test(value),
            `${locale}/${namespace}.${key} should use source-neutral display copy`,
          ).toBe(false);
        }
      }
    }
  }, 30_000);

  it("Agent 首字前状态文案覆盖所有支持 locale", () => {
    const resources = loadBundledI18nResources();
    const phases = [
      "submitted",
      "preparing",
      "routing",
      "context",
      "permission_review",
      "failed",
      "cancelled",
    ];

    for (const locale of SUPPORTED_LOCALES) {
      for (const phase of phases) {
        expect(resources[locale].agent).toHaveProperty(
          `agentChat.messageList.firstTokenStatus.${phase}.title`,
        );
        expect(resources[locale].agent).toHaveProperty(
          `agentChat.messageList.firstTokenStatus.${phase}.detail`,
        );
      }
      for (const key of [
        "agentChat.messageList.historicalAssistantPreview.longNotice",
        "agentChat.messageList.historicalTimeline.deferredMeta",
        "agentChat.toolCall.skillContent.action.view",
        "agentChat.toolCall.skillContent.action.expandBody",
        "agentChat.toolCall.skillContent.action.collapseBody",
        "agentChat.toolCall.skillContent.meta.bytes",
        "agentChat.toolCall.commandSummary.title",
        "agentChat.toolCall.commandSummary.command",
        "agentChat.toolCall.commandSummary.cwd",
        "agentChat.toolCall.commandSummary.exitCode",
        "agentChat.toolCall.commandSummary.stdout",
        "agentChat.toolCall.commandSummary.stderr",
        "agentChat.toolCall.commandSummary.sandboxEnabled",
        "agentChat.toolCall.commandSummary.sandboxEnabledWithType",
        "agentChat.toolCall.commandSummary.sandboxDisabled",
        "agentChat.toolCall.commandSummary.truncated",
        "agentChat.toolCall.groupTitle.memory",
        "agentChat.toolCall.label.memoryAddNote",
        "agentChat.toolCall.label.memoryList",
        "agentChat.toolCall.label.memoryRead",
        "agentChat.toolCall.label.memorySearch",
        "agentChat.toolCall.actionOverride.memoryAddNote.completed",
        "agentChat.toolCall.actionOverride.memoryAddNote.failed",
        "agentChat.toolCall.actionOverride.memoryAddNote.running",
        "agentChat.toolCall.actionOverride.memoryList.completed",
        "agentChat.toolCall.actionOverride.memoryList.failed",
        "agentChat.toolCall.actionOverride.memoryList.running",
        "agentChat.toolCall.actionOverride.memoryRead.completed",
        "agentChat.toolCall.actionOverride.memoryRead.failed",
        "agentChat.toolCall.actionOverride.memoryRead.running",
        "agentChat.toolCall.actionOverride.memorySearch.completed",
        "agentChat.toolCall.actionOverride.memorySearch.failed",
        "agentChat.toolCall.actionOverride.memorySearch.running",
        "agentChat.toolCall.memoryEvidence.title",
        "agentChat.toolCall.memoryEvidence.summary.search",
        "agentChat.toolCall.memoryEvidence.path",
        "agentChat.toolCall.memoryEvidence.citation",
        "agentChat.toolCall.memoryEvidence.truncated",
        "agentChat.messageList.artifact.checkpointBadge",
        "agentChat.messageList.artifact.diffBadge",
        "agentChat.messageList.artifact.validationBadge",
        "agentChat.messageList.artifact.agentUiProjectionTitle",
        "agentChat.messageList.artifact.agentUiBadgePrefix",
        "agentChat.messageList.artifact.blockCount",
        "agentChat.messageList.artifact.sourceCount",
        "agentChat.messageList.artifact.locateBlock",
        "agentChat.messageList.artifact.documentSyncedPreview",
        "agentChat.decisionPanel.queuedTitle",
        "agentChat.decisionPanel.permissionHandledTitle",
        "agentChat.decisionPanel.submittedTitle",
        "agentChat.decisionPanel.submittedAnswerLabel",
        "agentChat.decisionPanel.queuedDescription",
        "agentChat.decisionPanel.submittedDescription",
        "agentChat.decisionPanel.infoRequiredTitle",
        "agentChat.decisionPanel.defaultInfoPrompt",
        "agentChat.decisionPanel.answerLabel",
        "agentChat.decisionPanel.answerPlaceholder",
        "agentChat.decisionPanel.supplementLabel",
        "agentChat.decisionPanel.supplementPlaceholder",
        "agentChat.decisionPanel.assistantQuestionTitle",
        "agentChat.decisionPanel.otherLabel",
        "agentChat.decisionPanel.otherPlaceholder",
        "agentChat.decisionPanel.multiSelectHint",
        "agentChat.requestUserInput.submitFailed",
        "agentChat.decisionPanel.permissionRequestTitle",
        "agentChat.decisionPanel.assistantWantsUse",
        "agentChat.decisionPanel.unknownTool",
        "agentChat.decisionPanel.permission.inputbarOnlyHint",
        "agentChat.decisionPanel.action.submitting",
        "agentChat.decisionPanel.action.submit",
        "agentChat.decisionPanel.action.cancelling",
        "agentChat.decisionPanel.action.cancel",
        "agentChat.requestUserInput.nextQuestion",
        "agentChat.requestUserInput.submit",
        "agentChat.decisionPanel.action.submitAnswer",
        "agentChat.decisionPanel.runtimePermission.title",
        "agentChat.decisionPanel.runtimePermission.description",
        "agentChat.decisionPanel.runtimePermission.submittedTitle",
        "agentChat.decisionPanel.runtimePermission.submittedDescription",
        "agentChat.decisionPanel.runtimePermission.deniedDescription",
        "agentChat.decisionPanel.permission.resultLabel",
        "agentChat.decisionPanel.permission.result.allowed",
        "agentChat.decisionPanel.permission.result.denied",
        "agentChat.messageList.history.persistedEntrySummary",
        "agentChat.messageList.history.loadingMore",
        "agentChat.messageList.history.loadMore",
        "agentChat.messageList.taskCenterEmpty.title",
        "agentChat.navbar.appSwitcher.open",
        "agentChat.navbar.appSwitcher.toast.noProjectRoot",
        "agentChat.navbar.appSwitcher.toast.openFailed",
        "agentChat.navbar.environment.branchFallback",
        "agentChat.navbar.environment.changes",
        "agentChat.navbar.environment.failed",
        "agentChat.navbar.environment.loading",
        "agentChat.navbar.environment.local",
        "agentChat.navbar.environment.noGit",
        "agentChat.navbar.environment.noProjectRoot",
        "agentChat.navbar.environment.open",
        "agentChat.navbar.environment.submit",
        "agentChat.navbar.environment.submitUnavailable",
        "agentChat.navbar.environment.title",
        "agentChat.navbar.environment.uncommittedFiles",
        "agentChat.rightSurface.openPanel",
        "agentChat.rightSurface.closePanel",
        "agentChat.rightSurface.newTab.tools",
        "agentChat.rightSurface.newTab.chat",
        "agentChat.rightSurface.newTab.moreTools",
        "agentChat.rightSurface.tabs.shell",
        "agentChat.terminal.exited",
        "agentChat.terminal.noProjectRoot",
        "agentChat.terminal.startFailed",
        "agentChat.terminal.writeFailed",
        "agentChat.terminal.noOutput",
        "agentChat.summary.processes",
        "agentChat.summary.backgroundTerminal",
        "agentChat.summary.stopBackgroundTerminals",
        "agentChat.summary.stopBackgroundTerminalsError",
        "agentChat.fileEditor.edit",
        "agentChat.fileEditor.breadcrumb.ariaLabel",
        "agentChat.fileEditor.breadcrumb.directoryError",
        "agentChat.fileEditor.breadcrumb.emptyDirectory",
        "agentChat.fileEditor.changeTooLarge",
        "agentChat.fileEditor.undo",
        "agentChat.fileEditor.redo",
        "agentChat.fileEditor.saving",
        "agentChat.fileEditor.saveError",
        "agentChat.fileEditor.readOnly",
        "agentChat.fileEditor.loadError",
        "agentChat.fileEditor.editorLabel",
        "agentChat.fileEditor.diskChanged",
        "agentChat.fileEditor.accept",
        "agentChat.fileEditor.reject",
        "agentChat.fileEditor.discardTitle",
        "agentChat.fileEditor.discardDescription",
        "agentChat.fileEditor.continueViewing",
        "agentChat.fileEditor.discardChanges",
        ...[
          "goToLine",
          "go",
          "find",
          "replaceLabel",
          "next",
          "previous",
          "all",
          "matchCase",
          "regexp",
          "byWord",
          "replace",
          "replaceAll",
          "close",
          "currentMatch",
          "onLine",
          "replacedOnLine",
          "replacedMatches",
        ].map((key) => `agentChat.fileEditor.search.${key}`),
        "agentChat.serviceSkills.badge.recent",
        "agentChat.serviceSkills.badge.browserAssist",
        "agentChat.serviceSkills.badge.readyMade",
        "agentChat.serviceSkills.badge.installed",
        "agentChat.serviceSkills.badge.customScene",
        "agentChat.serviceSkills.catalogSource.seeded",
        "agentChat.serviceSkills.catalogSource.synced",
        "agentChat.home.composer.placeholder",
        "agentChat.home.composer.pathReferenceFallbackPrompt",
        "agentChat.inputbar.core.dictation.recording",
        "agentChat.inputbar.core.dictation.recordingLabel",
        "agentChat.inputbar.core.dictation.transcribing",
        "agentChat.inputbar.core.dictation.polishing",
        "agentChat.inputbar.core.dictation.liveTranscript",
        "agentChat.inputbar.core.dictation.polishingTitle",
        "agentChat.inputbar.core.dictation.transcribingTitle",
        "agentChat.inputbar.core.dictation.stopRecording",
        "agentChat.inputbar.core.dictation.start",
        "agentChat.inputbar.core.dictation.disabled",
        "agentChat.inputbar.core.placeholder.fullscreen",
        "agentChat.inputbar.core.placeholder.default",
        "agentChat.inputbar.core.image.previewAlt",
        "agentChat.inputbar.core.image.remove",
        "agentChat.inputbar.core.path.containerLabel",
        "agentChat.inputbar.core.path.localFolder",
        "agentChat.inputbar.core.path.localFile",
        "agentChat.inputbar.core.path.remove",
        "agentChat.inputbar.core.suggestion.acceptTitle",
        "agentChat.inputbar.core.editor.expand",
        "agentChat.inputbar.core.editor.collapse",
        "agentChat.inputbar.core.action.defer",
        "agentChat.inputbar.core.action.stop",
        "agentChat.inputbar.core.action.send",
        "agentChat.inputbar.dictation.feedback.unavailable",
        "agentChat.inputbar.dictation.feedback.enableInSettings",
        "agentChat.inputbar.dictation.feedback.downloadVoiceModel",
        "agentChat.inputbar.dictation.feedback.startFailed",
        "agentChat.inputbar.dictation.feedback.tooShort",
        "agentChat.inputbar.dictation.feedback.emptyTranscript",
        "agentChat.inputbar.dictation.feedback.recognitionFailed",
        "agentChat.inputbar.controller.toast.systemPathDropUnsupported",
        "agentChat.inputbar.composer.workspacePlaceholder.waiting",
        "agentChat.inputbar.composer.workspacePlaceholder.taskCenter",
        "agentChat.inputbar.composer.workspacePlaceholder.default",
        "agentChat.inputbar.tools.task.toast.disabled",
        "agentChat.inputbar.tools.subagent.toast.disabled",
        "agentChat.inputbar.tools.fullscreen.toast.entered",
        "agentChat.inputbar.tools.fullscreen.toast.exited",
        "agentChat.inputbar.imageAttachments.unnamedImage",
        "agentChat.inputbar.imageAttachments.imageReadFailed",
        "agentChat.inputbar.imageAttachments.imageAdded",
        "agentChat.inputbar.imageAttachments.imagePasted",
        "agentChat.inputbar.suggestions.label",
        "agentChat.inputbar.suggestions.addFiles",
        "agentChat.inputbar.suggestions.add",
        "agentChat.inputbar.suggestions.plugins",
        "agentChat.inputbar.suggestions.skills",
        "agentChat.inputbar.suggestions.files",
        "agentChat.inputbar.suggestions.noResults",
        "agentChat.inputbar.suggestions.loading",
        "agentChat.inputbar.suggestions.error",
        "agentChat.inputbar.suggestions.planMode",
        "agentChat.inputbar.suggestions.goal",
        "agentChat.home.hero.slogan",
        "agentChat.inputbar.attachments.failed",
      ]) {
        expect(resources[locale].agent).toHaveProperty(key);
      }
      for (const retiredKey of [
        "agentChat.inputbar.core.path.importAsKnowledge",
        "agentChat.inputbar.core.path.importAction",
      ]) {
        expect(resources[locale].agent).not.toHaveProperty(retiredKey);
      }
    }
  });

  it("应为每个支持 locale 内联核心 namespace", () => {
    const resources = loadBundledI18nResources();

    expect(Object.keys(resources).sort()).toEqual(
      [...SUPPORTED_LOCALES].sort(),
    );
    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(resources[locale]).sort()).toEqual(
        [...CORE_NAMESPACES].sort(),
      );
      expect(resources[locale].common).toHaveProperty("common.save");
      expect(resources[locale].common).toHaveProperty("common.cancel");
      expect(resources[locale].common).toHaveProperty("common.confirm");
      expect(resources[locale].common).toHaveProperty("common.app.loadingPage");
      for (const key of [
        "common.app.configWarning.title",
        "common.app.configWarning.description",
        "common.app.configWarning.descriptionWithPath",
        "common.app.configWarning.descriptionWithDetails",
        "common.app.configWarning.descriptionWithPathAndDetails",
      ]) {
        expect(
          resources[locale].common,
          `${locale}/common should include ${key}`,
        ).toHaveProperty(key);
      }
      expect(resources[locale].common).toHaveProperty(
        "common.splashScreen.slogan",
      );
      expect(resources[locale].common).toHaveProperty(
        "common.splashScreen.subtitle",
      );
      expect(resources[locale].common).toHaveProperty(
        "common.startupLoading.title",
      );
      expect(resources[locale].common).toHaveProperty(
        "common.startupLoading.description",
      );
      expect(resources[locale].common).toHaveProperty(
        "common.confirmDialog.title",
      );
      expect(resources[locale].common).toHaveProperty(
        "common.projectSelector.placeholder.project",
      );
      expect(resources[locale].common).toHaveProperty(
        "common.projectSelector.management.title.workspace",
      );
      expect(resources[locale].common).toHaveProperty(
        "common.projectSelector.toast.renameFailed",
      );
      expect(resources[locale].common).toHaveProperty(
        "common.projectSelector.remove.dangerDescription",
      );
      expect(resources[locale].common).toHaveProperty(
        "common.createProjectDialog.title",
      );
      expect(resources[locale].common).toHaveProperty(
        "common.createProjectDialog.path.select",
      );
      expect(resources[locale].common).toHaveProperty(
        "common.createProjectDialog.path.conflict",
      );
      expect(resources[locale].common).toHaveProperty(
        "common.createProjectDialog.projectType.general",
      );
      expect(resources[locale].common).toHaveProperty(
        "common.projects.rename.nameRequired",
      );
      expect(resources[locale].common).toHaveProperty(
        "common.createProjectDialog.error.unknown",
      );
      expect(resources[locale].common).toHaveProperty(
        "common.deepLink.oauth.success.description",
      );
      expect(resources[locale].common).toHaveProperty(
        "common.deepLink.payment.returned.title",
      );
      expect(resources[locale].common).toHaveProperty(
        "common.app.startup.windows.blockingTitle",
      );
      expect(resources[locale].common).toHaveProperty(
        "common.app.startup.windows.warningTitle",
      );
      expect(resources[locale].common).toHaveProperty(
        "common.updateNotification.version.new",
      );
      expect(resources[locale].common).toHaveProperty(
        "common.execution.latestRunStatus.status.success",
      );
      expect(resources[locale].common).toHaveProperty(
        "common.oemCloudAccess.auth.googleSynced",
      );
      expect(resources[locale].common).toHaveProperty(
        "common.oemCloudAccess.auth.browserPreopenTitle",
      );
      expect(resources[locale].common).toHaveProperty(
        "common.oemCloudAccess.auth.systemBrowserOpenFailedWithMessage",
      );
      expect(resources[locale].common).toHaveProperty(
        "common.oemCloudAccess.payment.returnSyncing",
      );
      expect(resources[locale].common).toHaveProperty(
        "common.oemCloudAccess.session.refreshSuccess",
      );
      expect(resources[locale].common).toHaveProperty(
        "common.oemCloudAccess.emailCode.sent",
      );
      expect(resources[locale].common).toHaveProperty(
        "common.oemCloudAccess.apiKey.createSuccess",
      );
      expect(resources[locale].common).toHaveProperty(
        "common.oemCloudAccess.label.accessMode.session",
      );
      expect(resources[locale].common).toHaveProperty(
        "common.oemLimeHubProviderSync.managedKeyAlias",
      );
      expect(resources[locale].common).toHaveProperty(
        "common.oemLimeHubProviderSync.cloudTokenName",
      );
      expect(resources[locale].common).toHaveProperty(
        "common.modelSelector.header.title",
      );
      expect(resources[locale].common).toHaveProperty(
        "common.modelSelector.header.themeFilter",
      );
      expect(resources[locale].common).toHaveProperty(
        "common.modelSelector.provider.section.cloud",
      );
      expect(resources[locale].common).toHaveProperty(
        "common.modelSelector.model.incompatibleHidden",
      );
      expect(resources[locale].common).toHaveProperty(
        "common.modelSelector.noProvider.dismissAria",
      );
      expect(resources[locale].common).toHaveProperty(
        "common.modelSelector.state.loginRequired",
      );
      expect(resources[locale].common).toHaveProperty(
        "common.modelCapabilities.reasoning.active",
      );
      expect(resources[locale].common).toHaveProperty(
        "common.modelCapabilities.vision.inactive",
      );
      expect(resources[locale].agent).toHaveProperty(
        "skills.repoManager.title",
      );
      expect(resources[locale].agent).toHaveProperty(
        "skills.contentDialog.loading",
      );
      expect(resources[locale].agent).toHaveProperty(
        "skills.contentDialog.section.metadata",
      );
      expect(resources[locale].agent).toHaveProperty(
        "skills.contentDialog.emptyInspection",
      );
      expect(resources[locale].agent).toHaveProperty(
        "skills.repoManager.action.add",
      );
      expect(resources[locale].agent).toHaveProperty(
        "skills.repoManager.message.addFailed",
      );
      expect(resources[locale].agent).toHaveProperty(
        "skills.skillCard.source.builtin",
      );
      expect(resources[locale].agent).toHaveProperty(
        "skills.skillCard.action.install",
      );
      expect(resources[locale].agent).toHaveProperty(
        "skills.skillCard.compliance.standard",
      );
      expect(resources[locale].agent).toHaveProperty(
        "skills.workflowProgress.empty",
      );
      expect(resources[locale].agent).toHaveProperty(
        "skills.workflowProgress.status.retrying",
      );
      expect(resources[locale].agent).toHaveProperty(
        "skills.workflowProgress.summary.running",
      );
      expect(resources[locale].agent).toHaveProperty("skills.page.title");
      expect(resources[locale].agent).toHaveProperty(
        "skills.page.action.refresh",
      );
      expect(resources[locale].agent).toHaveProperty(
        "skills.page.sections.remote.empty",
      );
      expect(resources[locale].agent).toHaveProperty(
        "skills.workspace.header.title",
      );
      expect(resources[locale].agent).toHaveProperty(
        "skills.workspace.serviceSkill.runner.instant.label",
      );
      expect(resources[locale].agent).toHaveProperty(
        "skills.workspace.serviceSkill.factItems.separator",
      );
      expect(resources[locale].agent).toHaveProperty(
        "skills.workspace.serviceSkill.prefill.recentServiceHint",
      );
      expect(resources[locale].agent).toHaveProperty(
        "skills.workspace.serviceSkill.prefill.recentSceneHint",
      );
      expect(resources[locale].agent).toHaveProperty(
        "skills.workspace.serviceSkill.prefill.filledWithMore",
      );
      expect(resources[locale].agent).toHaveProperty(
        "skills.workspace.serviceSkill.prefill.creationReplay.hint",
      );
      expect(resources[locale].agent).toHaveProperty("sceneGate.title");
      expect(resources[locale].agent).toHaveProperty("sceneGate.project.label");
      expect(resources[locale].agent).toHaveProperty(
        "sceneGate.validation.missingSlotsAndProject",
      );
      expect(resources[locale].agent).toHaveProperty(
        "sceneGate.toast.launchFailed",
      );
      expect(resources[locale].agent).toHaveProperty(
        "curatedTask.resultReference.followUpBanner",
      );
      expect(resources[locale].agent).toHaveProperty(
        "curatedTask.resultReference.highlight.status",
      );
      expect(resources[locale].agent).toHaveProperty(
        "generalWorkbench.workflow.current.title",
      );
      expect(resources[locale].agent).toHaveProperty(
        "generalWorkbench.workflow.queue.hiddenCount",
      );
      expect(resources[locale].agent).toHaveProperty(
        "generalWorkbench.workflow.outputs.copyPath",
      );
      expect(resources[locale].agent).toHaveProperty(
        "generalWorkbench.workflow.runDetail.artifactCount",
      );
      expect(resources[locale].agent).toHaveProperty(
        "generalWorkbench.workflow.baseline.badge",
      );
      expect(resources[locale].agent).toHaveProperty(
        "generalWorkbench.workflow.outputs.summary.latestTitle",
      );
      expect(resources[locale].agent).toHaveProperty(
        "generalWorkbench.workflow.activity.summary.latestTitle",
      );
      expect(resources[locale].agent).toHaveProperty(
        "generalWorkbench.workflow.activity.viewRun",
      );
      expect(resources[locale].agent).toHaveProperty(
        "generalWorkbench.workflow.runDetail.summary.curatedTask",
      );
      expect(resources[locale].agent).toHaveProperty(
        "generalWorkbench.workflow.followUp.applyAria",
      );
      expect(resources[locale].agent).toHaveProperty(
        "generalWorkbench.workflow.branch.status.inProgress",
      );
      expect(resources[locale].agent).toHaveProperty(
        "generalWorkbench.workflow.branch.summary.multiple.draft",
      );
      expect(resources[locale].agent).toHaveProperty(
        "generalWorkbench.workflow.handoff.defaultContinuing",
      );
      expect(resources[locale].agent).toHaveProperty(
        "generalWorkbench.workflow.followUp.prompt.withTask",
      );
      expect(resources[locale].agent).toHaveProperty(
        "generalWorkbench.workflow.reviewFeedback.followUpBanner",
      );
      expect(resources[locale].agent).toHaveProperty(
        "skills.workspace.managedJob.created",
      );
      expect(resources[locale].agent).toHaveProperty(
        "curatedTask.templates.recommendation.recentReviewReasonLabel",
      );
      expect(resources[locale].agent).toHaveProperty(
        "skills.scaffoldDialog.title",
      );
      expect(resources[locale].agent).toHaveProperty(
        "skills.scaffoldDialog.action.create",
      );
      expect(resources[locale].agent).toHaveProperty(
        "skills.scaffoldDialog.validation.directory",
      );
      expect(resources[locale].agent).toHaveProperty(
        "agentChat.imageWorkbenchPreview.media.alt",
      );
      expect(resources[locale].agent).toHaveProperty(
        "agentChat.imageWorkbenchPreview.media.open",
      );
      expect(resources[locale].agent).toHaveProperty(
        "agentChat.imageWorkbenchPreview.action.retry",
      );
      expect(resources[locale].agent).toHaveProperty(
        "agentChat.imageWorkbenchPreview.placeholder.generating",
      );
      expect(resources[locale].agent).toHaveProperty(
        "agentChat.imageWorkbenchPreview.placeholder.failed",
      );
      expect(resources[locale].agent).toHaveProperty(
        "agentChat.contentWorkbenchTools.groupTitle",
      );
      expect(resources[locale].agent).toHaveProperty(
        "agentChat.contentWorkbenchTools.label.audioGeneration",
      );
      expect(resources[locale].agent).toHaveProperty(
        "agentChat.contentWorkbenchTools.failure.videoGeneration",
      );
      expect(resources[locale].agent).toHaveProperty(
        "agentChat.contentWorkbenchTools.group.multiple.completed",
      );
      expect(resources[locale].agent).toHaveProperty(
        "agentChat.searchResultPreview.expandMore",
      );
      expect(resources[locale].agent).toHaveProperty(
        "agentChat.searchResultPreview.openAria",
      );
      for (const codeWorkbenchKey of [
        "agentChat.harness.codeWorkbench.title",
        "agentChat.harness.codeWorkbench.badge",
        "agentChat.harness.codeWorkbench.stage.approval.title",
        "agentChat.harness.codeWorkbench.stage.review.description",
        "agentChat.harness.codeWorkbench.metric.fileChanges",
        "agentChat.harness.codeWorkbench.metric.checkpoints",
      ]) {
        expect(resources[locale].agent).toHaveProperty(codeWorkbenchKey);
      }
      for (const codeReviewKey of [
        "agentChat.harness.codeReview.title",
        "agentChat.harness.codeReview.description",
        "agentChat.harness.codeReview.action.review",
        "agentChat.harness.codeReview.metric.files",
        "agentChat.harness.codeReview.metric.outputsPassing",
        "agentChat.harness.codeReview.metric.checkpointsEmpty",
      ]) {
        expect(resources[locale].agent).toHaveProperty(codeReviewKey);
      }
      expect(resources[locale].agent).toHaveProperty(
        "agentChat.harnessVerification.section.title",
      );
      expect(resources[locale].agent).toHaveProperty(
        "agentChat.harnessVerification.artifact.description",
      );
      expect(resources[locale].agent).toHaveProperty(
        "agentChat.incidentPanel.empty",
      );
      expect(resources[locale].agent).toHaveProperty(
        "agentChat.incidentPanel.priorityBadge",
      );
      expect(resources[locale].agent).toHaveProperty(
        "agentChat.browserWorkspace.address",
      );
      expect(resources[locale].workspace).toHaveProperty(
        "workspace.video.promptInput.title",
      );
      expect(resources[locale].workspace).toHaveProperty(
        "workspace.video.canvas.sidebar.collapse",
      );
      expect(resources[locale].workspace).toHaveProperty(
        "workspace.video.workspace.summary.currentModel.label",
      );
      expect(resources[locale].workspace).toHaveProperty(
        "workspace.video.workspace.recentTasks.title",
      );
      expect(resources[locale].workspace).toHaveProperty(
        "workspace.video.workspace.taskStatus.success",
      );
      expect(resources[locale].workspace).toHaveProperty(
        "workspace.video.workspace.taskStatus.generated.label",
      );
      expect(resources[locale].workspace).toHaveProperty(
        "workspace.video.workspace.session.title",
      );
      expect(resources[locale].workspace).toHaveProperty(
        "workspace.video.workspace.session.preview.title",
      );
      expect(resources[locale].workspace).toHaveProperty(
        "workspace.video.workspace.focusedTask.title",
      );
      expect(resources[locale].workspace).toHaveProperty(
        "workspace.video.workspace.focusedTask.source.label",
      );
      expect(resources[locale].workspace).toHaveProperty(
        "workspace.video.workspace.generate.submitted",
      );
      expect(resources[locale].workspace).toHaveProperty(
        "workspace.video.workspace.reference.unsupportedFormat",
      );
      expect(resources[locale].workspace).toHaveProperty(
        "workspace.video.sidebar.intro.title",
      );
      expect(resources[locale].workspace).toHaveProperty(
        "workspace.video.sidebar.reference.start.title",
      );
      expect(resources[locale].workspace).toHaveProperty(
        "workspace.video.sidebar.reference.empty.action",
      );
      expect(resources[locale].workspace).toHaveProperty(
        "workspace.video.sidebar.controls.seed.placeholder",
      );
      expect(resources[locale].workspace).toHaveProperty(
        "workspace.video.sidebar.controls.cameraFixed.tipContent",
      );
      expect(resources[locale].workspace).toHaveProperty(
        "workspace.video.sidebar.model.panel.title",
      );
      expect(resources[locale].workspace).toHaveProperty(
        "workspace.video.sidebar.model.meta.sora2Pro.description",
      );
      expect(resources[locale].workspace).toHaveProperty(
        "workspace.document.editor.placeholder",
      );
      expect(resources[locale].workspace).toHaveProperty(
        "workspace.document.editor.slashCommand.items.image.title",
      );
      expect(resources[locale].workspace).toHaveProperty(
        "workspace.document.editor.slashCommand.prompt.imageUrl",
      );
      expect(resources[locale].workspace).toHaveProperty(
        "workspace.artifactToolbar.type.code",
      );
      expect(resources[locale].workspace).toHaveProperty(
        "workspace.artifactToolbar.writePhase.streaming",
      );
      expect(resources[locale].workspace).toHaveProperty(
        "workspace.artifactToolbar.action.copyContent",
      );
      expect(resources[locale].workspace).toHaveProperty(
        "workspace.artifactRenderer.empty.failed.title",
      );
      expect(resources[locale].workspace).toHaveProperty(
        "workspace.artifactRenderer.fallback.unknownType",
      );
      expect(resources[locale].workspace).toHaveProperty(
        "workspace.canvasAdapter.action.openFullEditor",
      );
      expect(resources[locale].workspace).toHaveProperty(
        "workspace.canvasBreadcrumb.backHome",
      );
      for (const key of [
        "workspace.designCanvasSmoke.header.eyebrow",
        "workspace.designCanvasSmoke.header.title",
        "workspace.designCanvasSmoke.badge.artifactType",
        "workspace.designCanvasSmoke.badge.workspaceBound",
        "workspace.designCanvasSmoke.badge.workspaceUnbound",
        "workspace.designCanvasSmoke.badge.imageTaskAutoRefresh",
        "workspace.designCanvasSmoke.badge.imageTaskLive",
        "workspace.designCanvasSmoke.badge.defaultProvider",
        "workspace.designCanvasSmoke.badge.defaultModel",
        "workspace.designCanvasSmoke.badge.analyzerConfidence",
      ]) {
        expect(resources[locale].workspace).toHaveProperty(key);
      }
      expect(resources[locale].workspace).toHaveProperty(
        "workspace.canvasAdapter.designPreview.visibleLayers",
      );
      expect(resources[locale].workspace).toHaveProperty(
        "workspace.artifactDocument.kind.report",
      );
      expect(resources[locale].workspace).toHaveProperty(
        "workspace.artifactDocument.stats.blocks.label",
      );
      expect(resources[locale].workspace).toHaveProperty(
        "workspace.artifactDocumentBlock.citation.titleFallback",
      );
      expect(resources[locale].workspace).toHaveProperty(
        "workspace.a2uiSubmissionNotice.action.expand",
      );
      expect(resources[locale].workspace).toHaveProperty(
        "workspace.pendingA2UI.status.progressStep",
      );
      expect(resources[locale].workspace).toHaveProperty(
        "workspace.artifactRenderer.previewFallback.systemOpen.title",
      );
      expect(resources[locale].workspace).toHaveProperty(
        "workspace.artifactRenderer.previewFallback.unsupported.detail",
      );
      expect(resources[locale].workspace).toHaveProperty(
        "workspace.artifactRenderer.previewSource.source.url",
      );
      expect(resources[locale].workspace).toHaveProperty(
        "workspace.artifactRenderer.previewSource.source.databaseRecord",
      );
      expect(resources[locale].workspace).toHaveProperty(
        "workspace.artifactRenderer.previewSource.source.app",
      );
      expect(resources[locale].workspace).toHaveProperty(
        "workspace.artifactRenderer.previewSource.empty",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.layout.action.back",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.layout.loading.profile",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.profile.title",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.profile.loading",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.profile.field.displayName.label",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.profile.field.bio.label",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.profile.field.limit",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.profile.action.cancel",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.profile.action.edit",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.profile.action.retry",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.profile.action.save",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.profile.field.cancelAria",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.profile.field.editAria",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.profile.field.saveAria",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.profile.message.loadFailed",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.profile.message.saveFailed",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.profile.message.saved",
      );
      expect(
        resources[locale].settings["settings.profile.message.saveFailed"],
      ).not.toContain("{{error}}");
      expect(
        Object.keys(resources[locale].settings).filter((key) =>
          /^settings\.profile\.(tags|hero|avatar|usage|basic|suggestedTag|status)\./.test(
            key,
          ),
        ),
      ).toEqual([]);
      expect(resources[locale].settings).toHaveProperty(
        "settings.layout.loading.skills",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.about.version.label",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.about.update.errorDownload",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.group.coding",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.appearance.hero.title",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.appearance.colorScheme.options.dream-blossom.label",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.appearance.colorScheme.options.lime-classic.label",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.appearance.colorScheme.options.lime-future.label",
      );
      for (const key of [
        "settings.desktop.title",
        "settings.desktop.general",
        "settings.group.personal",
        "settings.group.integrations",
        "settings.group.coding",
        "settings.desktop.language",
      ]) {
        expect(resources[locale].settings).toHaveProperty(key);
      }
      expect(resources[locale].settings).toHaveProperty(
        "settings.desktop.personalization",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.personalization.instructions",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.memory.soul.styleProfile.title",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.personalization.instructionsDescription",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.personalization.memory",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.personalization.enabled",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.personalization.delete",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.personalization.tools",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.channels.logTail.title",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.channels.logTail.error.invalidRegex",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.channels.workbench.title",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.channels.workbench.currentScope",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.channels.gatewayTunnel.confirm.installCloudflared",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.channels.gatewayTunnel.state.running",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.channels.gatewayRuntime.message.actionFailed",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.channels.wechatRuntime.confirm.removeAccount",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.channels.wechatRuntime.accounts.runningCount",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.system.clipboardPermission.macos.title",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.system.clipboardPermission.message.openSettingsFailedWithMessage",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.mediaServices.title",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.mediaServices.sections.responsiveChat.title",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.mediaServices.card.tipAria",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.providers.importExport.title",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.providers.importExport.export.action.generate",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.providers.importExport.import.result.importedProviders",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.providers.importExport.import.result.errors",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.mediaGeneration.image.title",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.mediaGeneration.video.hint.ready",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.userCenterSession.value.expiresAt.unknown",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.userCenterSession.title",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.userCenterSession.login.google.title",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.agent.skills.advancedEntry.title",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.agent.skills.advancedEntry.tipAria",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.voice.model.action.download",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.voice.page.dictation",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.voice.media.title",
      );
      expect(resources[locale].settings).toHaveProperty(
        "settings.voice.model.message.downloaded",
      );
      expect(resources[locale].errors).toHaveProperty(
        "errors.artifactFallback.title.renderFailed",
      );
      expect(resources[locale].errors).toHaveProperty(
        "errors.artifactFallback.action.copyErrorReport",
      );
      expect(resources[locale].errors).toHaveProperty(
        "errors.svgRenderer.error.renderFailed",
      );
      expect(resources[locale].errors).toHaveProperty(
        "errors.codeRenderer.action.copyCode",
      );
      expect(resources[locale].errors).toHaveProperty(
        "errors.codeRenderer.error.emptyContent",
      );
      expect(resources[locale].errors).toHaveProperty(
        "errors.htmlRenderer.error.renderFailed",
      );
      expect(resources[locale].errors).toHaveProperty(
        "errors.htmlRenderer.action.refreshPreview",
      );
      expect(resources[locale].errors).toHaveProperty(
        "errors.mermaidRenderer.error.syntax",
      );
      expect(resources[locale].errors).toHaveProperty(
        "errors.mermaidRenderer.action.exportDiagram",
      );
      expect(resources[locale].errors).toHaveProperty(
        "errors.crashRecovery.title",
      );
      expect(resources[locale].errors).toHaveProperty(
        "errors.crashRecovery.action.forceReload",
      );
      expect(resources[locale].errors).toHaveProperty(
        "errors.crashRecovery.action.retryOnly",
      );
      expect(resources[locale].errors).toHaveProperty(
        "errors.crashRecovery.message.diagnosticExportedShort",
      );
      expect(resources[locale].errors).toHaveProperty(
        "errors.crashRecovery.moduleImportFailure.prefix",
      );
    }
  });

  it("common 启动文案应明确是界面语言准备", () => {
    const resources = loadBundledI18nResources();

    expect(resources["en-US"].common["common.startupLoading.description"]).toBe(
      "Preparing interface language settings and workspace entry. Please wait.",
    );
    expect(resources["zh-CN"].common["common.startupLoading.description"]).toBe(
      "正在准备界面语言配置与工作台入口，请稍候。",
    );
  });

  it("应能检测已打包 namespace，并把旧 locale 归一后查询", () => {
    expect(hasBundledNamespace("en", "settings")).toBe(true);
    expect(hasBundledNamespace("zh-Hant", "common")).toBe(true);
  });

  it("应在 locale 不支持时回落到 zh-CN resource", () => {
    expect(loadNamespaceResource("fr-FR", "common")["common.save"]).toBe(
      "保存",
    );
    expect(
      loadNamespaceResource("fr-FR", "common")["common.app.loadingPage"],
    ).toBe("页面加载中...");
    expect(
      loadNamespaceResource("fr-FR", "common")["common.confirmDialog.title"],
    ).toBe("确认操作");
    expect(
      loadNamespaceResource("fr-FR", "common")[
        "common.projectSelector.placeholder.project"
      ],
    ).toBe("选择项目");
    expect(
      loadNamespaceResource("fr-FR", "common")[
        "common.createProjectDialog.title"
      ],
    ).toBe("新建项目");
    expect(
      loadNamespaceResource("fr-FR", "common")[
        "common.projects.rename.nameRequired"
      ],
    ).toBe("项目名称不能为空");
    expect(
      loadNamespaceResource("fr-FR", "common")[
        "common.createProjectDialog.error.unknown"
      ],
    ).toBe("未知错误");
    expect(
      loadNamespaceResource("fr-FR", "common")[
        "common.app.startup.windows.blockingTitle"
      ],
    ).toBe("Windows 启动自检发现阻塞问题");
    expect(
      loadNamespaceResource("fr-FR", "common")[
        "common.updateNotification.version.new"
      ],
    ).toBe("发现新版本 {{version}}");
    expect(
      loadNamespaceResource("fr-FR", "common")[
        "common.execution.latestRunStatus.status.success"
      ],
    ).toBe("成功");
    expect(
      loadNamespaceResource("fr-FR", "common")[
        "common.oemCloudAccess.auth.googleSynced"
      ],
    ).toBe("Google 登录成功，已同步云端目录。");
    expect(
      loadNamespaceResource("fr-FR", "common")[
        "common.oemCloudAccess.auth.browserPreopenTitle"
      ],
    ).toBe("正在打开登录页...");
    expect(
      loadNamespaceResource("fr-FR", "common")[
        "common.oemCloudAccess.auth.systemBrowserOpenFailedWithMessage"
      ],
    ).toBe("系统浏览器打开失败：{{message}}");
    expect(
      loadNamespaceResource("fr-FR", "common")[
        "common.oemCloudAccess.payment.returnSyncing"
      ],
    ).toBe("已回到 Lime，正在同步支付状态、权益与账本。");
    expect(
      loadNamespaceResource("fr-FR", "common")[
        "common.oemCloudAccess.session.refreshSuccess"
      ],
    ).toBe("已同步最新云端会话、服务目录与服务技能快照。");
    expect(
      loadNamespaceResource("fr-FR", "common")[
        "common.oemCloudAccess.emailCode.sent"
      ],
    ).toBe("验证码已发送至 {{maskedEmail}}，有效期约 {{minutes}} 分钟。");
    expect(
      loadNamespaceResource("fr-FR", "common")[
        "common.oemCloudAccess.apiKey.createSuccess"
      ],
    ).toBe("已创建 Lime API Key，明文只会在当前页面显示一次。");
    expect(
      loadNamespaceResource("fr-FR", "common")[
        "common.oemCloudAccess.label.accessMode.session"
      ],
    ).toBe("登录会话");
    expect(
      loadNamespaceResource("fr-FR", "common")[
        "common.oemLimeHubProviderSync.managedKeyAlias"
      ],
    ).toBe("Lime 云端模型");
    expect(
      loadNamespaceResource("fr-FR", "common")[
        "common.oemLimeHubProviderSync.cloudTokenName"
      ],
    ).toBe("Lime Desktop Cloud Model Key");
    expect(
      loadNamespaceResource("fr-FR", "agent")[
        "agentChat.browserWorkspace.address"
      ],
    ).toBe("输入网址或搜索");
    expect(
      loadNamespaceResource("fr-FR", "workspace")[
        "workspace.video.promptInput.title"
      ],
    ).toBe("描述你想生成的画面、镜头与节奏");
    expect(
      loadNamespaceResource("fr-FR", "workspace")[
        "workspace.video.canvas.sidebar.collapse"
      ],
    ).toBe("收起侧栏");
    expect(
      loadNamespaceResource("fr-FR", "workspace")[
        "workspace.video.workspace.summary.currentModel.label"
      ],
    ).toBe("当前模型");
    expect(
      loadNamespaceResource("fr-FR", "workspace")[
        "workspace.video.workspace.recentTasks.title"
      ],
    ).toBe("最近任务");
    expect(
      loadNamespaceResource("fr-FR", "workspace")[
        "workspace.video.workspace.taskStatus.success"
      ],
    ).toBe("已完成");
    expect(
      loadNamespaceResource("fr-FR", "workspace")[
        "workspace.video.workspace.taskStatus.generated.label"
      ],
    ).toBe("结果已生成");
    expect(
      loadNamespaceResource("fr-FR", "workspace")[
        "workspace.video.workspace.session.title"
      ],
    ).toBe("继续调整提示词并追踪最新结果");
    expect(
      loadNamespaceResource("fr-FR", "workspace")[
        "workspace.video.workspace.session.preview.title"
      ],
    ).toBe("主预览");
    expect(
      loadNamespaceResource("fr-FR", "workspace")[
        "workspace.video.workspace.focusedTask.title"
      ],
    ).toBe("当前查看任务");
    expect(
      loadNamespaceResource("fr-FR", "workspace")[
        "workspace.video.workspace.focusedTask.source.label"
      ],
    ).toBe("模型链路");
    expect(
      loadNamespaceResource("fr-FR", "workspace")[
        "workspace.video.workspace.generate.submitted"
      ],
    ).toBe("视频任务已提交，正在生成");
    expect(
      loadNamespaceResource("fr-FR", "workspace")[
        "workspace.video.workspace.reference.unsupportedFormat"
      ],
    ).toBe("参考图格式不支持，请重新上传图片");
    expect(
      loadNamespaceResource("fr-FR", "workspace")[
        "workspace.artifactDocument.kind.report"
      ],
    ).toBe("报告");
    expect(
      loadNamespaceResource("fr-FR", "workspace")[
        "workspace.artifactDocument.stats.blocks.label"
      ],
    ).toBe("结构块");
    expect(
      loadNamespaceResource("fr-FR", "workspace")[
        "workspace.artifactDocumentBlock.citation.titleFallback"
      ],
    ).toBe("参考来源");
    expect(
      loadNamespaceResource("fr-FR", "workspace")[
        "workspace.a2uiSubmissionNotice.action.expand"
      ],
    ).toBe("展开");
    expect(
      loadNamespaceResource("fr-FR", "workspace")[
        "workspace.pendingA2UI.status.progressStep"
      ],
    ).toBe("第 {{currentStep}}/{{totalSteps}} 步");
    expect(
      loadNamespaceResource("fr-FR", "settings")[
        "settings.appearance.colorScheme.options.dream-blossom.label"
      ],
    ).toBe("梦樱花境");
    expect(
      loadNamespaceResource("fr-FR", "settings")[
        "settings.about.version.label"
      ],
    ).toBe("版本 {{version}}（{{build}}）");
    expect(
      loadNamespaceResource("fr-FR", "settings")[
        "settings.about.update.errorDownload"
      ],
    ).toBe("暂时无法自动安装更新，请使用网页下载最新版。");
    expect(
      loadNamespaceResource("fr-FR", "settings")[
        "settings.appearance.hero.title"
      ],
    ).toBe("外观");
    expect(
      loadNamespaceResource("fr-FR", "settings")[
        "settings.appearance.colorScheme.options.lime-classic.label"
      ],
    ).toBe("森野秘境");
    expect(
      loadNamespaceResource("fr-FR", "settings")[
        "settings.localEnvironments.title"
      ],
    ).toBe("环境");
    expect(
      loadNamespaceResource("fr-FR", "settings")[
        "settings.localEnvironments.setup"
      ],
    ).toBe("设置脚本");
    expect(
      loadNamespaceResource("fr-FR", "settings")[
        "settings.localEnvironments.showInherited"
      ],
    ).toBe("显示继承的环境（{{count}}）");
    expect(
      loadNamespaceResource("fr-FR", "settings")[
        "settings.agent.skills.advancedEntry.title"
      ],
    ).toBe("高级技能入口");
    expect(
      loadNamespaceResource("fr-FR", "settings")[
        "settings.agent.skills.advancedEntry.tipAria"
      ],
    ).toBe("高级技能入口说明");
    expect(
      loadNamespaceResource("fr-FR", "agent")["skills.repoManager.title"],
    ).toBe("仓库管理");
    expect(
      loadNamespaceResource("fr-FR", "agent")["skills.contentDialog.loading"],
    ).toBe("正在检查 Skill 包...");
    expect(
      loadNamespaceResource("fr-FR", "agent")[
        "skills.contentDialog.section.metadata"
      ],
    ).toBe("元数据");
    expect(
      loadNamespaceResource("fr-FR", "agent")[
        "skills.contentDialog.emptyInspection"
      ],
    ).toBe("暂无 Skill 检查结果");
    expect(
      loadNamespaceResource("fr-FR", "agent")["skills.repoManager.action.add"],
    ).toBe("添加仓库");
    expect(
      loadNamespaceResource("fr-FR", "agent")[
        "skills.repoManager.message.addFailed"
      ],
    ).toBe("添加失败: {{message}}");
    expect(
      loadNamespaceResource("fr-FR", "agent")[
        "skills.skillCard.source.builtin"
      ],
    ).toBe("内置");
    expect(
      loadNamespaceResource("fr-FR", "agent")[
        "skills.skillCard.action.install"
      ],
    ).toBe("安装");
    expect(
      loadNamespaceResource("fr-FR", "agent")[
        "skills.skillCard.compliance.standard"
      ],
    ).toBe("标准");
    expect(
      loadNamespaceResource("fr-FR", "settings")[
        "settings.voice.model.action.download"
      ],
    ).toBe("下载模型");
    expect(
      loadNamespaceResource("fr-FR", "settings")[
        "settings.voice.page.dictation"
      ],
    ).toBe("听写");
    expect(
      loadNamespaceResource("fr-FR", "settings")["settings.voice.media.title"],
    ).toBe("语音服务模型");
    expect(
      loadNamespaceResource("fr-FR", "settings")[
        "settings.voice.model.message.downloaded"
      ],
    ).toBe("{{model}} 模型已下载");
    expect(
      loadNamespaceResource("fr-FR", "errors")[
        "errors.artifactFallback.title.renderFailed"
      ],
    ).toBe("渲染失败");
    expect(
      loadNamespaceResource("fr-FR", "errors")[
        "errors.svgRenderer.error.renderFailed"
      ],
    ).toBe("SVG 渲染失败");
    expect(
      loadNamespaceResource("fr-FR", "errors")[
        "errors.codeRenderer.action.copyCode"
      ],
    ).toBe("复制代码");
    expect(
      loadNamespaceResource("fr-FR", "errors")[
        "errors.htmlRenderer.error.renderFailed"
      ],
    ).toBe("HTML 渲染失败");
    expect(
      loadNamespaceResource("fr-FR", "errors")[
        "errors.mermaidRenderer.error.syntax"
      ],
    ).toBe("Mermaid 语法错误");
    expect(
      loadNamespaceResource("fr-FR", "errors")["errors.crashRecovery.title"],
    ).toBe("应用发生错误，已进入恢复模式");
    expect(
      loadNamespaceResource("fr-FR", "errors")[
        "errors.crashRecovery.action.forceReload"
      ],
    ).toBe("强制刷新资源");
    expect(
      loadNamespaceResource("fr-FR", "errors")[
        "errors.crashRecovery.action.retryOnly"
      ],
    ).toBe("仅重试恢复");
    expect(
      loadNamespaceResource("fr-FR", "errors")[
        "errors.crashRecovery.message.diagnosticExportedShort"
      ],
    ).toBe("诊断文件已导出");
    expect(
      loadNamespaceResource("fr-FR", "errors")[
        "errors.crashRecovery.moduleImportFailure.prefix"
      ],
    ).toBe(
      "检测到前端模块资源加载失败。请优先点击“强制刷新资源”，让应用重新请求最新模块；若仍反复出现，再清理",
    );
  });

  it("应内联主导航 namespace 的首屏文案", () => {
    expect(
      loadNamespaceResource("en-US", "navigation")[
        "navigation.sidebar.items.newChat"
      ],
    ).toBe("New chat");
    expect(
      loadNamespaceResource("zh-CN", "navigation")[
        "navigation.sidebar.items.knowledge"
      ],
    ).toBeUndefined();
  });
});
