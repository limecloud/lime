import process from "node:process";

export const LOG_PREFIX = "[chat-fixture]";

export const APP_SERVER_HANDLE_JSON_LINES_COMMAND =
  "app_server_handle_json_lines";

export const APP_SERVER_DRAIN_EVENTS_COMMAND = "app_server_drain_events";

export const APP_SERVER_METHOD_INITIALIZE = "initialize";

export const APP_SERVER_METHOD_INITIALIZED = "initialized";

export const APP_SERVER_METHOD_SESSION_START = "thread/start";

export const APP_SERVER_METHOD_SESSION_TURN_START = "turn/start";

export const APP_SERVER_METHOD_SESSION_TURN_CANCEL = "turn/interrupt";

export const APP_SERVER_METHOD_SESSION_READ = "thread/read";

export const APP_SERVER_METHOD_SESSION_THREAD_RESUME = "thread/resume";

export const APP_SERVER_METHOD_SESSION_LIST = "thread/list";

export const APP_SERVER_METHOD_WORKFLOW_READ = "workflow/read";

export const APP_SERVER_METHOD_MEDIA_TASK_ARTIFACT_GET =
  "mediaTaskArtifact/get";

export const APP_SERVER_METHOD_MEDIA_TASK_ARTIFACT_LIST =
  "mediaTaskArtifact/list";

export const APP_SERVER_METHOD_WORKSPACE_DEFAULT_ENSURE =
  "workspace/default/ensure";

export const RECOVERY_PROMPT = "验证运行中会话恢复";

export const GREETING_PROMPT = "你好";

export const INPUTBAR_RICH_RESTORE_PROMPT =
  "请结合这个截图、文件和 Capability Report 技能，先不要输出正文。";

export const ASSISTANT_DONE_TEXT = "CHAT_FIXTURE_DONE";

export const GREETING_DONE_TEXT = "CHAT_GREETING_DONE";

export const GREETING_SUMMARY_TEXT = "你好，我在，可以继续说需求";

export const FIXTURE_PROVIDER = "fixture-provider";

export const FIXTURE_MODEL = "fixture-model";

export const TEXT_FIXTURE_PROVIDER_NAME = "Fixture Text Provider";

export const TEXT_PROVIDER_FIXTURE_API_KEY = "sk-chat-text-fixture";

export const SESSION_ID = `chat-fixture-${Date.now()}-${process.pid}`;

export const SESSION_TITLE = "会话恢复 Electron fixture";

export const RUNNING_TEXT = "会话恢复测试正在运行：\n";
