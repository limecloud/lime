import i18n from "i18next";
import { describe, expect, it } from "vitest";
import commonResources from "../resources/zh-CN/common.json";

type CommonResourceKey = keyof typeof commonResources;

function assertI18nKeyTypes() {
  i18n.t("common.save", { ns: "common" });
  i18n.t("common.cancel", { ns: "common" });
  i18n.t("common.confirm", { ns: "common" });
  i18n.t("common.app.loadingPage", { ns: "common" });
  i18n.t("common.splashScreen.slogan", { ns: "common" });
  i18n.t("common.splashScreen.subtitle", { ns: "common" });
  i18n.t("common.startupLoading.title", { ns: "common", brand: "Lime" });
  i18n.t("common.startupLoading.description", { ns: "common" });
  i18n.t("common.confirmDialog.title", { ns: "common" });
  i18n.t("common.projectSelector.placeholder.project", { ns: "common" });
  i18n.t("common.projectSelector.management.title.workspace", {
    ns: "common",
  });
  i18n.t("common.projectSelector.toast.renameFailed", {
    ns: "common",
    message: "name exists",
  });
  i18n.t("common.projectSelector.remove.dangerDescription", { ns: "common" });
  i18n.t("common.createProjectDialog.title", { ns: "common" });
  i18n.t("common.createProjectDialog.path.select", { ns: "common" });
  i18n.t("common.createProjectDialog.path.conflict", {
    ns: "common",
    name: "Project Alpha",
  });
  i18n.t("common.createProjectDialog.projectType.general", { ns: "common" });
  i18n.t("common.projects.rename.nameRequired", { ns: "common" });
  i18n.t("common.createProjectDialog.error.unknown", { ns: "common" });
  i18n.t("common.deepLink.oauth.success.description", {
    ns: "common",
    providerName: "Lime Hub",
  });
  i18n.t("common.deepLink.payment.returned.title", { ns: "common" });
  i18n.t("common.app.startup.windows.blockingTitle", { ns: "common" });
  i18n.t("common.app.startup.windows.warningTitle", { ns: "common" });
  i18n.t("common.updateNotification.version.new", { ns: "common" });
  i18n.t("common.execution.latestRunStatus.status.success", { ns: "common" });
  i18n.t("common.oemCloudAccess.auth.googleSynced", { ns: "common" });
  i18n.t("common.oemCloudAccess.auth.browserPreopenTitle", { ns: "common" });
  i18n.t("common.oemCloudAccess.auth.systemBrowserOpenFailedWithMessage", {
    ns: "common",
  });
  i18n.t("common.oemCloudAccess.payment.returnSyncing", { ns: "common" });
  i18n.t("common.oemCloudAccess.session.refreshSuccess", { ns: "common" });
  i18n.t("common.oemCloudAccess.emailCode.sent", { ns: "common" });
  i18n.t("common.oemCloudAccess.apiKey.createSuccess", { ns: "common" });
  i18n.t("common.oemCloudAccess.label.accessMode.session", {
    ns: "common",
  });
  i18n.t("common.oemLimeHubProviderSync.managedKeyAlias", { ns: "common" });
  i18n.t("common.oemLimeHubProviderSync.cloudTokenName", { ns: "common" });
  i18n.t("common.modelSelector.header.title", { ns: "common" });
  i18n.t("common.modelSelector.header.themeFilter", {
    ns: "common",
    theme: "General chat",
  });
  i18n.t("common.modelSelector.provider.section.cloud", { ns: "common" });
  i18n.t("common.modelSelector.model.incompatibleHidden", {
    ns: "common",
    count: 2,
  });
  i18n.t("common.modelSelector.noProvider.dismissAria", { ns: "common" });
  i18n.t("common.modelSelector.state.loginRequired", { ns: "common" });
  i18n.t("common.modelCapabilities.reasoning.active", { ns: "common" });
  i18n.t("common.modelCapabilities.vision.inactive", { ns: "common" });
  i18n.t("skills.contentDialog.loading", { ns: "agent" });
  i18n.t("skills.contentDialog.section.metadata", { ns: "agent" });
  i18n.t("skills.contentDialog.emptyInspection", { ns: "agent" });
  i18n.t("skills.repoManager.title", { ns: "agent" });
  i18n.t("skills.repoManager.action.add", { ns: "agent" });
  i18n.t("skills.repoManager.message.addFailed", {
    ns: "agent",
    message: "network down",
  });
  i18n.t("agentChat.messageList.historicalAssistantPreview.longNotice", {
    ns: "agent",
    countLabel: "12,000",
  });
  i18n.t("agentChat.messageList.historicalTimeline.meta", {
    ns: "agent",
    stepCountLabel: "3",
    meta: "2 tool steps",
  });
  i18n.t("agentChat.toolCall.skillContent.action.view", { ns: "agent" });
  i18n.t("agentChat.toolCall.skillContent.action.expandBody", {
    ns: "agent",
  });
  i18n.t("agentChat.toolCall.skillContent.action.collapseBody", {
    ns: "agent",
  });
  i18n.t("agentChat.toolCall.skillContent.meta.bytes", {
    ns: "agent",
    count: 1024,
  });
  i18n.t("agentChat.toolCall.commandSummary.title", { ns: "agent" });
  i18n.t("agentChat.toolCall.commandSummary.command", { ns: "agent" });
  i18n.t("agentChat.toolCall.commandSummary.cwd", { ns: "agent" });
  i18n.t("agentChat.toolCall.commandSummary.exitCode", {
    ns: "agent",
    value: 0,
  });
  i18n.t("agentChat.toolCall.commandSummary.stdout", {
    ns: "agent",
    value: 128,
  });
  i18n.t("agentChat.toolCall.commandSummary.stderr", {
    ns: "agent",
    value: 0,
  });
  i18n.t("agentChat.toolCall.commandSummary.sandboxEnabled", { ns: "agent" });
  i18n.t("agentChat.toolCall.commandSummary.sandboxEnabledWithType", {
    ns: "agent",
    type: "workspace-write",
  });
  i18n.t("agentChat.toolCall.commandSummary.sandboxDisabled", { ns: "agent" });
  i18n.t("agentChat.toolCall.commandSummary.truncated", { ns: "agent" });
  i18n.t("agentChat.messageList.artifact.checkpointBadge", { ns: "agent" });
  i18n.t("agentChat.messageList.artifact.diffBadge", {
    ns: "agent",
    count: 1,
  });
  i18n.t("agentChat.messageList.artifact.validationBadge", {
    ns: "agent",
    count: 2,
  });
  i18n.t("agentChat.messageList.artifact.agentUiProjectionTitle", {
    ns: "agent",
  });
  i18n.t("agentChat.messageList.artifact.agentUiBadgePrefix", {
    ns: "agent",
  });
  i18n.t("agentChat.messageList.artifact.blockCount", {
    ns: "agent",
    count: 2,
  });
  i18n.t("agentChat.messageList.artifact.sourceCount", {
    ns: "agent",
    count: 1,
  });
  i18n.t("agentChat.messageList.artifact.locateBlock", {
    ns: "agent",
    label: "摘要",
  });
  i18n.t("agentChat.messageList.artifact.documentSyncedPreview", {
    ns: "agent",
  });
  i18n.t("agentChat.decisionPanel.queuedTitle", { ns: "agent" });
  i18n.t("agentChat.decisionPanel.permissionHandledTitle", { ns: "agent" });
  i18n.t("agentChat.decisionPanel.submittedTitle", { ns: "agent" });
  i18n.t("agentChat.decisionPanel.submittedAnswerLabel", { ns: "agent" });
  i18n.t("agentChat.decisionPanel.queuedDescription", { ns: "agent" });
  i18n.t("agentChat.decisionPanel.submittedDescription", { ns: "agent" });
  i18n.t("agentChat.decisionPanel.infoRequiredTitle", { ns: "agent" });
  i18n.t("agentChat.decisionPanel.defaultInfoPrompt", { ns: "agent" });
  i18n.t("agentChat.decisionPanel.answerLabel", { ns: "agent" });
  i18n.t("agentChat.decisionPanel.answerPlaceholder", { ns: "agent" });
  i18n.t("agentChat.decisionPanel.supplementLabel", { ns: "agent" });
  i18n.t("agentChat.decisionPanel.supplementPlaceholder", { ns: "agent" });
  i18n.t("agentChat.decisionPanel.assistantQuestionTitle", { ns: "agent" });
  i18n.t("agentChat.decisionPanel.otherLabel", { ns: "agent" });
  i18n.t("agentChat.decisionPanel.otherPlaceholder", { ns: "agent" });
  i18n.t("agentChat.decisionPanel.multiSelectHint", { ns: "agent" });
  i18n.t("agentChat.requestUserInput.submitFailed", {
    ns: "agent",
  });
  i18n.t("agentChat.decisionPanel.permissionRequestTitle", { ns: "agent" });
  i18n.t("agentChat.decisionPanel.assistantWantsUse", { ns: "agent" });
  i18n.t("agentChat.decisionPanel.unknownTool", { ns: "agent" });
  i18n.t("agentChat.decisionPanel.permission.inputbarOnlyHint", {
    ns: "agent",
  });
  i18n.t("agentChat.decisionPanel.action.submitting", { ns: "agent" });
  i18n.t("agentChat.decisionPanel.action.submit", { ns: "agent" });
  i18n.t("agentChat.decisionPanel.action.cancelling", { ns: "agent" });
  i18n.t("agentChat.decisionPanel.action.cancel", { ns: "agent" });
  i18n.t("agentChat.requestUserInput.nextQuestion", { ns: "agent" });
  i18n.t("agentChat.requestUserInput.submit", { ns: "agent" });
  i18n.t("agentChat.decisionPanel.action.submitAnswer", { ns: "agent" });
  i18n.t("agentChat.decisionPanel.runtimePermission.title", { ns: "agent" });
  i18n.t("agentChat.decisionPanel.runtimePermission.description", {
    ns: "agent",
  });
  i18n.t("agentChat.decisionPanel.runtimePermission.submittedTitle", {
    ns: "agent",
  });
  i18n.t("agentChat.decisionPanel.runtimePermission.submittedDescription", {
    ns: "agent",
  });
  i18n.t("agentChat.decisionPanel.runtimePermission.deniedDescription", {
    ns: "agent",
  });
  i18n.t("agentChat.decisionPanel.permission.resultLabel", { ns: "agent" });
  i18n.t("agentChat.decisionPanel.permission.result.allowed", { ns: "agent" });
  i18n.t("agentChat.decisionPanel.permission.result.denied", { ns: "agent" });
  i18n.t("agentChat.messageList.history.windowEntrySummaryRestored", {
    ns: "agent",
    loaded: "40",
    hidden: "30",
  });
  i18n.t("agentChat.messageList.history.persistedEntrySummary", {
    ns: "agent",
    loaded: "40",
  });
  i18n.t("agentChat.messageList.taskCenterEmpty.title", { ns: "agent" });
  i18n.t("agentChat.serviceSkills.badge.recent", { ns: "agent" });
  i18n.t("agentChat.serviceSkills.badge.browserAssist", { ns: "agent" });
  i18n.t("agentChat.serviceSkills.badge.readyMade", { ns: "agent" });
  i18n.t("agentChat.serviceSkills.badge.installed", { ns: "agent" });
  i18n.t("agentChat.serviceSkills.badge.customScene", { ns: "agent" });
  i18n.t("agentChat.serviceSkills.catalogSource.seeded", { ns: "agent" });
  i18n.t("agentChat.serviceSkills.catalogSource.synced", { ns: "agent" });
  i18n.t("agentExperts.title", { ns: "agent" });
  i18n.t("agentExperts.info.sections.workflow", { ns: "agent" });
  i18n.t("agentExperts.info.boundary.soul", { ns: "agent" });
  i18n.t("agentExperts.chat.runtimePrompt", {
    ns: "agent",
    title: "合同审阅",
    summary: "审查合同风险",
    personaRef: "expert-persona:contract-reviewer@1.0.0",
    memoryTemplateRef: "memory-template:contract-reviewer@1.0.0",
    skillRefs: "skill:document-review",
    workflowRefs: "workflow:contract-risk-review",
    starter: "帮我审这份协议",
  });
  i18n.t("agentChat.home.composer.placeholder", { ns: "agent" });
  i18n.t("agentChat.home.composer.pathReferenceFallbackPrompt", {
    ns: "agent",
  });

  i18n.t("agentChat.inputbar.core.dictation.recording", {
    ns: "agent",
    duration: "0:12",
  });
  i18n.t("agentChat.inputbar.core.dictation.recordingLabel", { ns: "agent" });
  i18n.t("agentChat.inputbar.core.dictation.transcribing", { ns: "agent" });
  i18n.t("agentChat.inputbar.core.dictation.polishing", { ns: "agent" });
  i18n.t("agentChat.inputbar.core.dictation.liveTranscript", {
    ns: "agent",
  });
  i18n.t("agentChat.inputbar.core.dictation.polishingTitle", {
    ns: "agent",
  });
  i18n.t("agentChat.inputbar.core.dictation.transcribingTitle", {
    ns: "agent",
  });
  i18n.t("agentChat.inputbar.core.dictation.stopRecording", {
    ns: "agent",
    label: "Recording 0:12",
  });
  i18n.t("agentChat.inputbar.core.dictation.start", { ns: "agent" });
  i18n.t("agentChat.inputbar.core.dictation.disabled", { ns: "agent" });
  i18n.t("agentChat.inputbar.core.placeholder.fullscreen", { ns: "agent" });
  i18n.t("agentChat.inputbar.core.placeholder.default", { ns: "agent" });
  i18n.t("agentChat.inputbar.core.image.previewAlt", {
    ns: "agent",
    index: 1,
  });
  i18n.t("agentChat.inputbar.core.image.remove", {
    ns: "agent",
    index: 1,
  });
  i18n.t("agentChat.inputbar.core.path.containerLabel", { ns: "agent" });
  i18n.t("agentChat.inputbar.core.path.localFolder", { ns: "agent" });
  i18n.t("agentChat.inputbar.core.path.localFile", { ns: "agent" });
  i18n.t("agentChat.inputbar.core.path.remove", {
    ns: "agent",
    name: "brief.txt",
  });
  i18n.t("agentChat.inputbar.core.suggestion.acceptTitle", { ns: "agent" });
  i18n.t("agentChat.inputbar.core.editor.expand", { ns: "agent" });
  i18n.t("agentChat.inputbar.core.editor.collapse", { ns: "agent" });
  i18n.t("agentChat.inputbar.core.action.defer", { ns: "agent" });
  i18n.t("agentChat.inputbar.core.action.stop", { ns: "agent" });
  i18n.t("agentChat.inputbar.core.action.send", { ns: "agent" });
  i18n.t("agentChat.inputbar.dictation.feedback.unavailable", { ns: "agent" });
  i18n.t("agentChat.inputbar.dictation.feedback.enableInSettings", {
    ns: "agent",
  });
  i18n.t("agentChat.inputbar.dictation.feedback.downloadVoiceModel", {
    ns: "agent",
  });
  i18n.t("agentChat.inputbar.dictation.feedback.startFailed", {
    ns: "agent",
  });
  i18n.t("agentChat.inputbar.dictation.feedback.tooShort", { ns: "agent" });
  i18n.t("agentChat.inputbar.dictation.feedback.emptyTranscript", {
    ns: "agent",
  });
  i18n.t("agentChat.inputbar.dictation.feedback.recognitionFailed", {
    ns: "agent",
  });
  i18n.t("agentChat.inputbar.controller.toast.systemPathDropUnsupported", {
    ns: "agent",
  });
  i18n.t("agentChat.inputbar.composer.workspacePlaceholder.waiting", {
    ns: "agent",
  });
  i18n.t("agentChat.inputbar.composer.workspacePlaceholder.taskCenter", {
    ns: "agent",
  });
  i18n.t("agentChat.inputbar.composer.workspacePlaceholder.default", {
    ns: "agent",
  });
  i18n.t("agentChat.inputbar.tools.task.toast.enabled", { ns: "agent" });
  i18n.t("agentChat.inputbar.tools.task.toast.disabled", { ns: "agent" });
  i18n.t("agentChat.inputbar.tools.subagent.toast.enabled", { ns: "agent" });
  i18n.t("agentChat.inputbar.tools.subagent.toast.disabled", { ns: "agent" });
  i18n.t("agentChat.inputbar.tools.fullscreen.toast.entered", {
    ns: "agent",
  });
  i18n.t("agentChat.inputbar.tools.fullscreen.toast.exited", { ns: "agent" });
  i18n.t("agentChat.inputbar.imageAttachments.unnamedImage", { ns: "agent" });
  i18n.t("agentChat.inputbar.imageAttachments.imageReadFailed", {
    ns: "agent",
    fileName: "cover.png",
  });
  i18n.t("agentChat.inputbar.imageAttachments.imageAdded", {
    ns: "agent",
    fileName: "cover.png",
  });
  i18n.t("agentChat.inputbar.imageAttachments.imagePasted", { ns: "agent" });
  i18n.t("agentChat.inputbar.suggestions.label", { ns: "agent" });
  i18n.t("agentChat.inputbar.suggestions.addFiles", { ns: "agent" });
  i18n.t("agentChat.inputbar.suggestions.add", { ns: "agent" });
  i18n.t("agentChat.inputbar.suggestions.plugins", { ns: "agent" });
  i18n.t("agentChat.inputbar.suggestions.skills", { ns: "agent" });
  i18n.t("agentChat.inputbar.suggestions.files", { ns: "agent" });
  i18n.t("agentChat.inputbar.suggestions.noResults", { ns: "agent" });
  i18n.t("agentChat.inputbar.suggestions.loading", { ns: "agent" });
  i18n.t("agentChat.inputbar.suggestions.error", { ns: "agent" });
  i18n.t("agentChat.inputbar.suggestions.planMode", { ns: "agent" });
  i18n.t("agentChat.inputbar.suggestions.goal", { ns: "agent" });
  i18n.t("agentChat.home.hero.slogan", { ns: "agent" });

  i18n.t("agentChat.inputbar.attachments.failed", { ns: "agent" });
  i18n.t("skills.skillCard.source.builtin", { ns: "agent" });
  i18n.t("skills.skillCard.action.install", { ns: "agent" });
  i18n.t("skills.skillCard.compliance.standard", { ns: "agent" });
  i18n.t("skills.workflowProgress.empty", { ns: "agent" });
  i18n.t("skills.workflowProgress.status.retrying", { ns: "agent" });
  i18n.t("skills.workflowProgress.summary.running", {
    ns: "agent",
    current: 1,
    total: 3,
  });
  i18n.t("skills.page.title", { ns: "agent" });
  i18n.t("skills.page.action.refresh", { ns: "agent" });
  i18n.t("skills.page.sections.remote.empty", { ns: "agent" });
  i18n.t("skills.workspace.header.title", { ns: "agent" });
  i18n.t("skills.workspace.serviceSkill.runner.instant.label", {
    ns: "agent",
  });
  i18n.t("skills.workspace.serviceSkill.factItems.separator", { ns: "agent" });
  i18n.t("skills.workspace.serviceSkill.prefill.recentServiceHint", {
    ns: "agent",
    title: "Deep Research",
  });
  i18n.t("skills.workspace.serviceSkill.prefill.recentSceneHint", {
    ns: "agent",
    title: "/x export",
  });
  i18n.t("skills.workspace.serviceSkill.prefill.filledWithMore", {
    ns: "agent",
    items: "Topic",
    remaining: "1",
    total: "2",
  });
  i18n.t("skills.workspace.serviceSkill.prefill.creationReplay.hint", {
    ns: "agent",
    fields: "Topic",
    source: "the current idea",
  });
  i18n.t("sceneGate.title", {
    ns: "agent",
    title: "X Article Export",
  });
  i18n.t("sceneGate.project.label", { ns: "agent" });
  i18n.t("sceneGate.validation.missingSlotsAndProject", {
    ns: "agent",
    fields: "Article URL",
    project: "Project workspace",
  });
  i18n.t("sceneGate.toast.launchFailed", {
    ns: "agent",
    message: "network down",
  });
  i18n.t("curatedTask.resultReference.followUpBanner", {
    ns: "agent",
    title: "Break Down a Viral Piece",
  });
  i18n.t("curatedTask.resultReference.highlight.status", {
    ns: "agent",
    value: "Ready to review",
  });
  i18n.t("generalWorkbench.workflow.current.title", { ns: "agent" });
  i18n.t("generalWorkbench.workflow.queue.hiddenCount", {
    ns: "agent",
    visible: 2,
    hidden: 1,
  });
  i18n.t("generalWorkbench.workflow.outputs.copyPath", { ns: "agent" });
  i18n.t("generalWorkbench.workflow.runDetail.artifactCount", {
    ns: "agent",
    count: 3,
  });
  i18n.t("generalWorkbench.workflow.baseline.badge", { ns: "agent" });
  i18n.t("generalWorkbench.workflow.outputs.summary.latestTitle", {
    ns: "agent",
    label: "Drafts",
  });
  i18n.t("generalWorkbench.workflow.activity.summary.latestTitle", {
    ns: "agent",
    name: "Tool run",
  });
  i18n.t("generalWorkbench.workflow.activity.viewRun", {
    ns: "agent",
    run: "abc123",
  });
  i18n.t("generalWorkbench.workflow.runDetail.summary.curatedTask", {
    ns: "agent",
    title: "Review",
  });
  i18n.t("generalWorkbench.workflow.followUp.applyAria", {
    ns: "agent",
    action: "Expand",
  });
  i18n.t("generalWorkbench.workflow.branch.status.inProgress", {
    ns: "agent",
  });
  i18n.t("generalWorkbench.workflow.branch.summary.multiple.draft", {
    ns: "agent",
    title: "Draft A",
    count: 2,
  });
  i18n.t("generalWorkbench.workflow.handoff.defaultContinuing", {
    ns: "agent",
    branchTitle: "Continuable drafts",
  });
  i18n.t("generalWorkbench.workflow.followUp.prompt.withTask", {
    ns: "agent",
    title: "Review",
    action: "Expand",
  });
  i18n.t("generalWorkbench.workflow.reviewFeedback.followUpBanner", {
    ns: "agent",
    title: "Next task",
  });
  i18n.t("skills.workspace.managedJob.created", {
    ns: "agent",
    name: "Daily Review",
  });
  i18n.t("curatedTask.templates.recommendation.recentReviewReasonLabel", {
    ns: "agent",
  });
  i18n.t("skills.scaffoldDialog.title", { ns: "agent" });
  i18n.t("skills.scaffoldDialog.action.create", { ns: "agent" });
  i18n.t("skills.scaffoldDialog.sourceHint", {
    ns: "agent",
    hint: "research result",
  });
  i18n.t("skills.scaffoldDialog.validation.directory", { ns: "agent" });
  i18n.t("agentChat.imageWorkbenchPreview.media.alt", { ns: "agent" });
  i18n.t("agentChat.imageWorkbenchPreview.media.open", { ns: "agent" });
  i18n.t("agentChat.imageWorkbenchPreview.action.retry", { ns: "agent" });
  i18n.t("agentChat.imageWorkbenchPreview.placeholder.generating", {
    ns: "agent",
  });
  i18n.t("agentChat.imageWorkbenchPreview.placeholder.failed", {
    ns: "agent",
  });
  i18n.t("agentChat.contentWorkbenchTools.groupTitle", { ns: "agent" });
  i18n.t("agentChat.contentWorkbenchTools.label.audioGeneration", {
    ns: "agent",
  });
  i18n.t("agentChat.contentWorkbenchTools.failure.videoGeneration", {
    ns: "agent",
  });
  i18n.t("agentChat.contentWorkbenchTools.group.multiple.completed", {
    ns: "agent",
    count: 2,
  });
  i18n.t("agentChat.searchResultPreview.expandMore", {
    ns: "agent",
    countLabel: "2",
  });
  i18n.t("agentChat.searchResultPreview.openAria", {
    ns: "agent",
    title: "Example",
  });
  i18n.t("agentChat.harness.codeWorkbench.title", { ns: "agent" });
  i18n.t("agentChat.harness.codeWorkbench.stage.review.description", {
    ns: "agent",
    pending: 2,
    total: 3,
  });
  i18n.t("agentChat.harness.codeWorkbench.metric.fileChanges", {
    ns: "agent",
    pending: 2,
    total: 3,
  });
  i18n.t("agentChat.harness.codeWorkbench.metric.checkpoints", {
    ns: "agent",
  });
  i18n.t("agentChat.harness.codeReview.description", {
    ns: "agent",
    files: 1,
    outputs: 2,
    checkpoints: 3,
  });
  i18n.t("agentChat.harness.codeReview.metric.outputsPassing", {
    ns: "agent",
    count: 1,
  });
  i18n.t("agentChat.harness.codeReview.metric.checkpointsEmpty", {
    ns: "agent",
  });
  i18n.t("agentChat.harnessVerification.section.title", { ns: "agent" });
  i18n.t("agentChat.harnessVerification.artifact.description", {
    ns: "agent",
    fallbackCount: "0",
    issueCount: "2",
    recordCount: "1",
    repairedCount: "1",
  });
  i18n.t("agentChat.agentUiProjection.eventType.artifact.preview.ready", {
    ns: "agent",
  });
  i18n.t("agentChat.agentUiProjection.sourceType.artifact_snapshot", {
    ns: "agent",
  });
  i18n.t("agentChat.agentUiProjection.phase.completed", { ns: "agent" });
  i18n.t("agentChat.agentUiProjection.control.unknown", { ns: "agent" });
  i18n.t("agentChat.agentUiProjection.lane.team-topology.label", {
    ns: "agent",
  });
  i18n.t("agentChat.agentUiProjection.surface.work_board.description", {
    ns: "agent",
  });
  i18n.t("agentChat.incidentPanel.empty", { ns: "agent" });
  i18n.t("agentChat.incidentPanel.priorityBadge", {
    ns: "agent",
    severity: "High",
  });
  i18n.t("navigation.sidebar.items.newChat", { ns: "navigation" });
  i18n.t(
    "workspace.browserExistingSession.presentation.status.attached.label",
    {
      ns: "workspace",
    },
  );
  i18n.t("scheduledTasks.editor.validation.threadLineageRequired", {
    ns: "workspace",
  });
  i18n.t("workspace.video.promptInput.title", { ns: "workspace" });
  i18n.t("workspace.video.canvas.sidebar.collapse", { ns: "workspace" });
  i18n.t("workspace.video.workspace.summary.currentModel.label", {
    ns: "workspace",
  });
  i18n.t("workspace.video.workspace.recentTasks.title", {
    ns: "workspace",
  });
  i18n.t("workspace.video.workspace.taskStatus.success", {
    ns: "workspace",
  });
  i18n.t("workspace.video.workspace.taskSync.saved.label", {
    ns: "workspace",
  });
  i18n.t("workspace.video.workspace.session.title", {
    ns: "workspace",
  });
  i18n.t("workspace.video.workspace.session.preview.title", {
    ns: "workspace",
  });
  i18n.t("workspace.video.workspace.focusedTask.title", {
    ns: "workspace",
  });
  i18n.t("workspace.video.workspace.focusedTask.source.label", {
    ns: "workspace",
  });
  i18n.t("workspace.video.workspace.generate.submitted", {
    ns: "workspace",
  });
  i18n.t("workspace.video.workspace.reference.unsupportedFormat", {
    ns: "workspace",
  });
  i18n.t("workspace.video.sidebar.intro.title", { ns: "workspace" });
  i18n.t("workspace.video.sidebar.reference.start.title", { ns: "workspace" });
  i18n.t("workspace.video.sidebar.reference.empty.action", {
    ns: "workspace",
  });
  i18n.t("workspace.video.sidebar.controls.seed.placeholder", {
    ns: "workspace",
  });
  i18n.t("workspace.video.sidebar.controls.cameraFixed.tipContent", {
    ns: "workspace",
  });
  i18n.t("workspace.video.sidebar.model.panel.title", {
    ns: "workspace",
  });
  i18n.t("workspace.video.sidebar.model.meta.sora2Pro.description", {
    ns: "workspace",
  });
  i18n.t("workspace.document.editor.placeholder", { ns: "workspace" });
  i18n.t("workspace.document.editor.slashCommand.items.image.title", {
    ns: "workspace",
  });
  i18n.t("workspace.document.editor.slashCommand.prompt.imageUrl", {
    ns: "workspace",
  });
  i18n.t("workspace.artifactToolbar.type.code", { ns: "workspace" });
  i18n.t("workspace.artifactToolbar.writePhase.streaming", {
    ns: "workspace",
  });
  i18n.t("workspace.artifactToolbar.action.copyContent", { ns: "workspace" });
  i18n.t("workspace.artifactRenderer.empty.failed.title", {
    ns: "workspace",
  });
  i18n.t("workspace.artifactRenderer.fallback.unknownType", {
    ns: "workspace",
  });
  i18n.t("workspace.canvasAdapter.action.openFullEditor", {
    ns: "workspace",
  });
  i18n.t("workspace.canvasBreadcrumb.backHome", { ns: "workspace" });
  i18n.t("workspace.canvasAdapter.designPreview.visibleLayers", {
    ns: "workspace",
  });
  i18n.t("workspace.artifactDocument.kind.report", { ns: "workspace" });
  i18n.t("workspace.artifactDocument.stats.blocks.label", {
    ns: "workspace",
  });
  i18n.t("workspace.artifactDocumentBlock.citation.titleFallback", {
    ns: "workspace",
  });
  i18n.t("workspace.a2uiSubmissionNotice.action.expand", {
    ns: "workspace",
  });
  i18n.t("workspace.pendingA2UI.status.progressStep", {
    ns: "workspace",
  });
  i18n.t("workspace.artifactRenderer.previewFallback.systemOpen.title", {
    ns: "workspace",
  });
  i18n.t("workspace.artifactRenderer.previewFallback.unsupported.detail", {
    ns: "workspace",
  });
  i18n.t("workspace.artifactRenderer.previewSource.source.url", {
    ns: "workspace",
  });
  i18n.t("workspace.artifactRenderer.previewSource.source.databaseRecord", {
    ns: "workspace",
  });
  i18n.t("workspace.artifactRenderer.previewSource.source.app", {
    ns: "workspace",
  });
  i18n.t("workspace.artifactRenderer.previewSource.empty", {
    ns: "workspace",
  });
  i18n.t("settings.layout.action.back", { ns: "settings" });
  i18n.t("settings.layout.loading.profile", { ns: "settings" });
  i18n.t("settings.profile.title", { ns: "settings" });
  i18n.t("settings.profile.loading", { ns: "settings" });
  i18n.t("settings.profile.field.displayName.label", { ns: "settings" });
  i18n.t("settings.profile.field.bio.label", { ns: "settings" });
  i18n.t("settings.profile.field.limit", { ns: "settings", count: 64 });
  i18n.t("settings.profile.action.cancel", { ns: "settings" });
  i18n.t("settings.profile.action.edit", { ns: "settings" });
  i18n.t("settings.profile.action.retry", { ns: "settings" });
  i18n.t("settings.profile.action.save", { ns: "settings" });
  i18n.t("settings.profile.field.cancelAria", {
    ns: "settings",
    label: "Display name",
  });
  i18n.t("settings.profile.field.editAria", {
    ns: "settings",
    label: "Display name",
  });
  i18n.t("settings.profile.field.saveAria", {
    ns: "settings",
    label: "Display name",
  });
  i18n.t("settings.profile.message.loadFailed", { ns: "settings" });
  i18n.t("settings.profile.message.saveFailed", { ns: "settings" });
  i18n.t("settings.profile.message.saved", { ns: "settings" });
  i18n.t("settings.plugins.loading", { ns: "settings" });
  i18n.t("settings.about.version.label", {
    ns: "settings",
    version: "1.10.0",
    build: "1.10.0",
  });
  i18n.t("settings.about.update.errorDownload", { ns: "settings" });
  i18n.t("settings.group.coding", { ns: "settings" });
  i18n.t("settings.appearance.hero.title", { ns: "settings" });
  i18n.t("settings.appearance.colorScheme.options.lime-classic.label", {
    ns: "settings",
  });
  i18n.t("settings.desktop.language", { ns: "settings" });
  i18n.t("settings.localEnvironments.title", { ns: "settings" });
  i18n.t("settings.localEnvironments.showInherited", {
    ns: "settings",
    count: 2,
  });
  i18n.t("settings.desktop.title", { ns: "settings" });
  i18n.t("settings.desktop.general", { ns: "settings" });
  i18n.t("settings.group.personal", { ns: "settings" });
  i18n.t("settings.group.integrations", { ns: "settings" });
  i18n.t("settings.group.coding", { ns: "settings" });
  i18n.t("settings.desktop.personalization", { ns: "settings" });
  i18n.t("settings.personalization.instructions", { ns: "settings" });
  i18n.t("settings.memory.soul.styleProfile.title", { ns: "settings" });
  i18n.t("settings.personalization.instructionsDescription", {
    ns: "settings",
  });
  i18n.t("settings.personalization.memory", {
    ns: "settings",
  });
  i18n.t("settings.personalization.enabled", { ns: "settings" });
  i18n.t("settings.personalization.tools", {
    ns: "settings",
  });
  i18n.t("settings.channels.logTail.title", { ns: "settings" });
  i18n.t("settings.channels.logTail.error.invalidRegex", { ns: "settings" });
  i18n.t("settings.channels.workbench.title", { ns: "settings" });
  i18n.t("settings.channels.workbench.currentScope", {
    ns: "settings",
    scope: "Logs",
  });
  i18n.t("settings.channels.gatewayTunnel.confirm.installCloudflared", {
    ns: "settings",
  });
  i18n.t("settings.channels.gatewayTunnel.state.running", {
    ns: "settings",
    action: "Start",
  });
  i18n.t("settings.channels.gatewayRuntime.message.actionFailed", {
    ns: "settings",
    error: "network down",
  });
  i18n.t("settings.channels.wechatRuntime.confirm.removeAccount", {
    ns: "settings",
    accountId: "wx-main",
    purgeAction: "",
    purgeScope: "",
    purgeRisk: "",
  });
  i18n.t("settings.channels.wechatRuntime.accounts.runningCount", {
    ns: "settings",
    count: 1,
  });
  i18n.t("settings.system.clipboardPermission.macos.title", {
    ns: "settings",
  });
  i18n.t(
    "settings.system.clipboardPermission.message.openSettingsFailedWithMessage",
    {
      ns: "settings",
    },
  );
  i18n.t("settings.mediaServices.title", { ns: "settings" });
  i18n.t("settings.mediaServices.sections.responsiveChat.title", {
    ns: "settings",
  });
  i18n.t("settings.mediaServices.card.tipAria", {
    ns: "settings",
    title: "Fast Response Chat Assistant",
  });
  i18n.t("settings.providers.importExport.title", { ns: "settings" });
  i18n.t("settings.providers.importExport.export.action.generate", {
    ns: "settings",
  });
  i18n.t("settings.providers.importExport.import.result.importedProviders", {
    ns: "settings",
    count: 2,
  });
  i18n.t("settings.providers.importExport.import.result.errors", {
    ns: "settings",
    errors: "OpenAI exists",
  });
  i18n.t("settings.mediaGeneration.image.title", { ns: "settings" });
  i18n.t("settings.mediaGeneration.video.hint.ready", { ns: "settings" });
  i18n.t("settings.userCenterSession.value.expiresAt.unknown", {
    ns: "settings",
  });
  i18n.t("settings.userCenterSession.title", { ns: "settings" });
  i18n.t("settings.userCenterSession.login.google.title", { ns: "settings" });
  i18n.t("settings.plugins.subtitle", { ns: "settings" });
  i18n.t("settings.plugins.browseDirectory", { ns: "settings" });
  i18n.t("settings.voice.model.action.download", { ns: "settings" });
  i18n.t("settings.voice.page.dictation", { ns: "settings" });
  i18n.t("settings.voice.media.title", { ns: "settings" });
  i18n.t("settings.voice.model.message.downloaded", {
    ns: "settings",
    model: "SenseVoice Small",
  });
  i18n.t("errors.artifactFallback.title.renderFailed", { ns: "errors" });
  i18n.t("errors.artifactFallback.action.copyErrorReport", { ns: "errors" });
  i18n.t("errors.svgRenderer.error.renderFailed", { ns: "errors" });
  i18n.t("errors.codeRenderer.action.copyCode", { ns: "errors" });
  i18n.t("errors.codeRenderer.error.emptyContent", { ns: "errors" });
  i18n.t("errors.htmlRenderer.error.renderFailed", { ns: "errors" });
  i18n.t("errors.htmlRenderer.action.refreshPreview", { ns: "errors" });
  i18n.t("errors.mermaidRenderer.error.syntax", { ns: "errors" });
  i18n.t("errors.mermaidRenderer.action.exportDiagram", { ns: "errors" });
  i18n.t("errors.crashRecovery.title", { ns: "errors" });
  i18n.t("errors.crashRecovery.action.forceReload", { ns: "errors" });
  i18n.t("errors.crashRecovery.action.retryOnly", { ns: "errors" });
  i18n.t("errors.crashRecovery.message.diagnosticExportedShort", {
    ns: "errors",
  });
  i18n.t("errors.crashRecovery.moduleImportFailure.prefix", { ns: "errors" });

  // @ts-expect-error common namespace key 必须来自已迁移的 zh-CN source resource。
  const missingCommonKey: CommonResourceKey = "common.__missing__";
  void missingCommonKey;
}

describe("i18n type binding", () => {
  it("应把类型断言保留在 tsc 覆盖范围内", () => {
    expect(typeof assertI18nKeyTypes).toBe("function");
  });
});
