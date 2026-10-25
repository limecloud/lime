import fs from "node:fs";
import { CONTENT_FACTORY_ARTICLE_WORKSPACE_ASSERTION_KEYS } from "./claw-chat-current-fixture-constants.mjs";

function expectAllToContain(expect, content, fragments) {
  for (const fragment of fragments) expect(content).toContain(fragment);
}

function expectAllNotToContain(expect, content, fragments) {
  for (const fragment of fragments) expect(content).not.toContain(fragment);
}

function readImageCommandScript() {
  return fs.readFileSync(
    "scripts/agent-runtime/claw-chat-current-fixture-image-command.mjs",
    "utf8",
  );
}

function readImageCommandWorkflowReadScript() {
  return fs.readFileSync(
    "scripts/agent-runtime/claw-chat-current-fixture-image-command-workflow-read.mjs",
    "utf8",
  );
}

function readRpcScript() {
  return fs.readFileSync(
    "scripts/agent-runtime/claw-chat-current-fixture-rpc.mjs",
    "utf8",
  );
}

function readContentFactoryArticleWorkspaceScript() {
  return fs.readFileSync(
    "scripts/agent-runtime/claw-chat-current-fixture-content-factory-article-workspace.mjs",
    "utf8",
  );
}

function readContentFactoryArticleWorkspacePatchesScript() {
  return fs.readFileSync(
    "scripts/agent-runtime/claw-chat-current-fixture-content-factory-workspace-patches.mjs",
    "utf8",
  );
}

export function registerImageContentSmokeGuards({
  expect,
  it,
  readSmokeScript,
  removeContentFactoryForbiddenMarkerGuard,
}) {
  it("uses the runtime model image tool without frontend workflow routing", () => {
    const content = readSmokeScript();
    const imageCommandContent = readImageCommandScript();
    expectAllToContain(expect, content, [
      "image-command",
      "plain-image-intent",
      "lime_create_image_generation_task",
      'APP_SERVER_BACKEND_MODE: "runtime"',
      "imageCommandNoSyntheticRoutingMetadata",
      "imageCommandModelCalledTool",
      "imageCommandTaskArtifactTerminal",
      "imageCommandTaskAuditLogNoSensitiveTokens",
      "guiImageCommandRestoredAfterReload",
    ]);
    expectAllToContain(expect, imageCommandContent, [
      "sendPromptFromGui",
      'entrySource: "agent_tool"',
      "waitForImageTaskArtifact",
      "waitForImageCommandTaskArtifactTerminal",
      "EXPECTED_IMAGE_TASK_AUDIT_EVENTS",
    ]);
    expectAllNotToContain(expect, imageCommandContent, [
      "workflow:image_command",
      "image_command_intent",
      "readImageCommandWorkflowAudit",
    ]);
  });

  it("covers content factory Article Workspace through typed artifact write and read", () => {
    const content = readSmokeScript();
    const contentFactoryScenario = readContentFactoryArticleWorkspaceScript();
    const contentFactoryWorkspacePatches =
      readContentFactoryArticleWorkspacePatchesScript();

    expectAllToContain(expect, content, [
      "content-factory-article-workspace",
      "content-factory-inline-image-article-workspace",
      "runContentFactoryArticleWorkspaceScenario",
      "runContentFactoryInlineImageArticleWorkspaceScenario",
      "artifact/write",
      "artifact/read",
      "workspace_patch",
      "workspacePatch",
      "内容工厂 Article Editor Fixture",
      "公众号文章草稿",
      "配图组",
      "视频分镜",
      "交付检查清单",
      "artifact-article-1",
      "artifact-image-1",
      "artifact-video-storyboard",
      "artifact-delivery-checklist",
      "artifact-image-regenerate-workspace-patch",
      "artifact-image-regenerated",
      "image_regenerate_job_1",
      "contentFactoryArticleWorkspaceWorkspacePatchEvidenceProjected",
      "contentFactoryArticleWorkspaceWorkspacePatchEvidenceScoped",
      "content.article.generate",
      "options.scenario === CONTENT_FACTORY_ARTICLE_WORKSPACE_SCENARIO",
      "options.scenario !== CONTENT_FACTORY_INLINE_IMAGE_ARTICLE_WORKSPACE_SCENARIO",
      "CONTENT_FACTORY_INLINE_IMAGE_SLOT_ID",
      "contentFactoryInlineImageTaskEventEmitted",
      "contentFactoryInlineImageArticleRestored",
      "mediaTaskArtifact/image/create",
      "mediaTaskArtifact/get",
      "contentFactoryArticleWorkspaceStoryboardObjectSelection",
      "contentFactoryArticleWorkspaceArticleObjectSelection",
      "contentFactoryArticleWorkspaceArticleCanvasSurface",
      "contentFactoryArticleWorkspaceArticleCanvasSurfaceVisible",
      "contentFactoryArticleWorkspaceEditedDraftUpdate",
      "contentFactoryArticleWorkspaceEditedDraftSessionReopened",
      "contentFactoryArticleWorkspaceEditedDraftReload",
      "contentFactoryArticleWorkspaceEditedDraftArtifactFrame",
      "contentFactoryArticleWorkspaceEditedDraftRestored",
      "E2E_EDITED_ARTICLE_DRAFT_RESTORED",
      "workspace-article-editor-related-articleDraft",
      "workspace-article-editor-related-videoStoryboard",
      "workspace-article-editor-title-candidates",
      "workspace-article-editor-research",
      "workspace-article-editor-outline",
      "workspace-article-editor-citations",
      "workspace-article-editor-image-slots",
      "workspace-article-editor-canvas",
      "documentCanvasText.includes",
      "snapshot.hasArticleCanvasContent",
      "readModel.hasImageSetObject",
      "readModel.hasStoryboardObject",
      "readModel.hasChecklistObject",
      "contentFactoryArticleWorkspaceStoryboardContentPreserved",
      "已重新生成 2 张候选图",
      "workspace-article-editor-surface",
      "workspace-right-surface-host",
      "artifact_document.v1",
      "contentFactoryArticleWorkspaceDoesNotUseModelTurn",
      "contentFactoryArticleWorkspaceActionResultPatchProjected",
    ]);
    expectAllToContain(expect, contentFactoryScenario, [
      "APP_SERVER_METHOD_ARTIFACT_WRITE",
      "writeWorkspacePatchArtifact",
      "writeContentFactoryArticleWorkspaceActionResultArtifact",
      "summarizeArtifactWrite",
      "articleCanvasHasForbiddenTemplate",
      "reloadContentFactoryArticleWorkspaceSession",
      "reloadRendererDocument",
      "updateContentFactoryArticleWorkspaceEditedDraft",
      "waitForContentFactoryArticleWorkspaceEditedDraftRestored",
      "readContentFactoryArticleDraftObjectRef",
      "article-artifact-frame",
      "clickContentFactoryArticleArtifactFrame",
      "waitForContentFactoryArticleEditorOpened",
      "FORBIDDEN_CONTENT_FACTORY_ARTICLE_TEMPLATE_MARKERS",
      "metadataPanelsHidden",
      "snapshot.metadataPanelsHidden",
      "snapshot.hasFullArticleCanvas",
      "source: readString(workerDogfoodEvidence.source)",
    ]);
    expectAllToContain(expect, contentFactoryWorkspacePatches, [
      "const articleDraftMarkdown = [",
      "markdown: articleDraftMarkdown",
      "documentText: articleDraftMarkdown",
      "finalMarkdown: articleDraftMarkdown",
    ]);

    const contentWithoutForbiddenMarkerGuard =
      removeContentFactoryForbiddenMarkerGuard(content);
    expectAllNotToContain(expect, contentWithoutForbiddenMarkerGuard, [
      "受控宿主生成标题",
      "内容工厂插件化写作：让文章生产可审计",
    ]);
    expectAllNotToContain(expect, contentFactoryScenario, [
      "agentSession/runtimeEvents/append",
      "APP_SERVER_METHOD_AGENT_SESSION_RUNTIME_EVENTS_APPEND",
      'type: "workflow.run.started"',
      'type: "runtime.error"',
      'toggleTestId: "task-center-object-canvas-toggle"',
      "researchText.includes",
      "takeawaysText.length",
      "writingPlanText.length",
      "pluginInstalled/save",
      "content_factory.workspace_patch",
      "contentFactoryWorkspacePatch",
      "pluginWorker",
      "startContentFactoryHostGenerationFixture",
      "hostManagedGeneration",
    ]);
    for (const assertionKey of CONTENT_FACTORY_ARTICLE_WORKSPACE_ASSERTION_KEYS) {
      expect(content).toContain(assertionKey);
    }
    expectAllNotToContain(expect, content, [
      'readModel.workerArticleObject?.hostManagedGenerationStatus ===\n        "unavailable"',
      "APP_SERVER_METHOD_CONTENT_FACTORY",
      "content_factory/start",
      "content_factory/generate",
      "BrowserView",
    ]);
  });
}
