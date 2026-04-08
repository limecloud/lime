//! 提示词缓存系统
//!
//! 实现 system_prompt_hash 计算和缓存优化

use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use super::types::PromptHashInfo;

/// 估算 tokens
pub fn estimate_tokens(text: &str) -> usize {
    if text.is_empty() {
        return 0;
    }

    // 检测是否包含亚洲字符
    let has_asian = text.chars().any(|c| {
        matches!(c,
            '\u{4e00}'..='\u{9fa5}' |  // CJK
            '\u{3040}'..='\u{309f}' |  // Hiragana
            '\u{30a0}'..='\u{30ff}'    // Katakana
        )
    });

    // 检测是否包含代码
    let has_code = text.starts_with("```")
        || text.contains("function ")
        || text.contains("class ")
        || text.contains("const ")
        || text.contains("let ")
        || text.contains("var ")
        || text.contains("import ")
        || text.contains("export ");

    let chars_per_token = if has_asian {
        2.0
    } else if has_code {
        3.0
    } else {
        3.5
    };

    let mut tokens = text.len() as f64 / chars_per_token;

    // 特殊字符计数
    let special_chars = text
        .chars()
        .filter(|c| {
            matches!(
                c,
                '{' | '}' | '[' | ']' | '(' | ')' | '.' | ',' | ';' | ':' | '!' | '?' | '<' | '>'
            )
        })
        .count();
    tokens += special_chars as f64 * 0.1;

    // 换行符计数
    let newlines = text.chars().filter(|c| *c == '\n').count();
    tokens += newlines as f64 * 0.5;

    tokens.ceil() as usize
}

/// 缓存条目
struct CacheEntry {
    content: String,
    hash_info: PromptHashInfo,
    expires_at: Instant,
}

/// 提示词缓存
pub struct PromptCache {
    cache: HashMap<String, CacheEntry>,
    ttl: Duration,
    max_entries: usize,
}

impl PromptCache {
    /// 创建新的缓存实例
    pub fn new(ttl_ms: Option<u64>, max_entries: Option<usize>) -> Self {
        Self {
            cache: HashMap::new(),
            ttl: Duration::from_millis(ttl_ms.unwrap_or(5 * 60 * 1000)), // 5 分钟
            max_entries: max_entries.unwrap_or(100),
        }
    }

    /// 计算提示词哈希
    pub fn compute_hash(&self, content: &str) -> PromptHashInfo {
        let mut hasher = Sha256::new();
        hasher.update(content.as_bytes());
        let result = hasher.finalize();
        let hash = hex::encode(&result[..8]); // 取前 16 个字符

        let estimated_tokens = estimate_tokens(content);
        let computed_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        PromptHashInfo {
            hash,
            computed_at,
            length: content.len(),
            estimated_tokens,
        }
    }

    /// 获取缓存的提示词
    pub fn get(&self, key: &str) -> Option<(String, PromptHashInfo)> {
        let entry = self.cache.get(key)?;

        // 检查是否过期
        if Instant::now() > entry.expires_at {
            return None;
        }

        Some((entry.content.clone(), entry.hash_info.clone()))
    }

    /// 设置缓存
    pub fn set(
        &mut self,
        key: String,
        content: String,
        hash_info: Option<PromptHashInfo>,
    ) -> PromptHashInfo {
        // 清理过期条目
        self.cleanup();

        // 检查容量
        if self.cache.len() >= self.max_entries {
            // 删除最旧的条目
            if let Some(oldest_key) = self
                .cache
                .iter()
                .min_by_key(|(_, v)| v.expires_at)
                .map(|(k, _)| k.clone())
            {
                self.cache.remove(&oldest_key);
            }
        }

        let computed_hash_info = hash_info.unwrap_or_else(|| self.compute_hash(&content));

        self.cache.insert(
            key,
            CacheEntry {
                content,
                hash_info: computed_hash_info.clone(),
                expires_at: Instant::now() + self.ttl,
            },
        );

        computed_hash_info
    }

    /// 检查缓存是否有效
    pub fn is_valid(&self, key: &str, hash: &str) -> bool {
        match self.cache.get(key) {
            Some(entry) => {
                if Instant::now() > entry.expires_at {
                    return false;
                }
                entry.hash_info.hash == hash
            }
            None => false,
        }
    }

    /// 清理过期条目
    fn cleanup(&mut self) {
        let now = Instant::now();
        self.cache.retain(|_, entry| now <= entry.expires_at);
    }

    /// 清空缓存
    pub fn clear(&mut self) {
        self.cache.clear();
    }

    /// 获取缓存大小
    pub fn size(&self) -> usize {
        self.cache.len()
    }

    /// 获取缓存统计
    pub fn get_stats(&self) -> CacheStats {
        let mut total_bytes = 0;
        let mut oldest_entry: Option<u64> = None;
        let mut newest_entry: Option<u64> = None;

        for entry in self.cache.values() {
            total_bytes += entry.content.len();
            let computed_at = entry.hash_info.computed_at;

            match oldest_entry {
                Some(old) if computed_at < old => oldest_entry = Some(computed_at),
                None => oldest_entry = Some(computed_at),
                _ => {}
            }

            match newest_entry {
                Some(new) if computed_at > new => newest_entry = Some(computed_at),
                None => newest_entry = Some(computed_at),
                _ => {}
            }
        }

        CacheStats {
            size: self.cache.len(),
            total_bytes,
            oldest_entry,
            newest_entry,
        }
    }
}

impl Default for PromptCache {
    fn default() -> Self {
        Self::new(None, None)
    }
}

/// 缓存统计信息
#[derive(Debug, Clone)]
pub struct CacheStats {
    pub size: usize,
    pub total_bytes: usize,
    pub oldest_entry: Option<u64>,
    pub newest_entry: Option<u64>,
}

/// 生成缓存键
pub fn generate_cache_key(
    working_dir: &str,
    model: Option<&str>,
    permission_mode: Option<&str>,
    plan_mode: bool,
) -> String {
    format!(
        "{}:{}:{}:{}",
        working_dir,
        model.unwrap_or("default"),
        permission_mode.unwrap_or("default"),
        if plan_mode { "plan" } else { "normal" }
    )
}
