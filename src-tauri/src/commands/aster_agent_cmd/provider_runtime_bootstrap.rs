use super::dto::ConfigureProviderRequest;
use super::provider_runtime_strategy::{is_ollama_provider, normalize_ollama_base_url};
use async_trait::async_trait;
use std::process::Stdio;
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tokio::process::Command;
use tokio::sync::Mutex as AsyncMutex;
use tokio::time::sleep;
use url::Url;

#[cfg(test)]
use std::collections::VecDeque;
#[cfg(test)]
use std::sync::atomic::{AtomicUsize, Ordering};
#[cfg(test)]
use std::sync::Mutex;

const OLLAMA_RUNTIME_BOOTSTRAP_TIMEOUT_SECS: u64 = 20;
const OLLAMA_RUNTIME_BOOTSTRAP_POLL_INTERVAL_MS: u64 = 500;

#[derive(Debug, Clone, Copy)]
struct RuntimeBootstrapPolicy {
    startup_timeout: Duration,
    poll_interval: Duration,
}

impl Default for RuntimeBootstrapPolicy {
    fn default() -> Self {
        Self {
            startup_timeout: Duration::from_secs(OLLAMA_RUNTIME_BOOTSTRAP_TIMEOUT_SECS),
            poll_interval: Duration::from_millis(OLLAMA_RUNTIME_BOOTSTRAP_POLL_INTERVAL_MS),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LocalProviderRuntimeStrategy {
    Ollama,
}

impl LocalProviderRuntimeStrategy {
    fn resolve(request: &ConfigureProviderRequest) -> Option<Self> {
        if is_ollama_provider(request.provider_id.as_deref(), &request.provider_name) {
            return Some(Self::Ollama);
        }
        None
    }

    async fn ensure_ready(self, request: &ConfigureProviderRequest) -> Result<(), String> {
        match self {
            Self::Ollama => {
                ensure_ollama_runtime_ready(&normalize_ollama_base_url(request.base_url.as_deref()))
                    .await
            }
        }
    }
}

pub(crate) async fn ensure_provider_runtime_ready(
    request: &ConfigureProviderRequest,
) -> Result<(), String> {
    let Some(strategy) = LocalProviderRuntimeStrategy::resolve(request) else {
        return Ok(());
    };

    strategy.ensure_ready(request).await
}

fn ollama_launch_guard() -> &'static AsyncMutex<()> {
    static GUARD: OnceLock<AsyncMutex<()>> = OnceLock::new();
    GUARD.get_or_init(|| AsyncMutex::new(()))
}

fn should_manage_local_ollama_runtime(base_url: &str) -> bool {
    let Ok(parsed) = Url::parse(base_url) else {
        return false;
    };
    matches!(parsed.host_str(), Some("127.0.0.1" | "localhost" | "::1"))
}

#[async_trait]
trait OllamaRuntimeHooks: Send + Sync {
    async fn is_ready(&self, base_url: &str) -> bool;
    async fn launch(&self) -> Result<(), String>;
}

struct SystemOllamaRuntimeHooks;

#[async_trait]
impl OllamaRuntimeHooks for SystemOllamaRuntimeHooks {
    async fn is_ready(&self, base_url: &str) -> bool {
        check_ollama_runtime_ready(base_url).await
    }

    async fn launch(&self) -> Result<(), String> {
        launch_ollama_runtime().await
    }
}

async fn ensure_ollama_runtime_ready(base_url: &str) -> Result<(), String> {
    let hooks = SystemOllamaRuntimeHooks;
    ensure_ollama_runtime_ready_with_hooks(base_url, &hooks, RuntimeBootstrapPolicy::default())
        .await
}

async fn ensure_ollama_runtime_ready_with_hooks(
    base_url: &str,
    hooks: &dyn OllamaRuntimeHooks,
    policy: RuntimeBootstrapPolicy,
) -> Result<(), String> {
    if !should_manage_local_ollama_runtime(base_url) {
        return Ok(());
    }

    if hooks.is_ready(base_url).await {
        return Ok(());
    }

    let _guard = ollama_launch_guard().lock().await;
    if hooks.is_ready(base_url).await {
        return Ok(());
    }

    tracing::warn!(
        "[AsterAgent] 检测到本地 Ollama 未就绪，尝试自动拉起: {}",
        base_url
    );
    hooks
        .launch()
        .await
        .map_err(|error| format!("自动启动本地 Ollama 失败: {error}"))?;

    let deadline = Instant::now() + policy.startup_timeout;
    loop {
        if hooks.is_ready(base_url).await {
            tracing::info!("[AsterAgent] 本地 Ollama 已就绪: {}", base_url);
            return Ok(());
        }
        if Instant::now() >= deadline {
            break;
        }
        sleep(policy.poll_interval).await;
    }

    Err(format!(
        "本地 Ollama 未就绪，已尝试自动启动但仍无法连接：{}。请确认 Ollama.app 或 `ollama serve` 已运行。",
        base_url
    ))
}

async fn check_ollama_runtime_ready(base_url: &str) -> bool {
    let tags_url = format!("{}/api/tags", base_url.trim_end_matches('/'));
    let Ok(client) = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .no_proxy()
        .build()
    else {
        return false;
    };

    client
        .get(tags_url)
        .send()
        .await
        .ok()
        .and_then(|response| response.error_for_status().ok())
        .is_some()
}

#[derive(Debug, Clone)]
struct CommandCandidate {
    program: &'static str,
    args: &'static [&'static str],
}

fn ollama_launch_candidates() -> Vec<CommandCandidate> {
    #[cfg(target_os = "macos")]
    {
        vec![
            CommandCandidate {
                program: "ollama",
                args: &["serve"],
            },
            CommandCandidate {
                program: "/Applications/Ollama.app/Contents/Resources/ollama",
                args: &["serve"],
            },
            CommandCandidate {
                program: "open",
                args: &["-a", "Ollama"],
            },
        ]
    }

    #[cfg(not(target_os = "macos"))]
    {
        vec![CommandCandidate {
            program: "ollama",
            args: &["serve"],
        }]
    }
}

async fn launch_ollama_runtime() -> Result<(), String> {
    let mut errors = Vec::new();

    for candidate in ollama_launch_candidates() {
        let mut command = Command::new(candidate.program);
        command
            .args(candidate.args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        match command.spawn() {
            Ok(child) => {
                drop(child);
                tracing::info!(
                    "[AsterAgent] 已发起本地 Ollama 启动命令: {} {:?}",
                    candidate.program,
                    candidate.args
                );
                return Ok(());
            }
            Err(error) => {
                errors.push(format!(
                    "{} {:?}: {}",
                    candidate.program, candidate.args, error
                ));
            }
        }
    }

    Err(errors.join(" | "))
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FakeOllamaRuntimeHooks {
        readiness: Mutex<VecDeque<bool>>,
        launch_count: AtomicUsize,
        launch_result: Result<(), String>,
    }

    impl FakeOllamaRuntimeHooks {
        fn new(readiness: Vec<bool>, launch_result: Result<(), String>) -> Self {
            Self {
                readiness: Mutex::new(readiness.into()),
                launch_count: AtomicUsize::new(0),
                launch_result,
            }
        }

        fn launch_count(&self) -> usize {
            self.launch_count.load(Ordering::SeqCst)
        }
    }

    #[async_trait]
    impl OllamaRuntimeHooks for FakeOllamaRuntimeHooks {
        async fn is_ready(&self, _base_url: &str) -> bool {
            self.readiness
                .lock()
                .expect("lock readiness")
                .pop_front()
                .unwrap_or(false)
        }

        async fn launch(&self) -> Result<(), String> {
            self.launch_count.fetch_add(1, Ordering::SeqCst);
            self.launch_result.clone()
        }
    }

    fn fast_policy() -> RuntimeBootstrapPolicy {
        RuntimeBootstrapPolicy {
            startup_timeout: Duration::from_millis(20),
            poll_interval: Duration::from_millis(1),
        }
    }

    #[test]
    fn should_only_manage_loopback_ollama_runtime() {
        assert!(should_manage_local_ollama_runtime("http://127.0.0.1:11434"));
        assert!(should_manage_local_ollama_runtime("http://localhost:11434"));
        assert!(!should_manage_local_ollama_runtime(
            "https://ollama.example.com"
        ));
    }

    #[tokio::test]
    async fn ensure_should_skip_remote_ollama_host() {
        let hooks = FakeOllamaRuntimeHooks::new(vec![false], Ok(()));

        ensure_ollama_runtime_ready_with_hooks("https://ollama.example.com", &hooks, fast_policy())
            .await
            .expect("remote host should skip bootstrap");

        assert_eq!(hooks.launch_count(), 0);
    }

    #[tokio::test]
    async fn ensure_should_not_launch_when_ollama_is_already_ready() {
        let hooks = FakeOllamaRuntimeHooks::new(vec![true], Ok(()));

        ensure_ollama_runtime_ready_with_hooks("http://127.0.0.1:11434", &hooks, fast_policy())
            .await
            .expect("ready ollama");

        assert_eq!(hooks.launch_count(), 0);
    }

    #[tokio::test]
    async fn ensure_should_launch_once_and_wait_until_ready() {
        let hooks = FakeOllamaRuntimeHooks::new(vec![false, false, true], Ok(()));

        ensure_ollama_runtime_ready_with_hooks("http://127.0.0.1:11434", &hooks, fast_policy())
            .await
            .expect("ollama should become ready after launch");

        assert_eq!(hooks.launch_count(), 1);
    }

    #[tokio::test]
    async fn ensure_should_fail_when_launch_does_not_make_ollama_ready() {
        let hooks = FakeOllamaRuntimeHooks::new(vec![false, false, false, false], Ok(()));

        let error =
            ensure_ollama_runtime_ready_with_hooks("http://127.0.0.1:11434", &hooks, fast_policy())
                .await
                .expect_err("ollama should time out");

        assert_eq!(hooks.launch_count(), 1);
        assert!(error.contains("本地 Ollama 未就绪"));
    }
}
