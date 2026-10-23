use std::collections::HashMap;
use std::sync::LazyLock;

pub static MODEL_CONTEXT_WINDOWS: LazyLock<HashMap<&'static str, usize>> = LazyLock::new(|| {
    let mut windows = HashMap::new();

    windows.insert("claude-3-5-sonnet-20241022", 200_000);
    windows.insert("claude-3-7-sonnet-20250219", 200_000);
    windows.insert("claude-4-0-sonnet-20250514", 200_000);
    windows.insert("claude-3-opus-20240229", 200_000);
    windows.insert("claude-3-sonnet-20240229", 200_000);
    windows.insert("claude-3-haiku-20240307", 200_000);
    windows.insert("gpt-4o", 128_000);
    windows.insert("gpt-4o-mini", 128_000);
    windows.insert("gpt-4-turbo", 128_000);
    windows.insert("gpt-4", 8_192);
    windows.insert("gpt-3.5-turbo", 16_385);
    windows.insert("default", 200_000);

    windows
});

const MODEL_CONTEXT_WINDOW_PATTERNS: &[(&str, usize)] = &[
    ("gpt-6", 1_050_000),
    ("claude-sonnet-5-5", 1_000_000),
    ("claude-sonnet-5.5", 1_000_000),
    ("claude-opus-5-5", 1_000_000),
    ("claude-opus-5.5", 1_000_000),
    ("claude-haiku-5-5", 1_000_000),
    ("claude-haiku-5.5", 1_000_000),
    ("gemini-4-argon", 1_048_576),
    ("gemini-3.8-flash", 1_048_576),
    ("kimi-k3", 1_048_576),
    ("kimi-for-coding-highspeed", 262_144),
    ("kimi-for-coding", 1_048_576),
    ("k3-256k", 262_144),
    ("glm-5.3", 1_048_576),
    ("mimo-v2.6", 1_048_576),
    ("minimax-m3", 1_048_576),
    ("deepseek-flash", 1_048_576),
    ("deepseek-v4", 1_048_576),
    ("qwen3.7-plus", 1_000_000),
    ("qwen3.8-flash", 1_000_000),
    ("grok-4.7", 500_000),
    ("gpt-5.2-codex", 400_000),
    ("gpt-5.2", 400_000),
    ("gpt-5.1-codex-max", 256_000),
    ("gpt-5.1-codex-mini", 256_000),
    ("gpt-4-turbo", 128_000),
    ("gpt-4.1", 1_000_000),
    ("gpt-4-1", 1_000_000),
    ("gpt-4o", 128_000),
    ("gpt-4", 8_192),
    ("o4-mini", 200_000),
    ("o3-mini", 200_000),
    ("o3", 200_000),
    ("claude", 200_000),
    ("gemini-1.5-flash", 1_000_000),
    ("gemini-1", 128_000),
    ("gemini-2", 1_000_000),
    ("gemma-3-27b", 128_000),
    ("gemma-3-12b", 128_000),
    ("gemma-3-4b", 128_000),
    ("gemma-3-1b", 32_000),
    ("gemma3-27b", 128_000),
    ("gemma3-12b", 128_000),
    ("gemma3-4b", 128_000),
    ("gemma3-1b", 32_000),
    ("gemma-2-27b", 8_192),
    ("gemma-2-9b", 8_192),
    ("gemma-2-2b", 8_192),
    ("gemma2-", 8_192),
    ("gemma-7b", 8_192),
    ("gemma-2b", 8_192),
    ("gemma1", 8_192),
    ("gemma", 8_192),
    ("llama-2-1b", 32_000),
    ("llama", 128_000),
    ("qwen3-coder", 262_144),
    ("qwen2-7b", 128_000),
    ("qwen2-14b", 128_000),
    ("qwen2-32b", 131_072),
    ("qwen2-70b", 262_144),
    ("qwen2", 128_000),
    ("qwen3-32b", 131_072),
    ("grok-4", 256_000),
    ("grok-code-fast-1", 256_000),
    ("grok", 131_072),
    ("kimi-k2", 131_072),
];

pub fn resolve_model_context_window(model_name: &str) -> Option<usize> {
    let model_lower = model_name.trim().to_ascii_lowercase();
    if model_lower.is_empty() {
        return None;
    }

    MODEL_CONTEXT_WINDOWS
        .get(model_lower.as_str())
        .copied()
        .or_else(|| {
            MODEL_CONTEXT_WINDOW_PATTERNS
                .iter()
                .find_map(|(pattern, context_window)| {
                    model_lower.contains(pattern).then_some(*context_window)
                })
        })
}

pub fn resolve_model_context_window_or(model_name: Option<&str>, fallback: usize) -> usize {
    model_name
        .and_then(resolve_model_context_window)
        .filter(|limit| *limit > 0)
        .unwrap_or(fallback)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_model_context_window_should_use_ordered_patterns() {
        assert_eq!(
            resolve_model_context_window("openai/gpt-4.1-mini"),
            Some(1_000_000)
        );
        assert_eq!(resolve_model_context_window("gpt-4"), Some(8_192));
        assert_eq!(
            resolve_model_context_window("google/gemma-3-27b-it"),
            Some(128_000)
        );
        assert_eq!(resolve_model_context_window("gpt-6.1-sol"), Some(1_050_000));
        assert_eq!(
            resolve_model_context_window("anthropic/claude-sonnet-5.5"),
            Some(1_000_000)
        );
        assert_eq!(resolve_model_context_window("k3-256k"), Some(262_144));
        assert_eq!(resolve_model_context_window("grok-4.7"), Some(500_000));
    }

    #[test]
    fn resolve_model_context_window_or_should_fallback_for_provider_hint() {
        assert_eq!(
            resolve_model_context_window_or(Some("openai"), 170_000),
            170_000
        );
        assert_eq!(resolve_model_context_window_or(None, 170_000), 170_000);
    }
}
