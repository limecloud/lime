#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(process.cwd());
const sourceRoots = ["src"];
const sourceExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);
const rustSourceRoots = ["src-tauri/src", "src-tauri/crates"];
const rustSourceExtensions = new Set([".rs"]);
const ignoredDirs = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  "target",
  ".git",
  ".turbo",
  ".next",
]);

const importSurfaceMonitors = [
  {
    id: "general-chat-root-entry",
    classification: "deprecated",
    description: "旧 general-chat 根导出入口",
    targets: ["src/components/general-chat/index.ts"],
    allowedPaths: [],
  },
  {
    id: "general-chat-page-entry",
    classification: "deprecated",
    description: "旧 general-chat 页面实现入口",
    targets: ["src/components/general-chat/GeneralChatPage.tsx"],
    allowedPaths: ["src/components/general-chat/index.ts"],
  },
  {
    id: "general-chat-legacy-session-hook",
    classification: "dead-candidate",
    description: "旧 general-chat 会话兼容 Hook",
    targets: ["src/components/general-chat/hooks/useSession.ts"],
    allowedPaths: [],
  },
  {
    id: "general-chat-legacy-streaming-hook",
    classification: "compat",
    description: "旧 general-chat 流式兼容 Hook",
    targets: ["src/components/general-chat/hooks/useStreaming.ts"],
    allowedPaths: ["src/components/general-chat/GeneralChatPage.tsx"],
  },
  {
    id: "general-chat-compat-gateway",
    classification: "dead-candidate",
    description: "general-chat compat API 网关",
    targets: ["src/lib/api/generalChatCompat.ts"],
    allowedPaths: ["src/components/general-chat/store/useGeneralChatStore.ts"],
  },
  {
    id: "agent-compat-gateway",
    classification: "deprecated",
    description: "Agent / Aster compat API 网关",
    targets: ["src/lib/api/agentCompat.ts"],
    allowedPaths: [],
  },
  {
    id: "heartbeat-api-gateway",
    classification: "deprecated",
    description: "旧 heartbeat 前端 API 入口",
    targets: ["src/lib/api/heartbeat.ts"],
    allowedPaths: [],
  },
  {
    id: "heartbeat-settings-page-entry",
    classification: "deprecated",
    description: "旧 heartbeat 设置页入口",
    targets: ["src/components/settings-v2/system/heartbeat/index.tsx"],
    allowedPaths: [],
  },
  {
    id: "assistant-settings-page-entry",
    classification: "deprecated",
    description: "旧助理服务设置页入口",
    targets: ["src/components/settings-v2/agent/assistant/index.tsx"],
    allowedPaths: [],
  },
];

const commandSurfaceMonitors = [
  {
    id: "general-chat-compat-commands",
    classification: "compat",
    description: "general_chat compat 命令前端边界",
    commands: [
      "general_chat_get_session",
      "general_chat_list_sessions",
      "general_chat_create_session",
      "general_chat_delete_session",
      "general_chat_rename_session",
      "general_chat_get_messages",
    ],
    allowedPaths: ["src/lib/api/generalChatCompat.ts"],
  },
  {
    id: "conversation-memory-legacy-commands",
    classification: "compat",
    description: "旧 conversation memory 命令前端边界",
    commands: [
      "get_conversation_memory_overview",
      "get_conversation_memory_stats",
      "request_conversation_memory_analysis",
      "cleanup_conversation_memory",
    ],
    allowedPaths: ["src/lib/api/memoryRuntime.ts"],
  },
  {
    id: "prompt-switch-legacy-command",
    classification: "deprecated",
    description: "旧 prompt 切换命令前端边界",
    commands: ["switch_prompt"],
    allowedPaths: [],
  },
  {
    id: "api-key-legacy-migration-commands",
    classification: "deprecated",
    description: "旧 API Key 迁移命令前端边界",
    commands: [
      "get_legacy_api_key_credentials",
      "migrate_legacy_api_key_credentials",
      "delete_legacy_api_key_credential",
    ],
    allowedPaths: [],
  },
  {
    id: "heartbeat-legacy-commands",
    classification: "deprecated",
    description: "旧 heartbeat 命令前端边界",
    commands: [
      "get_heartbeat_config",
      "update_heartbeat_config",
      "get_heartbeat_status",
      "get_heartbeat_tasks",
      "add_heartbeat_task",
      "delete_heartbeat_task",
      "update_heartbeat_task",
      "get_heartbeat_history",
      "get_heartbeat_execution_detail",
      "get_heartbeat_task_health",
      "deliver_heartbeat_task_health_alerts",
      "trigger_heartbeat_now",
      "get_task_templates",
      "apply_task_template",
      "generate_content_creator_tasks",
      "preview_heartbeat_schedule",
      "validate_heartbeat_schedule",
    ],
    allowedPaths: [],
  },
];

const frontendTextSurfaceMonitors = [
  {
    id: "frontend-assistant-settings-surfaces",
    classification: "deprecated",
    description: "前端助理服务设置页与配置面回流",
    patterns: [
      "SettingsTabs.Assistant",
      "settings.tab.assistant",
      "AssistantSettings",
      "AssistantConfig",
      "default_assistant_id",
      "custom_assistants",
      "show_suggestions",
      "auto_select",
    ],
    allowedPaths: [],
  },
];

const rustTextSurfaceMonitors = [
  {
    id: "rust-general-chat-dao",
    classification: "deprecated",
    description: "Rust 业务层 direct GeneralChatDao 依赖",
    patterns: ["GeneralChatDao", "database::dao::general_chat"],
    allowedPaths: [],
  },
  {
    id: "rust-legacy-general-tables",
    classification: "compat",
    description: "Rust runtime direct legacy general 表访问",
    patterns: ["general_chat_sessions", "general_chat_messages"],
    allowedPaths: [
      "src-tauri/crates/core/src/app_paths.rs",
      "src-tauri/crates/core/src/database/migration/general_chat_migration.rs",
      "src-tauri/crates/core/src/database/pending_general_chat.rs",
      "src-tauri/crates/core/src/database/migration.rs",
      "src-tauri/crates/core/src/database/schema.rs",
    ],
  },
  {
    id: "rust-legacy-general-helper-usage",
    classification: "compat",
    description: "Rust runtime pending general raw helper 扩散",
    patterns: [
      "load_pending_general_session_messages_raw",
      "load_pending_general_messages_raw",
      "count_pending_general_sessions_raw",
      "count_pending_general_messages_raw",
      "sum_pending_general_message_chars_raw",
      "load_legacy_general_session_messages",
      "load_unmigrated_legacy_general_messages",
      "count_unmigrated_legacy_general_sessions",
      "count_unmigrated_legacy_general_messages",
      "sum_unmigrated_legacy_general_message_chars",
    ],
    allowedPaths: [
      "src-tauri/crates/core/src/database/pending_general_chat.rs",
      "src-tauri/crates/core/src/database/mod.rs",
    ],
  },
  {
    id: "rust-legacy-general-module-imports",
    classification: "deprecated",
    description: "Rust 外部模块直接引用 pending/legacy general 子模块",
    patterns: [
      "crate::database::legacy_general_chat::",
      "proxycast_core::database::legacy_general_chat::",
      "crate::database::pending_general_chat::",
      "proxycast_core::database::pending_general_chat::",
    ],
    allowedPaths: [],
  },
  {
    id: "rust-general-migration-flag-runtime-leak",
    classification: "deprecated",
    description: "Rust 业务层重新直接判断 general 迁移完成标记",
    patterns: [
      "migration::is_general_chat_migration_completed",
      "is_general_chat_migration_completed(",
    ],
    allowedPaths: [
      "src-tauri/crates/core/src/database/migration/general_chat_migration.rs",
      "src-tauri/crates/core/src/database/migration.rs",
      "src-tauri/crates/core/src/database/mod.rs",
    ],
  },
  {
    id: "rust-services-crate-general-chat-compat",
    classification: "deprecated",
    description: "services crate 内部继续依赖 general_chat 兼容壳",
    patterns: [
      "use crate::general_chat::",
      "use crate::general_chat::{",
      "crate::general_chat::SessionService",
    ],
    includePathPrefixes: ["src-tauri/crates/services/src"],
    allowedPaths: [],
  },
  {
    id: "rust-cross-crate-general-chat-compat",
    classification: "deprecated",
    description: "跨 crate 引回 proxycast_services::general_chat 兼容壳",
    patterns: ["proxycast_services::general_chat::"],
    allowedPaths: [],
  },
  {
    id: "rust-provider-pool-legacy-selector",
    classification: "deprecated",
    description: "provider pool legacy 凭证选择兼容方法",
    patterns: ["select_credential_with_fallback_legacy"],
    allowedPaths: [],
  },
  {
    id: "rust-memory-legacy-command-shells",
    classification: "deprecated",
    description: "旧 conversation memory Rust 命令壳回流",
    patterns: [
      "get_conversation_memory_stats",
      "get_conversation_memory_overview",
      "request_conversation_memory_analysis",
      "cleanup_conversation_memory",
    ],
    includePathPrefixes: ["src-tauri/src"],
    allowedPaths: [],
  },
  {
    id: "rust-request-tool-policy-compat-service",
    classification: "deprecated",
    description: "request_tool_policy 旧服务壳回流",
    patterns: [
      "crate::services::request_tool_policy_prompt_service::",
      "proxycast_lib::services::request_tool_policy_prompt_service::",
      "services::request_tool_policy_prompt_service::",
    ],
    allowedPaths: [],
  },
  {
    id: "rust-heartbeat-business-surfaces",
    classification: "deprecated",
    description: "Rust 业务层 heartbeat 旧实现回流",
    patterns: [
      "crate::services::heartbeat_service::",
      "services::heartbeat_service::",
      "HeartbeatServiceState",
      "heartbeat_service_adapter",
      "proxycast_core::database::dao::heartbeat",
      "heartbeat_tool",
      "RunSource::Heartbeat",
      "source = 'heartbeat'",
      "source: \"heartbeat\".to_string()",
    ],
    allowedPaths: [],
  },
  {
    id: "rust-assistant-config-surfaces",
    classification: "deprecated",
    description: "Rust 助理服务配置面回流",
    patterns: [
      "AssistantConfig",
      "AssistantProfile",
      "default_assistant_id",
      "custom_assistants",
      "show_suggestions",
      "auto_select",
    ],
    includePathPrefixes: ["src-tauri/crates/core/src/config", "src-tauri/src/config"],
    allowedPaths: [],
  },
  {
    id: "rust-migration-setting-key-leak",
    classification: "deprecated",
    description: "Rust 迁移 settings 标记字符串扩散",
    patterns: [
      "\"migrated_api_keys_to_pool\"",
      "\"migrated_provider_ids_v1\"",
      "\"cleaned_legacy_api_key_credentials\"",
      "\"migrated_mcp_proxycast_enabled\"",
      "\"migrated_mcp_created_at_to_integer\"",
      "\"model_registry_refresh_needed\"",
      "\"model_registry_version\"",
    ],
    allowedPaths: [
      "src-tauri/crates/core/src/database/migration.rs",
      "src-tauri/crates/core/src/database/migration/api_key_migration.rs",
      "src-tauri/crates/core/src/database/migration/general_chat_migration.rs",
      "src-tauri/crates/core/src/database/migration/mcp_migration.rs",
      "src-tauri/crates/core/src/database/migration/model_registry_migration.rs",
    ],
  },
  {
    id: "rust-startup-migration-call-leak",
    classification: "deprecated",
    description: "Rust 启动迁移直接调用扩散",
    patterns: [
      "migration::migrate_provider_ids(",
      "migration::mark_model_registry_refresh_needed(",
      "migration::check_model_registry_version(",
      "migration::migrate_api_keys_to_pool(",
      "migration::cleanup_legacy_api_key_credentials(",
      "migration::migrate_mcp_proxycast_enabled(",
      "migration::migrate_mcp_created_at_to_integer(",
      "migration::check_general_chat_migration_status(",
      "migration::migrate_general_chat_to_unified(",
      "migration_v2::migrate_unified_content_system(",
      "migration_v3::migrate_playwright_mcp_server(",
      "migration_v4::migrate_fix_promise_paths(",
    ],
    allowedPaths: ["src-tauri/crates/core/src/database/startup_migrations.rs"],
  },
  {
    id: "rust-startup-migration-manual-match-leak",
    classification: "deprecated",
    description: "startup migration 回流手写 match 调度",
    patterns: [
      "match migration::migrate_provider_ids(",
      "match migration::migrate_api_keys_to_pool(",
      "match migration::cleanup_legacy_api_key_credentials(",
      "match migration::migrate_mcp_proxycast_enabled(",
      "match migration::migrate_mcp_created_at_to_integer(",
      "match migration::migrate_general_chat_to_unified(",
      "match migration_v2::migrate_unified_content_system(",
      "match migration_v3::migrate_playwright_mcp_server(",
      "match migration_v4::migrate_fix_promise_paths(",
    ],
    allowedPaths: [],
  },
  {
    id: "rust-versioned-migration-local-helper-leak",
    classification: "deprecated",
    description: "versioned migration 本地重复 settings helper 回流",
    patterns: [
      "fn is_migration_completed(conn:",
      "fn mark_migration_completed(conn:",
    ],
    includePathPrefixes: ["src-tauri/crates/core/src/database/migration_v"],
    allowedPaths: [],
  },
  {
    id: "rust-versioned-migration-transaction-leak",
    classification: "deprecated",
    description: "versioned migration 直接手写事务样板回流",
    patterns: [
      "conn.execute(\"BEGIN TRANSACTION\"",
      "conn.execute(\"COMMIT\"",
      "conn.execute(\"ROLLBACK\"",
    ],
    includePathPrefixes: ["src-tauri/crates/core/src/database/migration_v"],
    allowedPaths: [],
  },
  {
    id: "rust-hardcoded-projects-path-leak",
    classification: "deprecated",
    description: "数据库迁移硬编码 legacy projects 路径",
    patterns: ["\".proxycast/projects\"", "join(\".proxycast\").join(\"projects\")"],
    includePathPrefixes: ["src-tauri/crates/core/src/database"],
    allowedPaths: [],
  },
  {
    id: "rust-hardcoded-session-files-path-leak",
    classification: "deprecated",
    description: "session files 硬编码 legacy sessions 路径",
    patterns: ["~/.proxycast/sessions", "join(\".proxycast\").join(\"sessions\")"],
    includePathPrefixes: ["src-tauri/crates/core/src/session_files"],
    allowedPaths: [],
  },
  {
    id: "rust-hardcoded-legacy-config-path-leak",
    classification: "deprecated",
    description: "数据库迁移硬编码 legacy config 路径",
    patterns: ["~/.proxycast/config.json", "join(\".proxycast\").join(\"config.json\")"],
    includePathPrefixes: ["src-tauri/crates/core/src/database"],
    allowedPaths: [],
  },
  {
    id: "rust-hardcoded-workspace-projects-path-leak",
    classification: "deprecated",
    description: "上层命令或桥接层硬编码 workspace projects 路径",
    patterns: ["~/.proxycast/projects", "join(\".proxycast\").join(\"projects\")"],
    includePathPrefixes: ["src-tauri/src"],
    allowedPaths: [],
  },
  {
    id: "rust-hardcoded-logger-path-leak",
    classification: "deprecated",
    description: "logger fallback 硬编码 legacy logs 路径",
    patterns: ["~/.proxycast/logs", "join(\".proxycast\").join(\"logs\")"],
    includePathPrefixes: ["src-tauri/crates/core/src/logger.rs"],
    allowedPaths: [],
  },
  {
    id: "rust-hardcoded-skills-path-leak",
    classification: "deprecated",
    description: "skills 相关模块硬编码 legacy skills 路径",
    patterns: ["~/.proxycast/skills", "join(\".proxycast\").join(\"skills\")"],
    includePathPrefixes: ["src-tauri/src"],
    allowedPaths: [],
  },
  {
    id: "rust-hardcoded-memory-path-leak",
    classification: "deprecated",
    description: "memory 相关模块硬编码 legacy memory 或 AGENTS 路径",
    patterns: [
      "~/.proxycast/AGENTS.md",
      "join(\".proxycast\").join(\"AGENTS.md\")",
      "join(\".proxycast\").join(\"memory\")",
      ".proxycast/memory",
    ],
    includePathPrefixes: ["src-tauri/src"],
    allowedPaths: [],
  },
];

const rustTextCountMonitors = [
  {
    id: "rust-app-paths-root-fetch-duplication",
    classification: "deprecated",
    description: "app_paths 重复获取 preferred/legacy root 样板回流",
    includePathPrefixes: ["src-tauri/crates/core/src/app_paths.rs"],
    occurrences: [
      {
        pattern: "let preferred_root = preferred_data_dir()?;",
        maxCount: 1,
      },
      {
        pattern: "let legacy_root = legacy_home_dir()?;",
        maxCount: 1,
      },
    ],
  },
];

function normalizePath(filePath) {
  return filePath.split(path.sep).join("/");
}

function resolveExistingSourcePath(absolutePath) {
  if (fs.existsSync(absolutePath)) {
    const stats = fs.statSync(absolutePath);
    if (stats.isFile()) {
      return absolutePath;
    }
  }

  if (!path.extname(absolutePath)) {
    for (const extension of sourceExtensions) {
      const fileCandidate = `${absolutePath}${extension}`;
      if (fs.existsSync(fileCandidate) && fs.statSync(fileCandidate).isFile()) {
        return fileCandidate;
      }
    }
  }

  for (const extension of sourceExtensions) {
    const indexCandidate = path.join(absolutePath, `index${extension}`);
    if (fs.existsSync(indexCandidate) && fs.statSync(indexCandidate).isFile()) {
      return indexCandidate;
    }
  }

  return null;
}

function resolveImportPath(importerRelativePath, specifier) {
  let absoluteCandidate = null;

  if (specifier.startsWith("@/")) {
    absoluteCandidate = path.join(repoRoot, "src", specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    absoluteCandidate = path.resolve(
      path.dirname(path.join(repoRoot, importerRelativePath)),
      specifier,
    );
  }

  if (!absoluteCandidate) {
    return null;
  }

  const resolvedPath = resolveExistingSourcePath(absoluteCandidate);
  if (!resolvedPath) {
    return null;
  }

  return normalizePath(path.relative(repoRoot, resolvedPath));
}

function isTestFile(relativePath) {
  return (
    /(^|\/)tests(\/|$)/.test(relativePath) ||
    /(^|\/)(__tests__|__mocks__)(\/|$)/.test(relativePath) ||
    /\.(test|spec)\.[^/.]+$/.test(relativePath)
  );
}

function walkDirectory(directoryPath, extensions) {
  const files = [];

  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDirectory(fullPath, extensions));
      continue;
    }

    if (!extensions.has(path.extname(entry.name))) {
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

function extractImportSpecifiers(sourceCode) {
  const specifiers = new Set();
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["'`]([^"'`]+)["'`]/g,
    /\bexport\s+(?:type\s+)?[\s\S]*?\s+from\s+["'`]([^"'`]+)["'`]/g,
    /\bimport\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
    /\brequire\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
    /\b(?:vi|jest)\.mock\s*\(\s*["'`]([^"'`]+)["'`]/g,
  ];

  for (const pattern of patterns) {
    for (const match of sourceCode.matchAll(pattern)) {
      specifiers.add(match[1]);
    }
  }

  return specifiers;
}

function extractInvokeCommands(sourceCode) {
  const commands = new Set();
  const patterns = [
    /\bsafeInvoke(?:<[^>]+>)?\s*\(\s*["'`]([^"'`]+)["'`]/g,
    /\binvoke(?:<[^>]+>)?\s*\(\s*["'`]([^"'`]+)["'`]/g,
  ];

  for (const pattern of patterns) {
    for (const match of sourceCode.matchAll(pattern)) {
      commands.add(match[1]);
    }
  }

  return commands;
}

function stripRustTestModules(sourceCode) {
  return sourceCode.replace(
    /(?:^|\n)\s*#\s*\[\s*cfg\s*\(\s*test\s*\)\s*\][\s\S]*$/m,
    "\n",
  );
}

function collectSources() {
  const runtimeSources = [];
  const testSources = [];

  for (const root of sourceRoots) {
    const absoluteRoot = path.join(repoRoot, root);
    if (!fs.existsSync(absoluteRoot)) {
      continue;
    }

    for (const filePath of walkDirectory(absoluteRoot, sourceExtensions)) {
      const relativePath = normalizePath(path.relative(repoRoot, filePath));
      const sourceCode = fs.readFileSync(filePath, "utf8");
      const imports = extractImportSpecifiers(sourceCode);
      const collectedSource = {
        relativePath,
        imports,
        resolvedImports: new Set(
          [...imports]
            .map((specifier) => resolveImportPath(relativePath, specifier))
            .filter(Boolean),
        ),
        commands: extractInvokeCommands(sourceCode),
      };

      if (isTestFile(relativePath)) {
        testSources.push(collectedSource);
        continue;
      }

      runtimeSources.push(collectedSource);
    }
  }

  return {
    runtimeSources,
    testSources,
  };
}

function collectTextSources(roots, extensions) {
  const runtimeSources = [];
  const testSources = [];

  for (const root of roots) {
    const absoluteRoot = path.join(repoRoot, root);
    if (!fs.existsSync(absoluteRoot)) {
      continue;
    }

    for (const filePath of walkDirectory(absoluteRoot, extensions)) {
      const relativePath = normalizePath(path.relative(repoRoot, filePath));
      const sourceCode = fs.readFileSync(filePath, "utf8");
      const collectedSource = {
        relativePath,
        sourceCode:
          path.extname(relativePath) === ".rs"
            ? stripRustTestModules(sourceCode)
            : sourceCode,
        rawSourceCode: sourceCode,
      };

      if (isTestFile(relativePath)) {
        testSources.push(collectedSource);
        continue;
      }

      runtimeSources.push(collectedSource);
    }
  }

  return {
    runtimeSources,
    testSources,
  };
}

function formatPaths(paths) {
  if (paths.length === 0) {
    return "无";
  }

  return paths.map((item) => `    - ${item}`).join("\n");
}

function evaluateImportMonitor(monitor, runtimeSources, testSources) {
  const existingTargets = monitor.targets.filter((target) =>
    fs.existsSync(path.join(repoRoot, target)),
  );
  const missingTargets = monitor.targets.filter(
    (target) => !fs.existsSync(path.join(repoRoot, target)),
  );
  const references = runtimeSources
    .filter((file) =>
      [...file.resolvedImports].some((resolvedPath) =>
        monitor.targets.includes(resolvedPath),
      ),
    )
    .map((file) => file.relativePath)
    .sort();
  const testReferences = testSources
    .filter((file) =>
      [...file.resolvedImports].some((resolvedPath) =>
        monitor.targets.includes(resolvedPath),
      ),
    )
    .map((file) => file.relativePath)
    .sort();

  const violations = references.filter(
    (relativePath) => !monitor.allowedPaths.includes(relativePath),
  );

  return {
    ...monitor,
    existingTargets,
    missingTargets,
    references,
    testReferences,
    violations,
  };
}

function evaluateCommandMonitor(monitor, runtimeSources, testSources) {
  const referencesByCommand = new Map();
  const testReferencesByCommand = new Map();

  for (const command of monitor.commands) {
    referencesByCommand.set(
      command,
      runtimeSources
        .filter((file) => file.commands.has(command))
        .map((file) => file.relativePath)
        .sort(),
    );
    testReferencesByCommand.set(
      command,
      testSources
        .filter((file) => file.commands.has(command))
        .map((file) => file.relativePath)
        .sort(),
    );
  }

  const violations = [];
  for (const [command, references] of referencesByCommand.entries()) {
    for (const relativePath of references) {
      if (!monitor.allowedPaths.includes(relativePath)) {
        violations.push(`${command} -> ${relativePath}`);
      }
    }
  }

  return {
    ...monitor,
    referencesByCommand,
    testReferencesByCommand,
    violations,
  };
}

function evaluateTextMonitor(monitor, runtimeSources, testSources) {
  const filteredRuntimeSources = monitor.includePathPrefixes
    ? runtimeSources.filter((file) =>
        monitor.includePathPrefixes.some((prefix) =>
          file.relativePath.startsWith(prefix),
        ),
      )
    : runtimeSources;
  const filteredTestSources = monitor.includePathPrefixes
    ? testSources.filter((file) =>
        monitor.includePathPrefixes.some((prefix) =>
          file.relativePath.startsWith(prefix),
        ),
      )
    : testSources;
  const matchesPattern = (sourceCode) =>
    monitor.patterns.some((pattern) => sourceCode.includes(pattern));

  const references = filteredRuntimeSources
    .filter((file) => matchesPattern(file.sourceCode))
    .map((file) => file.relativePath)
    .sort();
  const testReferences = filteredTestSources
    .filter((file) => matchesPattern(file.rawSourceCode ?? file.sourceCode))
    .map((file) => file.relativePath)
    .sort();
  const violations = references.filter(
    (relativePath) => !monitor.allowedPaths.includes(relativePath),
  );

  return {
    ...monitor,
    references,
    testReferences,
    violations,
  };
}

function countOccurrences(sourceCode, pattern) {
  if (!pattern) {
    return 0;
  }

  let count = 0;
  let startIndex = 0;

  while (true) {
    const matchIndex = sourceCode.indexOf(pattern, startIndex);
    if (matchIndex === -1) {
      return count;
    }
    count += 1;
    startIndex = matchIndex + pattern.length;
  }
}

function evaluateTextCountMonitor(monitor, runtimeSources, testSources) {
  const filteredRuntimeSources = monitor.includePathPrefixes
    ? runtimeSources.filter((file) =>
        monitor.includePathPrefixes.some((prefix) =>
          file.relativePath.startsWith(prefix),
        ),
      )
    : runtimeSources;
  const filteredTestSources = monitor.includePathPrefixes
    ? testSources.filter((file) =>
        monitor.includePathPrefixes.some((prefix) =>
          file.relativePath.startsWith(prefix),
        ),
      )
    : testSources;
  const runtimeMatches = [];
  const testMatches = [];
  const violations = [];

  for (const file of filteredRuntimeSources) {
    const counts = monitor.occurrences
      .map((rule) => ({
        ...rule,
        count: countOccurrences(file.sourceCode, rule.pattern),
      }))
      .filter((rule) => rule.count > 0);

    if (counts.length === 0) {
      continue;
    }

    runtimeMatches.push({
      relativePath: file.relativePath,
      counts,
    });

    for (const rule of counts) {
      if (rule.count > rule.maxCount) {
        violations.push(
          `${file.relativePath} -> ${rule.pattern} (${rule.count} > ${rule.maxCount})`,
        );
      }
    }
  }

  for (const file of filteredTestSources) {
    const counts = monitor.occurrences
      .map((rule) => ({
        ...rule,
        count: countOccurrences(file.rawSourceCode ?? file.sourceCode, rule.pattern),
      }))
      .filter((rule) => rule.count > 0);

    if (counts.length === 0) {
      continue;
    }

    testMatches.push({
      relativePath: file.relativePath,
      counts,
    });
  }

  return {
    ...monitor,
    runtimeMatches,
    testMatches,
    violations,
  };
}

function printImportReport(result) {
  const status =
    result.violations.length > 0
      ? "违规"
      : result.references.length === 0 && result.existingTargets.length === 0
        ? "已删除"
        : result.references.length === 0
          ? "零引用"
          : "受控";

  console.log(
    `- [${status}] ${result.id} (${result.classification})：${result.description}`,
  );
  console.log(`  目标文件：${result.targets.join(", ")}`);
  console.log(`  允许引用：${result.allowedPaths.join(", ") || "无"}`);
  if (result.missingTargets.length > 0) {
    console.log(`  已删除目标：\n${formatPaths(result.missingTargets)}`);
  }
  console.log(`  实际引用：\n${formatPaths(result.references)}`);
  console.log(`  测试引用：\n${formatPaths(result.testReferences)}`);

  if (result.violations.length > 0) {
    console.log(`  违规引用：\n${formatPaths(result.violations)}`);
  }
}

function printCommandReport(result) {
  const flattenedReferences = [...result.referencesByCommand.values()].flat();
  const uniqueReferences = [...new Set(flattenedReferences)].sort();
  const status =
    result.violations.length > 0
      ? "违规"
      : uniqueReferences.length === 0
        ? "零引用"
        : "受控";

  console.log(
    `- [${status}] ${result.id} (${result.classification})：${result.description}`,
  );
  console.log(`  命令：${result.commands.join(", ")}`);
  console.log(`  允许引用：${result.allowedPaths.join(", ") || "无"}`);

  for (const command of result.commands) {
    const references = result.referencesByCommand.get(command) ?? [];
    const testReferences = result.testReferencesByCommand.get(command) ?? [];
    console.log(`  ${command}：\n${formatPaths(references)}`);
    console.log(`  ${command}（测试）：\n${formatPaths(testReferences)}`);
  }

  if (result.violations.length > 0) {
    console.log(`  违规引用：\n${formatPaths(result.violations)}`);
  }
}

function printTextReport(result) {
  const status =
    result.violations.length > 0
      ? "违规"
      : result.references.length === 0
        ? "零引用"
        : "受控";

  console.log(
    `- [${status}] ${result.id} (${result.classification})：${result.description}`,
  );
  console.log(`  关键字：${result.patterns.join(", ")}`);
  console.log(`  允许引用：${result.allowedPaths.join(", ") || "无"}`);
  console.log(`  实际引用：\n${formatPaths(result.references)}`);
  console.log(`  测试引用：\n${formatPaths(result.testReferences)}`);

  if (result.violations.length > 0) {
    console.log(`  违规引用：\n${formatPaths(result.violations)}`);
  }
}

function printTextCountReport(result) {
  const status =
    result.violations.length > 0
      ? "违规"
      : result.runtimeMatches.length === 0
        ? "零引用"
        : "受控";

  console.log(
    `- [${status}] ${result.id} (${result.classification})：${result.description}`,
  );
  console.log(
    `  次数规则：${result.occurrences
      .map((rule) => `${rule.pattern} <= ${rule.maxCount}`)
      .join("；")}`,
  );
  console.log(
    `  实际命中：\n${formatPaths(
      result.runtimeMatches.map(
        (item) =>
          `${item.relativePath} -> ${item.counts
            .map((rule) => `${rule.pattern} (${rule.count})`)
            .join("；")}`,
      ),
    )}`,
  );
  console.log(
    `  测试命中：\n${formatPaths(
      result.testMatches.map(
        (item) =>
          `${item.relativePath} -> ${item.counts
            .map((rule) => `${rule.pattern} (${rule.count})`)
            .join("；")}`,
      ),
    )}`,
  );

  if (result.violations.length > 0) {
    console.log(`  违规引用：\n${formatPaths(result.violations)}`);
  }
}

const { runtimeSources, testSources } = collectSources();
const { runtimeSources: frontendRuntimeTextSources, testSources: frontendTestTextSources } =
  collectTextSources(sourceRoots, sourceExtensions);
const { runtimeSources: rustRuntimeSources, testSources: rustTestSources } =
  collectTextSources(rustSourceRoots, rustSourceExtensions);
const importResults = importSurfaceMonitors.map((monitor) =>
  evaluateImportMonitor(monitor, runtimeSources, testSources),
);
const commandResults = commandSurfaceMonitors.map((monitor) =>
  evaluateCommandMonitor(monitor, runtimeSources, testSources),
);
const frontendTextResults = frontendTextSurfaceMonitors.map((monitor) =>
  evaluateTextMonitor(monitor, frontendRuntimeTextSources, frontendTestTextSources),
);
const rustTextResults = rustTextSurfaceMonitors.map((monitor) =>
  evaluateTextMonitor(monitor, rustRuntimeSources, rustTestSources),
);
const rustTextCountResults = rustTextCountMonitors.map((monitor) =>
  evaluateTextCountMonitor(monitor, rustRuntimeSources, rustTestSources),
);

const zeroReferenceCandidates = importResults
  .filter(
    (result) =>
      result.references.length === 0 && result.existingTargets.length > 0,
  )
  .map((result) => `${result.id} (${result.description})`);
const violations = [
  ...importResults.flatMap((result) =>
    result.violations.map((item) => `${result.id} -> ${item}`),
  ),
  ...commandResults.flatMap((result) =>
    result.violations.map((item) => `${result.id} -> ${item}`),
  ),
  ...frontendTextResults.flatMap((result) =>
    result.violations.map((item) => `${result.id} -> ${item}`),
  ),
  ...rustTextResults.flatMap((result) =>
    result.violations.map((item) => `${result.id} -> ${item}`),
  ),
  ...rustTextCountResults.flatMap((result) =>
    result.violations.map((item) => `${result.id} -> ${item}`),
  ),
];

console.log("[proxycast] legacy surface report");
console.log("");
console.log("## 入口引用");
for (const result of importResults) {
  printImportReport(result);
}

console.log("");
console.log("## 命令边界");
for (const result of commandResults) {
  printCommandReport(result);
}

console.log("");
console.log("## 前端护栏");
for (const result of frontendTextResults) {
  printTextReport(result);
}

console.log("");
console.log("## Rust 护栏");
for (const result of rustTextResults) {
  printTextReport(result);
}
for (const result of rustTextCountResults) {
  printTextCountReport(result);
}

console.log("");
console.log("## 摘要");
console.log(`- 扫描文件数：${runtimeSources.length}`);
console.log(`- 测试文件数：${testSources.length}`);
console.log(`- Rust 扫描文件数：${rustRuntimeSources.length}`);
console.log(`- Rust 测试文件数：${rustTestSources.length}`);
console.log(`- 零引用候选：${zeroReferenceCandidates.length}`);
for (const candidate of zeroReferenceCandidates) {
  console.log(`  - ${candidate}`);
}
console.log(`- 边界违规：${violations.length}`);
for (const violation of violations) {
  console.log(`  - ${violation}`);
}

if (violations.length > 0) {
  console.error("");
  console.error(
    "[proxycast] legacy surface report 检测到边界违规，请先治理再继续扩展。",
  );
  process.exit(1);
}
