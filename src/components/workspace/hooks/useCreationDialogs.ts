import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { toast } from "sonner";
import {
  createContent,
  createProject,
  extractErrorMessage,
  getContent,
  getContentTypeLabel,
  getCreateProjectErrorMessage,
  getDefaultContentTypeForProject,
  getProjectByRootPath,
  getProjectTypeLabel,
  getWorkspaceProjectsRoot,
  listContents,
  resolveProjectRootPath,
  type ProjectType,
} from "@/lib/api/project";
import type { WorkspaceTheme } from "@/types/page";
import type { CreationMode } from "@/lib/workspace/workbenchContract";
import {
  buildCreationIntentMetadata,
  buildCreationIntentPrompt,
  createInitialCreationIntentValues,
  getCreationIntentFieldsSafe,
  isCreationMode,
  normalizeCreationMode,
  type CreationIntentFieldKey,
  type CreationIntentFormValues,
  type CreationIntentInput,
  validateCreationIntent,
} from "@/components/workspace/utils/creationIntentPrompt";
import type { A2UIFormData } from "@/lib/workspace/a2ui";
import {
  type CreateConfirmationSource,
  type PendingCreateConfirmation,
} from "@/components/workspace/utils/createConfirmationPolicy";
import {
  consumePendingCreateConfirmationMap,
  resolveContinuationTargetContent,
  resolveCreateConfirmationDecision,
  upsertPendingCreateConfirmationMap,
} from "@/components/workspace/services/createConfirmationService";
import { notifyProjectCreatedWithRuntimeAgentsGuide } from "@/components/workspace/services/runtimeAgentsGuideService";
import { reportFrontendError } from "@/lib/crashReporting";

type CreateContentDialogStep = "mode" | "intent";

interface CreateContentDialogState {
  step: CreateContentDialogStep;
  selectedCreationMode: CreationMode;
  creationIntentValues: CreationIntentFormValues;
  creationIntentError: string;
}

type CreateContentDialogAction =
  | {
      type: "reset";
      defaultMode: CreationMode;
    }
  | {
      type: "setStep";
      step: CreateContentDialogStep;
    }
  | {
      type: "setMode";
      mode: unknown;
    }
  | {
      type: "setError";
      error: string;
    }
  | {
      type: "updateIntentValue";
      key: CreationIntentFieldKey;
      value: string;
    }
  | {
      type: "goIntentStep";
    };

function createInitialContentDialogState(
  defaultMode: CreationMode,
): CreateContentDialogState {
  return {
    step: "mode",
    selectedCreationMode: normalizeCreationMode(defaultMode),
    creationIntentValues: createInitialCreationIntentValues(),
    creationIntentError: "",
  };
}

function createContentDialogReducer(
  state: CreateContentDialogState,
  action: CreateContentDialogAction,
): CreateContentDialogState {
  switch (action.type) {
    case "reset":
      return createInitialContentDialogState(action.defaultMode);
    case "setStep":
      return {
        ...state,
        step: action.step,
      };
    case "setMode":
      return {
        ...state,
        selectedCreationMode: normalizeCreationMode(action.mode),
      };
    case "setError":
      return {
        ...state,
        creationIntentError: action.error,
      };
    case "updateIntentValue":
      return {
        ...state,
        creationIntentValues: {
          ...state.creationIntentValues,
          [action.key]: action.value,
        },
        creationIntentError: "",
      };
    case "goIntentStep":
      return {
        ...state,
        step: "intent",
        creationIntentError: "",
      };
    default:
      return state;
  }
}

function parseCreationModeFromMetadata(metadata: unknown): CreationMode | null {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }
  const mode = (metadata as Record<string, unknown>).creationMode;
  return isCreationMode(mode) ? mode : null;
}

function parseContentTypeFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }

  const record = metadata as Record<string, unknown>;
  const creationIntent = record.creationIntent;
  if (creationIntent && typeof creationIntent === "object") {
    const contentType = (creationIntent as Record<string, unknown>).contentType;
    if (typeof contentType === "string" && contentType.trim()) {
      return contentType.trim();
    }

    const localizedContentType = (creationIntent as Record<string, unknown>)[
      "输出体裁"
    ];
    if (
      typeof localizedContentType === "string" &&
      localizedContentType.trim()
    ) {
      return localizedContentType.trim();
    }
  }

  const topLevelContentType = record.contentType;
  if (typeof topLevelContentType === "string" && topLevelContentType.trim()) {
    return topLevelContentType.trim();
  }

  return null;
}

function useWorkspaceProjectsRootLoader(
  setWorkspaceProjectsRoot: Dispatch<SetStateAction<string>>,
): void {
  useEffect(() => {
    let mounted = true;

    const loadWorkspaceRoot = async () => {
      try {
        const root = await getWorkspaceProjectsRoot();
        if (mounted) {
          setWorkspaceProjectsRoot(root);
        }
      } catch (error) {
        console.error("加载 workspace 目录失败:", error);
      }
    };

    void loadWorkspaceRoot();

    return () => {
      mounted = false;
    };
  }, [setWorkspaceProjectsRoot]);
}

interface UseProjectPathResolverParams {
  createProjectDialogOpen: boolean;
  newProjectName: string;
  resetProjectPathState: () => void;
  setResolvedProjectPath: Dispatch<SetStateAction<string>>;
}

function useProjectPathResolver({
  createProjectDialogOpen,
  newProjectName,
  resetProjectPathState,
  setResolvedProjectPath,
}: UseProjectPathResolverParams): void {
  useEffect(() => {
    if (!createProjectDialogOpen) {
      resetProjectPathState();
      return;
    }

    const projectName = newProjectName.trim();
    if (!projectName) {
      resetProjectPathState();
      return;
    }

    let mounted = true;
    const resolvePath = async () => {
      try {
        const path = await resolveProjectRootPath(projectName);
        if (mounted) {
          setResolvedProjectPath(path);
        }
      } catch (error) {
        console.error("解析项目目录失败:", error);
        if (mounted) {
          resetProjectPathState();
        }
      }
    };

    void resolvePath();

    return () => {
      mounted = false;
    };
  }, [
    createProjectDialogOpen,
    newProjectName,
    resetProjectPathState,
    setResolvedProjectPath,
  ]);
}

interface UseProjectPathConflictCheckerParams {
  createProjectDialogOpen: boolean;
  resolvedProjectPath: string;
  setPathChecking: Dispatch<SetStateAction<boolean>>;
  setPathConflictMessage: Dispatch<SetStateAction<string>>;
}

function useProjectPathConflictChecker({
  createProjectDialogOpen,
  resolvedProjectPath,
  setPathChecking,
  setPathConflictMessage,
}: UseProjectPathConflictCheckerParams): void {
  useEffect(() => {
    if (!createProjectDialogOpen || !resolvedProjectPath) {
      setPathChecking(false);
      setPathConflictMessage("");
      return;
    }

    let mounted = true;
    setPathChecking(true);

    const checkPathConflict = async () => {
      try {
        const existingProject = await getProjectByRootPath(resolvedProjectPath);
        if (!mounted) {
          return;
        }
        if (existingProject) {
          setPathConflictMessage(`路径已存在项目：${existingProject.name}`);
        } else {
          setPathConflictMessage("");
        }
      } catch (error) {
        console.error("检查项目路径冲突失败:", error);
        if (mounted) {
          setPathConflictMessage("");
        }
      } finally {
        if (mounted) {
          setPathChecking(false);
        }
      }
    };

    void checkPathConflict();

    return () => {
      mounted = false;
    };
  }, [
    createProjectDialogOpen,
    resolvedProjectPath,
    setPathChecking,
    setPathConflictMessage,
  ]);
}

interface UseCreationMetadataLoaderParams {
  selectedContentId: string | null;
  creationModes: Record<string, CreationMode>;
  setCreationModes: Dispatch<SetStateAction<Record<string, CreationMode>>>;
  creationTypes: Record<string, string>;
  setCreationTypes: Dispatch<SetStateAction<Record<string, string>>>;
}

function useCreationMetadataLoader({
  selectedContentId,
  creationModes,
  setCreationModes,
  creationTypes,
  setCreationTypes,
}: UseCreationMetadataLoaderParams): void {
  const attemptedContentIdsRef = useRef<Record<string, boolean>>({});

  useEffect(() => {
    if (!selectedContentId) {
      return;
    }

    if (
      creationModes[selectedContentId] &&
      creationTypes[selectedContentId]
    ) {
      attemptedContentIdsRef.current[selectedContentId] = true;
      return;
    }

    if (attemptedContentIdsRef.current[selectedContentId]) {
      return;
    }

    attemptedContentIdsRef.current[selectedContentId] = true;

    let mounted = true;
    const loadCreationMetadata = async () => {
      try {
        const content = await getContent(selectedContentId);
        const mode = parseCreationModeFromMetadata(content?.metadata);
        const contentType = parseContentTypeFromMetadata(content?.metadata);

        if (mounted && mode) {
          setCreationModes((previous) =>
            previous[selectedContentId] === mode
              ? previous
              : {
                  ...previous,
                  [selectedContentId]: mode,
                },
          );
        }

        if (mounted && contentType) {
          setCreationTypes((previous) =>
            previous[selectedContentId] === contentType
              ? previous
              : {
                  ...previous,
                  [selectedContentId]: contentType,
                },
          );
        }
      } catch (error) {
        console.error("读取文稿创作元数据失败:", error);
      }
    };

    void loadCreationMetadata();

    return () => {
      mounted = false;
    };
  }, [
    creationModes,
    creationTypes,
    selectedContentId,
    setCreationModes,
    setCreationTypes,
  ]);
}

export interface UseCreationDialogsParams {
  theme: WorkspaceTheme;
  selectedProjectId: string | null;
  selectedContentId: string | null;
  loadProjects: () => Promise<void>;
  loadContents: (projectId: string) => Promise<void>;
  onEnterWorkspace: (
    contentId: string,
    options?: {
      showChatPanel?: boolean;
      createEntryHome?: boolean;
    },
  ) => void;
  onProjectCreated: (projectId: string) => void;
  defaultCreationMode: CreationMode;
  minCreationIntentLength: number;
  initialCreateConfirmation?: {
    prompt?: string;
    source?: CreateConfirmationSource;
    creationMode?: CreationMode;
    fallbackContentTitle?: string;
  };
}

export interface QuickCreateProjectAndContentOptions {
  projectName: string;
  workspaceType?: ProjectType;
  contentTitle?: string;
  initialUserPrompt?: string;
  creationMode?: CreationMode;
}

export interface OpenProjectForWritingOptions {
  fallbackContentTitle?: string;
  initialUserPrompt?: string;
  creationMode?: CreationMode;
}

export function useCreationDialogs({
  theme,
  selectedProjectId,
  selectedContentId,
  loadProjects,
  loadContents,
  onEnterWorkspace,
  onProjectCreated,
  defaultCreationMode,
  minCreationIntentLength,
  initialCreateConfirmation,
}: UseCreationDialogsParams) {
  const [createProjectDialogOpen, setCreateProjectDialogOpen] = useState(false);
  const [createContentDialogOpen, setCreateContentDialogOpen] = useState(false);
  const [createContentDialogState, dispatchCreateContentDialog] = useReducer(
    createContentDialogReducer,
    defaultCreationMode,
    createInitialContentDialogState,
  );
  const [newProjectName, setNewProjectName] = useState("");
  const [workspaceProjectsRoot, setWorkspaceProjectsRoot] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [creatingContent, setCreatingContent] = useState(false);
  const [resolvedProjectPath, setResolvedProjectPath] = useState("");
  const [pathChecking, setPathChecking] = useState(false);
  const [pathConflictMessage, setPathConflictMessage] = useState("");
  const [
    pendingInitialPromptsByContentId,
    setPendingInitialPromptsByContentId,
  ] = useState<Record<string, string>>({});
  const [
    pendingCreateConfirmationByProjectId,
    setPendingCreateConfirmationByProjectId,
  ] = useState<Record<string, PendingCreateConfirmation>>({});
  const [creationModes, setCreationModes] = useState<Record<string, CreationMode>>(
    {},
  );
  const [creationTypes, setCreationTypes] = useState<Record<string, string>>(
    {},
  );
  const createConfirmationSubmittingProjectsRef = useRef<
    Record<string, boolean>
  >({});
  const initialCreateConfirmationAppliedRef = useRef(false);

  const resetProjectPathState = useCallback(() => {
    setResolvedProjectPath("");
    setPathChecking(false);
    setPathConflictMessage("");
  }, []);

  const creationIntentInput = useMemo<CreationIntentInput>(
    () => ({
      creationMode: createContentDialogState.selectedCreationMode,
      values: createContentDialogState.creationIntentValues,
    }),
    [
      createContentDialogState.creationIntentValues,
      createContentDialogState.selectedCreationMode,
    ],
  );

  const currentCreationIntentFields = useMemo(
    () =>
      getCreationIntentFieldsSafe(
        createContentDialogState.selectedCreationMode,
      ),
    [createContentDialogState.selectedCreationMode],
  );

  const currentIntentLength = useMemo(
    () =>
      validateCreationIntent(creationIntentInput, minCreationIntentLength)
        .length,
    [creationIntentInput, minCreationIntentLength],
  );

  const resetCreateContentDialogState = useCallback(() => {
    dispatchCreateContentDialog({
      type: "reset",
      defaultMode: defaultCreationMode,
    });
  }, [defaultCreationMode]);

  const setCreateContentDialogStep = useCallback(
    (step: CreateContentDialogStep) => {
      dispatchCreateContentDialog({
        type: "setStep",
        step,
      });
    },
    [],
  );

  const setSelectedCreationMode = useCallback((mode: CreationMode) => {
    dispatchCreateContentDialog({
      type: "setMode",
      mode,
    });
  }, []);

  const setCreationIntentError = useCallback((error: string) => {
    dispatchCreateContentDialog({
      type: "setError",
      error,
    });
  }, []);

  const upsertPendingCreateConfirmation = useCallback(
    (
      projectId: string,
      source: CreateConfirmationSource,
      options?: {
        initialUserPrompt?: string;
        creationMode?: CreationMode;
        preferredContentId?: string;
        fallbackContentTitle?: string;
      },
    ) => {
      if (!projectId) {
        return;
      }
      setPendingCreateConfirmationByProjectId((previous) => ({
        ...upsertPendingCreateConfirmationMap(previous, projectId, {
          source,
          defaultCreationMode,
          creationMode: normalizeCreationMode(options?.creationMode),
          initialUserPrompt: options?.initialUserPrompt,
          preferredContentId: options?.preferredContentId,
          fallbackContentTitle: options?.fallbackContentTitle,
        }),
      }));
    },
    [defaultCreationMode],
  );

  const consumePendingCreateConfirmation = useCallback((projectId: string) => {
    setPendingCreateConfirmationByProjectId((previous) => {
      return consumePendingCreateConfirmationMap(previous, projectId);
    });
  }, []);

  const handleOpenCreateProjectDialog = useCallback(() => {
    setNewProjectName(`${getProjectTypeLabel(theme as ProjectType)}项目`);
    resetProjectPathState();
    setCreateProjectDialogOpen(true);
  }, [resetProjectPathState, theme]);

  const handleCreateProject = useCallback(async () => {
    const name = newProjectName.trim();

    if (!name) {
      toast.error("请输入项目名称");
      return;
    }

    setCreatingProject(true);
    try {
      const rootPath = await resolveProjectRootPath(name);
      const createdProject = await createProject({
        name,
        rootPath,
        workspaceType: theme as ProjectType,
      });
      setCreateProjectDialogOpen(false);
      onProjectCreated(createdProject.id);
      notifyProjectCreatedWithRuntimeAgentsGuide(createdProject, "已创建新项目");
      await loadProjects();
      await loadContents(createdProject.id);
      upsertPendingCreateConfirmation(createdProject.id, "project_created", {
        creationMode: defaultCreationMode,
      });
      onEnterWorkspace("", { createEntryHome: true });
    } catch (error) {
      console.error("创建项目失败:", error);
      void reportFrontendError(error, {
        component: "useCreationDialogs",
        workflow_step: "workspace_creation_create_project",
      });
      const errorMessage = extractErrorMessage(error);
      const friendlyMessage = getCreateProjectErrorMessage(errorMessage);
      toast.error(`创建项目失败: ${friendlyMessage}`);
    } finally {
      setCreatingProject(false);
    }
  }, [
    defaultCreationMode,
    loadContents,
    loadProjects,
    newProjectName,
    onEnterWorkspace,
    onProjectCreated,
    theme,
    upsertPendingCreateConfirmation,
  ]);

  const handleQuickCreateProjectAndContent = useCallback(
    async (options: QuickCreateProjectAndContentOptions) => {
      const projectName = options.projectName.trim();
      if (!projectName) {
        throw new Error("项目名称不能为空");
      }

      const projectType = options.workspaceType ?? (theme as ProjectType);
      const creationMode = normalizeCreationMode(
        options.creationMode ?? defaultCreationMode,
      );
      const initialPrompt = options.initialUserPrompt?.trim() || "";

      try {
        const rootPath = await resolveProjectRootPath(projectName);
        const createdProject = await createProject({
          name: projectName,
          rootPath,
          workspaceType: projectType,
        });

        onProjectCreated(createdProject.id);
        notifyProjectCreatedWithRuntimeAgentsGuide(createdProject, "项目创建成功");
        await loadProjects();

        await loadContents(createdProject.id);
        upsertPendingCreateConfirmation(createdProject.id, "quick_create", {
          creationMode,
          initialUserPrompt: initialPrompt,
          fallbackContentTitle: options.contentTitle,
        });
        onEnterWorkspace("", { createEntryHome: true });

        return {
          projectId: createdProject.id,
          contentId: "",
        };
      } catch (error) {
        console.error("快速创建项目与文稿失败:", error);
        void reportFrontendError(error, {
          component: "useCreationDialogs",
          workflow_step: "workspace_creation_quick_create_project_content",
        });
        toast.error(`创建失败: ${extractErrorMessage(error)}`);
        throw error;
      }
    },
    [
      defaultCreationMode,
      loadContents,
      loadProjects,
      onEnterWorkspace,
      onProjectCreated,
      theme,
      upsertPendingCreateConfirmation,
    ],
  );

  const handleOpenProjectForWriting = useCallback(
    async (projectId: string, options?: OpenProjectForWritingOptions) => {
      const creationMode = normalizeCreationMode(
        options?.creationMode ?? defaultCreationMode,
      );
      const initialPrompt = options?.initialUserPrompt?.trim() || "";

      try {
        const existingContents = await listContents(projectId);
        const latestContent = [...existingContents].sort(
          (a, b) => b.updated_at - a.updated_at,
        )[0];

        let targetContentId = latestContent?.id || "";

        if (!targetContentId) {
          onProjectCreated(projectId);
          await loadContents(projectId);
          upsertPendingCreateConfirmation(
            projectId,
            "open_project_for_writing",
            {
              initialUserPrompt: initialPrompt,
              creationMode,
              fallbackContentTitle: options?.fallbackContentTitle,
            },
          );
          onEnterWorkspace("", { createEntryHome: true });
          return "";
        }
        consumePendingCreateConfirmation(projectId);

        if (initialPrompt) {
          setPendingInitialPromptsByContentId((previous) => ({
            ...previous,
            [targetContentId]: initialPrompt,
          }));
          setCreationModes((previous) => ({
            ...previous,
            [targetContentId]: creationMode,
          }));
        }

        onProjectCreated(projectId);
        await loadContents(projectId);
        onEnterWorkspace(targetContentId, {});
        return targetContentId;
      } catch (error) {
        console.error("打开项目写作失败:", error);
        void reportFrontendError(error, {
          component: "useCreationDialogs",
          workflow_step: "workspace_open_project_for_writing",
        });
        toast.error(`打开写作失败: ${extractErrorMessage(error)}`);
        throw error;
      }
    },
    [
      consumePendingCreateConfirmation,
      defaultCreationMode,
      loadContents,
      onEnterWorkspace,
      onProjectCreated,
      upsertPendingCreateConfirmation,
    ],
  );

  const handleOpenCreateContentDialog = useCallback(() => {
    if (!selectedProjectId) {
      return;
    }
    resetCreateContentDialogState();
    upsertPendingCreateConfirmation(
      selectedProjectId,
      "workspace_create_entry",
      {
        creationMode: defaultCreationMode,
        preferredContentId: selectedContentId || undefined,
      },
    );
    onEnterWorkspace("", { createEntryHome: true });
  }, [
    defaultCreationMode,
    onEnterWorkspace,
    resetCreateContentDialogState,
    selectedContentId,
    selectedProjectId,
    upsertPendingCreateConfirmation,
  ]);

  const handleCreateContentFromWorkspaceEntry = useCallback(() => {
    if (!selectedProjectId) {
      return;
    }
    resetCreateContentDialogState();
    upsertPendingCreateConfirmation(
      selectedProjectId,
      "workspace_create_entry",
      {
        creationMode: defaultCreationMode,
        preferredContentId: selectedContentId || undefined,
      },
    );
    onEnterWorkspace("", { createEntryHome: true });
  }, [
    defaultCreationMode,
    onEnterWorkspace,
    resetCreateContentDialogState,
    selectedContentId,
    selectedProjectId,
    upsertPendingCreateConfirmation,
  ]);

  const handleCreateContentFromWorkspacePrompt = useCallback(
    async (initialUserPrompt: string) => {
      if (!selectedProjectId || creatingContent) {
        return;
      }

      const normalizedPrompt = initialUserPrompt.trim();
      if (!normalizedPrompt) {
        return;
      }

      upsertPendingCreateConfirmation(selectedProjectId, "workspace_prompt", {
        initialUserPrompt: normalizedPrompt,
        creationMode: defaultCreationMode,
        preferredContentId: selectedContentId || undefined,
      });
      resetCreateContentDialogState();
      onEnterWorkspace("", { createEntryHome: true });
      toast.success("已记录创建请求，请确认后生成");
    },
    [
      creatingContent,
      defaultCreationMode,
      onEnterWorkspace,
      resetCreateContentDialogState,
      selectedContentId,
      selectedProjectId,
      upsertPendingCreateConfirmation,
    ],
  );

  const submitCreateConfirmation = useCallback(
    async (projectId: string, formData: A2UIFormData) => {
      if (!projectId) {
        return;
      }
      if (creatingContent) {
        return;
      }
      if (createConfirmationSubmittingProjectsRef.current[projectId]) {
        return;
      }
      const pending = pendingCreateConfirmationByProjectId[projectId];
      if (!pending) {
        toast.error("当前没有待确认的创建请求");
        return;
      }

      const defaultType = getDefaultContentTypeForProject(theme as ProjectType);
      const defaultTitle = `新${getContentTypeLabel(defaultType)}`;
      const decisionResult = resolveCreateConfirmationDecision({
        pending,
        formData,
        defaultContentTitle: defaultTitle,
      });
      if (!decisionResult.ok) {
        toast.error(decisionResult.message);
        return;
      }
      const decision = decisionResult.decision;

      createConfirmationSubmittingProjectsRef.current[projectId] = true;

      if (decision.type === "continue_history") {
        try {
          const existingContents = await listContents(projectId);
          const latestContent = resolveContinuationTargetContent(
            existingContents,
            decision.preferredContentId,
          );

          if (!latestContent?.id) {
            toast.error("当前项目暂无历史文稿，请选择新开帖子或新建版本");
            return;
          }

          if (decision.initialUserPrompt) {
            setPendingInitialPromptsByContentId((previous) => ({
              ...previous,
              [latestContent.id]: decision.initialUserPrompt,
            }));
          }

          setCreationModes((previous) => ({
            ...previous,
            [latestContent.id]: decision.creationMode,
          }));

          await loadContents(projectId);
          onEnterWorkspace(latestContent.id, {});
          consumePendingCreateConfirmation(projectId);
          toast.success("已进入历史文稿");
        } catch (error) {
          console.error("回到历史文稿失败:", error);
          void reportFrontendError(error, {
            component: "useCreationDialogs",
            workflow_step: "workspace_creation_confirm_continue_history",
          });
          toast.error("回到历史文稿失败");
        } finally {
          delete createConfirmationSubmittingProjectsRef.current[projectId];
        }
        return;
      }

      setCreatingContent(true);
      try {
        const created = await createContent({
          project_id: projectId,
          title: decision.title,
          content_type: defaultType,
          metadata: decision.metadata,
        });

        setCreationModes((previous) => ({
          ...previous,
          [created.id]: decision.creationMode,
        }));
        const decisionContentType = parseContentTypeFromMetadata(
          decision.metadata,
        );
        if (decisionContentType) {
          setCreationTypes((previous) => ({
            ...previous,
            [created.id]: decisionContentType,
          }));
        }

        if (decision.initialUserPrompt) {
          setPendingInitialPromptsByContentId((previous) => ({
            ...previous,
            [created.id]: decision.initialUserPrompt,
          }));
        }

        consumePendingCreateConfirmation(projectId);
        await loadContents(projectId);
        onEnterWorkspace(created.id, {});
        toast.success("已创建新文稿");
      } catch (error) {
        console.error("确认后创建文稿失败:", error);
        void reportFrontendError(error, {
          component: "useCreationDialogs",
          workflow_step: "workspace_creation_submit_confirmation",
        });
        toast.error("创建文稿失败");
      } finally {
        setCreatingContent(false);
        delete createConfirmationSubmittingProjectsRef.current[projectId];
      }
    },
    [
      consumePendingCreateConfirmation,
      creatingContent,
      loadContents,
      onEnterWorkspace,
      pendingCreateConfirmationByProjectId,
      theme,
    ],
  );

  const handleCreationIntentValueChange = useCallback(
    (key: CreationIntentFieldKey, value: string) => {
      dispatchCreateContentDialog({
        type: "updateIntentValue",
        key,
        value,
      });
    },
    [],
  );

  const handleGoToIntentStep = useCallback(() => {
    const fields = getCreationIntentFieldsSafe(
      createContentDialogState.selectedCreationMode,
    );
    const hasOnlyFallbackTopicField =
      fields.length === 1 && fields[0]?.key === "topic";
    if (
      hasOnlyFallbackTopicField &&
      createContentDialogState.selectedCreationMode !== "guided"
    ) {
      console.warn(
        "[useCreationDialogs] 检测到创作模式字段异常，已降级为引导模式",
        {
          mode: createContentDialogState.selectedCreationMode,
          fieldCount: fields.length,
        },
      );
      dispatchCreateContentDialog({
        type: "setMode",
        mode: "guided",
      });
    }

    dispatchCreateContentDialog({
      type: "goIntentStep",
    });
  }, [createContentDialogState.selectedCreationMode]);

  const handleCreateContent = useCallback(async () => {
    if (!selectedProjectId) {
      return;
    }

    const validation = validateCreationIntent(
      creationIntentInput,
      minCreationIntentLength,
    );
    if (!validation.valid) {
      setCreationIntentError(validation.message || "请完善创作意图");
      return;
    }

    const initialUserPrompt = buildCreationIntentPrompt(creationIntentInput);
    const creationIntentMetadata =
      buildCreationIntentMetadata(creationIntentInput);

    setCreatingContent(true);
    try {
      const defaultType = getDefaultContentTypeForProject(theme as ProjectType);
      const created = await createContent({
        project_id: selectedProjectId,
        title: `新${getContentTypeLabel(defaultType)}`,
        content_type: defaultType,
        metadata: {
          creationMode: createContentDialogState.selectedCreationMode,
          creationIntent: creationIntentMetadata,
        },
      });

      setCreationModes((previous) => ({
        ...previous,
        [created.id]: createContentDialogState.selectedCreationMode,
      }));
      const createdContentType = parseContentTypeFromMetadata(
        creationIntentMetadata,
      );
      if (createdContentType) {
        setCreationTypes((previous) => ({
          ...previous,
          [created.id]: createdContentType,
        }));
      }
      setPendingInitialPromptsByContentId((previous) => ({
        ...previous,
        [created.id]: initialUserPrompt,
      }));
      setCreateContentDialogOpen(false);
      resetCreateContentDialogState();
      await loadContents(selectedProjectId);
      onEnterWorkspace(created.id, {});
      toast.success("已创建新文稿");
    } catch (error) {
      console.error("创建文稿失败:", error);
      void reportFrontendError(error, {
        component: "useCreationDialogs",
        workflow_step: "workspace_creation_submit_intent",
        creation_mode: createContentDialogState.selectedCreationMode,
      });
      toast.error("创建文稿失败");
    } finally {
      setCreatingContent(false);
    }
  }, [
    creationIntentInput,
    loadContents,
    minCreationIntentLength,
    onEnterWorkspace,
    resetCreateContentDialogState,
    createContentDialogState.selectedCreationMode,
    selectedProjectId,
    setCreationIntentError,
    theme,
  ]);

  const consumePendingInitialPrompt = useCallback((contentId: string) => {
    setPendingInitialPromptsByContentId((previous) => {
      if (!previous[contentId]) {
        return previous;
      }
      const next = { ...previous };
      delete next[contentId];
      return next;
    });
  }, []);

  useWorkspaceProjectsRootLoader(setWorkspaceProjectsRoot);
  useProjectPathResolver({
    createProjectDialogOpen,
    newProjectName,
    resetProjectPathState,
    setResolvedProjectPath,
  });
  useProjectPathConflictChecker({
    createProjectDialogOpen,
    resolvedProjectPath,
    setPathChecking,
    setPathConflictMessage,
  });
  useCreationMetadataLoader({
    selectedContentId,
    creationModes,
    setCreationModes,
    creationTypes,
    setCreationTypes,
  });

  useEffect(() => {
    if (initialCreateConfirmationAppliedRef.current) {
      return;
    }
    if (!selectedProjectId) {
      return;
    }
    const normalizedPrompt = initialCreateConfirmation?.prompt?.trim() || "";
    if (!normalizedPrompt) {
      initialCreateConfirmationAppliedRef.current = true;
      return;
    }

    upsertPendingCreateConfirmation(
      selectedProjectId,
      initialCreateConfirmation?.source || "workspace_prompt",
      {
        initialUserPrompt: normalizedPrompt,
        creationMode:
          initialCreateConfirmation?.creationMode ?? defaultCreationMode,
        fallbackContentTitle: initialCreateConfirmation?.fallbackContentTitle,
      },
    );
    onEnterWorkspace("", { createEntryHome: true });
    initialCreateConfirmationAppliedRef.current = true;
  }, [
    defaultCreationMode,
    initialCreateConfirmation,
    onEnterWorkspace,
    selectedProjectId,
    upsertPendingCreateConfirmation,
  ]);

  return {
    createProjectDialogOpen,
    setCreateProjectDialogOpen,
    createContentDialogOpen,
    setCreateContentDialogOpen,
    createContentDialogStep: createContentDialogState.step,
    setCreateContentDialogStep,
    newProjectName,
    setNewProjectName,
    workspaceProjectsRoot,
    creatingProject,
    creatingContent,
    selectedCreationMode: createContentDialogState.selectedCreationMode,
    setSelectedCreationMode,
    creationIntentValues: createContentDialogState.creationIntentValues,
    creationIntentError: createContentDialogState.creationIntentError,
    setCreationIntentError,
    currentCreationIntentFields,
    currentIntentLength,
    pendingInitialPromptsByContentId,
    pendingCreateConfirmationByProjectId,
    creationModes,
    creationTypes,
    resolvedProjectPath,
    pathChecking,
    pathConflictMessage,
    resetCreateContentDialogState,
    handleOpenCreateProjectDialog,
    handleCreateProject,
    handleOpenCreateContentDialog,
    handleCreateContentFromWorkspaceEntry,
    handleCreateContentFromWorkspacePrompt,
    handleCreationIntentValueChange,
    handleGoToIntentStep,
    handleCreateContent,
    handleQuickCreateProjectAndContent,
    handleOpenProjectForWriting,
    submitCreateConfirmation,
    consumePendingInitialPrompt,
    consumePendingCreateConfirmation,
  };
}

export default useCreationDialogs;
