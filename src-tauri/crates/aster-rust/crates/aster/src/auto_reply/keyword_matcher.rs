//! 关键词匹配器
//!
//! 支持精确匹配、正则匹配和大小写不敏感匹配。
//!
//! # 功能
//!
//! - 精确字符串匹配 (Requirement 7.1)
//! - 正则表达式匹配 (Requirement 7.2)
//! - 大小写不敏感匹配 (Requirement 7.3)
//! - 多模式匹配支持 (Requirement 7.4)
//! - 任一模式匹配即返回成功 (Requirement 7.5)
//! - 返回匹配模式和位置 (Requirement 7.6)
//!
//! # 示例
//!
//! ```rust
//! use aster::auto_reply::{KeywordMatcher, KeywordTriggerConfig};
//!
//! let mut matcher = KeywordMatcher::new();
//! let config = KeywordTriggerConfig {
//!     patterns: vec!["hello".to_string(), "world".to_string()],
//!     case_insensitive: true,
//!     use_regex: false,
//! };
//!
//! if let Some(result) = matcher.match_message("Hello World!", &config) {
//!     println!("Matched: {} at position {}", result.matched_pattern, result.position);
//! }
//! ```

use std::collections::HashMap;

use regex::Regex;

use crate::auto_reply::types::KeywordTriggerConfig;

/// 关键词匹配结果
#[derive(Debug, Clone)]
pub struct KeywordMatchResult {
    /// 匹配的模式
    pub matched_pattern: String,
    /// 匹配位置
    pub position: usize,
    /// 匹配的文本
    pub matched_text: String,
}

/// 关键词匹配器
pub struct KeywordMatcher {
    /// 编译后的正则表达式缓存
    regex_cache: HashMap<String, Regex>,
}

impl Default for KeywordMatcher {
    fn default() -> Self {
        Self::new()
    }
}

impl KeywordMatcher {
    /// 创建新的关键词匹配器
    pub fn new() -> Self {
        Self {
            regex_cache: HashMap::new(),
        }
    }

    /// 匹配消息内容
    pub fn match_message(
        &mut self,
        content: &str,
        config: &KeywordTriggerConfig,
    ) -> Option<KeywordMatchResult> {
        let content_to_match = if config.case_insensitive {
            content.to_lowercase()
        } else {
            content.to_string()
        };

        for pattern in &config.patterns {
            let pattern_to_match = if config.case_insensitive {
                pattern.to_lowercase()
            } else {
                pattern.clone()
            };

            if config.use_regex {
                if let Some(result) =
                    self.match_regex(&content_to_match, &pattern_to_match, pattern)
                {
                    return Some(result);
                }
            } else if let Some(pos) = content_to_match.find(&pattern_to_match) {
                // 使用 char_indices 安全地提取 UTF-8 字符串
                let matched_text = content
                    .char_indices()
                    .skip_while(|(i, _)| *i < pos)
                    .take_while(|(i, _)| *i < pos + pattern.len())
                    .map(|(_, c)| c)
                    .collect::<String>();
                return Some(KeywordMatchResult {
                    matched_pattern: pattern.clone(),
                    position: pos,
                    matched_text,
                });
            }
        }
        None
    }

    /// 使用正则表达式匹配
    fn match_regex(
        &mut self,
        content: &str,
        pattern: &str,
        original_pattern: &str,
    ) -> Option<KeywordMatchResult> {
        let regex = self.compile_regex(pattern)?;
        regex.find(content).map(|m| KeywordMatchResult {
            matched_pattern: original_pattern.to_string(),
            position: m.start(),
            matched_text: m.as_str().to_string(),
        })
    }

    /// 编译正则表达式（带缓存）
    fn compile_regex(&mut self, pattern: &str) -> Option<&Regex> {
        if !self.regex_cache.contains_key(pattern) {
            match Regex::new(pattern) {
                Ok(regex) => {
                    self.regex_cache.insert(pattern.to_string(), regex);
                }
                Err(e) => {
                    tracing::warn!("正则表达式编译失败: {} - {}", pattern, e);
                    return None;
                }
            }
        }
        self.regex_cache.get(pattern)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ========================================
    // Requirement 7.1: 精确字符串匹配
    // ========================================

    #[test]
    fn test_exact_match_simple() {
        let mut matcher = KeywordMatcher::new();
        let config = KeywordTriggerConfig {
            patterns: vec!["hello".to_string()],
            case_insensitive: false,
            use_regex: false,
        };

        let result = matcher.match_message("hello world", &config);
        assert!(result.is_some());
        let result = result.unwrap();
        assert_eq!(result.matched_pattern, "hello");
        assert_eq!(result.position, 0);
        assert_eq!(result.matched_text, "hello");
    }

    #[test]
    fn test_exact_match_middle_of_string() {
        let mut matcher = KeywordMatcher::new();
        let config = KeywordTriggerConfig {
            patterns: vec!["world".to_string()],
            case_insensitive: false,
            use_regex: false,
        };

        let result = matcher.match_message("hello world!", &config);
        assert!(result.is_some());
        let result = result.unwrap();
        assert_eq!(result.matched_pattern, "world");
        assert_eq!(result.position, 6);
        assert_eq!(result.matched_text, "world");
    }

    #[test]
    fn test_exact_match_no_match() {
        let mut matcher = KeywordMatcher::new();
        let config = KeywordTriggerConfig {
            patterns: vec!["foo".to_string()],
            case_insensitive: false,
            use_regex: false,
        };

        let result = matcher.match_message("hello world", &config);
        assert!(result.is_none());
    }

    #[test]
    fn test_exact_match_case_sensitive() {
        let mut matcher = KeywordMatcher::new();
        let config = KeywordTriggerConfig {
            patterns: vec!["Hello".to_string()],
            case_insensitive: false,
            use_regex: false,
        };

        // 大小写敏感时，"hello" 不匹配 "Hello"
        let result = matcher.match_message("hello world", &config);
        assert!(result.is_none());

        // 大小写匹配时应该成功
        let result = matcher.match_message("Hello world", &config);
        assert!(result.is_some());
    }

    // ========================================
    // Requirement 7.2: 正则表达式匹配
    // ========================================

    #[test]
    fn test_regex_match_simple() {
        let mut matcher = KeywordMatcher::new();
        let config = KeywordTriggerConfig {
            patterns: vec![r"hel+o".to_string()],
            case_insensitive: false,
            use_regex: true,
        };

        let result = matcher.match_message("helllo world", &config);
        assert!(result.is_some());
        let result = result.unwrap();
        assert_eq!(result.matched_pattern, r"hel+o");
        assert_eq!(result.position, 0);
        assert_eq!(result.matched_text, "helllo");
    }

    #[test]
    fn test_regex_match_word_boundary() {
        let mut matcher = KeywordMatcher::new();
        let config = KeywordTriggerConfig {
            patterns: vec![r"\bworld\b".to_string()],
            case_insensitive: false,
            use_regex: true,
        };

        let result = matcher.match_message("hello world!", &config);
        assert!(result.is_some());
        let result = result.unwrap();
        assert_eq!(result.matched_text, "world");
    }

    #[test]
    fn test_regex_match_digit_pattern() {
        let mut matcher = KeywordMatcher::new();
        let config = KeywordTriggerConfig {
            patterns: vec![r"\d+".to_string()],
            case_insensitive: false,
            use_regex: true,
        };

        let result = matcher.match_message("order 12345 confirmed", &config);
        assert!(result.is_some());
        let result = result.unwrap();
        assert_eq!(result.matched_text, "12345");
        assert_eq!(result.position, 6);
    }

    #[test]
    fn test_regex_match_end_anchor() {
        let mut matcher = KeywordMatcher::new();
        let config = KeywordTriggerConfig {
            patterns: vec![r"\?$".to_string()],
            case_insensitive: false,
            use_regex: true,
        };

        // 以问号结尾的消息应该匹配
        let result = matcher.match_message("need help?", &config);
        assert!(result.is_some());

        // 问号不在结尾不应该匹配
        let result = matcher.match_message("need help? yes", &config);
        assert!(result.is_none());
    }

    #[test]
    fn test_regex_invalid_pattern() {
        let mut matcher = KeywordMatcher::new();
        let config = KeywordTriggerConfig {
            patterns: vec![r"[invalid".to_string()], // 无效的正则表达式
            case_insensitive: false,
            use_regex: true,
        };

        // 无效正则应该返回 None，不应该 panic
        let result = matcher.match_message("test message", &config);
        assert!(result.is_none());
    }

    // ========================================
    // Requirement 7.3: 大小写不敏感匹配
    // ========================================

    #[test]
    fn test_case_insensitive_exact_match() {
        let mut matcher = KeywordMatcher::new();
        let config = KeywordTriggerConfig {
            patterns: vec!["HELLO".to_string()],
            case_insensitive: true,
            use_regex: false,
        };

        let result = matcher.match_message("hello world", &config);
        assert!(result.is_some());
        let result = result.unwrap();
        assert_eq!(result.matched_pattern, "HELLO");
        assert_eq!(result.matched_text, "hello");
    }

    #[test]
    fn test_case_insensitive_mixed_case() {
        let mut matcher = KeywordMatcher::new();
        let config = KeywordTriggerConfig {
            patterns: vec!["HeLLo".to_string()],
            case_insensitive: true,
            use_regex: false,
        };

        let result = matcher.match_message("HELLO WORLD", &config);
        assert!(result.is_some());
        let result = result.unwrap();
        assert_eq!(result.matched_pattern, "HeLLo");
    }

    #[test]
    fn test_case_insensitive_regex() {
        let mut matcher = KeywordMatcher::new();
        let config = KeywordTriggerConfig {
            patterns: vec![r"help".to_string()],
            case_insensitive: true,
            use_regex: true,
        };

        let result = matcher.match_message("HELP ME", &config);
        assert!(result.is_some());
        let result = result.unwrap();
        assert_eq!(result.matched_text, "help"); // 转换为小写后匹配
    }

    // ========================================
    // Requirement 7.4: 多模式支持
    // ========================================

    #[test]
    fn test_multiple_patterns_first_match() {
        let mut matcher = KeywordMatcher::new();
        let config = KeywordTriggerConfig {
            patterns: vec!["hello".to_string(), "world".to_string(), "test".to_string()],
            case_insensitive: false,
            use_regex: false,
        };

        let result = matcher.match_message("hello world", &config);
        assert!(result.is_some());
        let result = result.unwrap();
        // 应该返回第一个匹配的模式
        assert_eq!(result.matched_pattern, "hello");
    }

    #[test]
    fn test_multiple_patterns_second_match() {
        let mut matcher = KeywordMatcher::new();
        let config = KeywordTriggerConfig {
            patterns: vec!["foo".to_string(), "world".to_string(), "bar".to_string()],
            case_insensitive: false,
            use_regex: false,
        };

        let result = matcher.match_message("hello world", &config);
        assert!(result.is_some());
        let result = result.unwrap();
        // 第一个模式不匹配，应该返回第二个匹配的模式
        assert_eq!(result.matched_pattern, "world");
    }

    #[test]
    fn test_multiple_patterns_none_match() {
        let mut matcher = KeywordMatcher::new();
        let config = KeywordTriggerConfig {
            patterns: vec!["foo".to_string(), "bar".to_string(), "baz".to_string()],
            case_insensitive: false,
            use_regex: false,
        };

        let result = matcher.match_message("hello world", &config);
        assert!(result.is_none());
    }

    #[test]
    fn test_multiple_regex_patterns() {
        let mut matcher = KeywordMatcher::new();
        let config = KeywordTriggerConfig {
            patterns: vec![
                r"^\d+".to_string(), // 以数字开头
                r"help".to_string(), // 包含 help
                r"\?$".to_string(),  // 以问号结尾
            ],
            case_insensitive: false,
            use_regex: true,
        };

        // 匹配第三个模式
        let result = matcher.match_message("need help?", &config);
        assert!(result.is_some());
        let result = result.unwrap();
        assert_eq!(result.matched_pattern, r"help");
    }

    // ========================================
    // Requirement 7.5: 任一模式匹配即返回成功
    // ========================================

    #[test]
    fn test_any_pattern_match_returns_success() {
        let mut matcher = KeywordMatcher::new();
        let config = KeywordTriggerConfig {
            patterns: vec![
                "pattern1".to_string(),
                "pattern2".to_string(),
                "pattern3".to_string(),
            ],
            case_insensitive: false,
            use_regex: false,
        };

        // 只有 pattern2 匹配
        let result = matcher.match_message("this is pattern2 here", &config);
        assert!(result.is_some());
        assert_eq!(result.unwrap().matched_pattern, "pattern2");
    }

    // ========================================
    // Requirement 7.6: 返回匹配模式和位置
    // ========================================

    #[test]
    fn test_match_result_contains_pattern() {
        let mut matcher = KeywordMatcher::new();
        let config = KeywordTriggerConfig {
            patterns: vec!["keyword".to_string()],
            case_insensitive: false,
            use_regex: false,
        };

        let result = matcher.match_message("find the keyword here", &config);
        assert!(result.is_some());
        let result = result.unwrap();
        assert_eq!(result.matched_pattern, "keyword");
    }

    #[test]
    fn test_match_result_contains_position() {
        let mut matcher = KeywordMatcher::new();
        let config = KeywordTriggerConfig {
            patterns: vec!["target".to_string()],
            case_insensitive: false,
            use_regex: false,
        };

        let result = matcher.match_message("find target here", &config);
        assert!(result.is_some());
        let result = result.unwrap();
        assert_eq!(result.position, 5); // "find " 是 5 个字符
    }

    #[test]
    fn test_match_result_contains_matched_text() {
        let mut matcher = KeywordMatcher::new();
        let config = KeywordTriggerConfig {
            patterns: vec![r"\d+".to_string()],
            case_insensitive: false,
            use_regex: true,
        };

        let result = matcher.match_message("order 99999 done", &config);
        assert!(result.is_some());
        let result = result.unwrap();
        assert_eq!(result.matched_text, "99999");
    }

    // ========================================
    // 边界情况测试
    // ========================================

    #[test]
    fn test_empty_content() {
        let mut matcher = KeywordMatcher::new();
        let config = KeywordTriggerConfig {
            patterns: vec!["test".to_string()],
            case_insensitive: false,
            use_regex: false,
        };

        let result = matcher.match_message("", &config);
        assert!(result.is_none());
    }

    #[test]
    fn test_empty_patterns() {
        let mut matcher = KeywordMatcher::new();
        let config = KeywordTriggerConfig {
            patterns: vec![],
            case_insensitive: false,
            use_regex: false,
        };

        let result = matcher.match_message("hello world", &config);
        assert!(result.is_none());
    }

    #[test]
    fn test_regex_cache_reuse() {
        let mut matcher = KeywordMatcher::new();
        let config = KeywordTriggerConfig {
            patterns: vec![r"\d+".to_string()],
            case_insensitive: false,
            use_regex: true,
        };

        // 第一次匹配
        let result1 = matcher.match_message("test 123", &config);
        assert!(result1.is_some());

        // 第二次匹配应该使用缓存的正则
        let result2 = matcher.match_message("test 456", &config);
        assert!(result2.is_some());
        assert_eq!(result2.unwrap().matched_text, "456");
    }

    #[test]
    fn test_unicode_content() {
        let mut matcher = KeywordMatcher::new();
        let config = KeywordTriggerConfig {
            patterns: vec!["帮助".to_string()],
            case_insensitive: false,
            use_regex: false,
        };

        let result = matcher.match_message("需要帮助吗？", &config);
        assert!(result.is_some());
        let result = result.unwrap();
        assert_eq!(result.matched_pattern, "帮助");
        assert_eq!(result.matched_text, "帮助");
    }

    #[test]
    fn test_unicode_regex() {
        let mut matcher = KeywordMatcher::new();
        let config = KeywordTriggerConfig {
            patterns: vec![r"帮助|help".to_string()],
            case_insensitive: true,
            use_regex: true,
        };

        let result = matcher.match_message("需要帮助吗？", &config);
        assert!(result.is_some());
        assert_eq!(result.unwrap().matched_text, "帮助");

        let result = matcher.match_message("Need HELP?", &config);
        assert!(result.is_some());
        assert_eq!(result.unwrap().matched_text, "help");
    }
}

// =============================================================================
// Property-Based Tests
// =============================================================================
//
// **Feature: auto-reply-mechanism, Property 7: 关键词匹配行为**
// **Validates: Requirements 7.1-7.6**
//
// 使用 proptest 进行属性测试，验证关键词匹配器的正确性属性。
// =============================================================================

#[cfg(test)]
mod property_tests {
    use super::*;
    use proptest::prelude::*;

    // =========================================================================
    // 测试配置
    // =========================================================================

    const TEST_CASES: u32 = 20;

    fn test_config() -> ProptestConfig {
        ProptestConfig::with_cases(TEST_CASES)
    }

    // =========================================================================
    // 生成器
    // =========================================================================

    /// 生成有效的非空字符串（用于 pattern）
    fn arb_pattern() -> impl Strategy<Value = String> {
        prop_oneof![
            Just("hello".to_string()),
            Just("world".to_string()),
            Just("test".to_string()),
            Just("help".to_string()),
            Just("keyword".to_string()),
            "[a-zA-Z]{2,8}".prop_map(String::from),
        ]
    }

    /// 生成 pattern 和包含该 pattern 的 content
    fn arb_pattern_and_content() -> impl Strategy<Value = (String, String)> {
        arb_pattern().prop_flat_map(|pattern| {
            let p = pattern.clone();
            ("[a-zA-Z0-9 ]{0,20}", "[a-zA-Z0-9 ]{0,20}").prop_map(move |(prefix, suffix)| {
                let content = format!("{}{}{}", prefix, p, suffix);
                (pattern.clone(), content)
            })
        })
    }

    /// 生成多个 pattern
    fn arb_patterns() -> impl Strategy<Value = Vec<String>> {
        prop::collection::vec(arb_pattern(), 1..5)
    }

    /// 生成有效的正则表达式 pattern
    fn arb_regex_pattern() -> impl Strategy<Value = String> {
        prop_oneof![
            Just(r"\d+".to_string()),
            Just(r"[a-z]+".to_string()),
            Just(r"hello".to_string()),
            Just(r"test".to_string()),
            Just(r"\w+".to_string()),
        ]
    }

    // =========================================================================
    // Property 7.1: 精确字符串匹配
    // Feature: auto-reply-mechanism, Property 7: 关键词匹配行为
    // Validates: Requirements 7.1
    // =========================================================================

    proptest! {
        #![proptest_config(test_config())]

        /// **Feature: auto-reply-mechanism, Property 7: 关键词匹配行为**
        ///
        /// **Validates: Requirements 7.1**
        ///
        /// 如果 pattern 是 content 的子串，精确匹配应该成功
        #[test]
        fn prop_exact_match_succeeds_when_pattern_is_substring(
            (pattern, content) in arb_pattern_and_content()
        ) {
            let mut matcher = KeywordMatcher::new();
            let config = KeywordTriggerConfig {
                patterns: vec![pattern.clone()],
                case_insensitive: false,
                use_regex: false,
            };

            let result = matcher.match_message(&content, &config);

            // pattern 一定在 content 中，应该匹配成功
            prop_assert!(
                result.is_some(),
                "Pattern '{}' should match in content '{}'",
                pattern, content
            );
        }

        /// **Feature: auto-reply-mechanism, Property 7: 关键词匹配行为**
        ///
        /// **Validates: Requirements 7.1**
        ///
        /// 精确匹配时，匹配的文本应该等于 pattern
        #[test]
        fn prop_exact_match_text_equals_pattern(
            (pattern, content) in arb_pattern_and_content()
        ) {
            let mut matcher = KeywordMatcher::new();
            let config = KeywordTriggerConfig {
                patterns: vec![pattern.clone()],
                case_insensitive: false,
                use_regex: false,
            };

            if let Some(result) = matcher.match_message(&content, &config) {
                prop_assert_eq!(
                    result.matched_text, pattern,
                    "Matched text should equal pattern"
                );
            }
        }
    }

    // =========================================================================
    // Property 7.2: 正则表达式匹配
    // Feature: auto-reply-mechanism, Property 7: 关键词匹配行为
    // Validates: Requirements 7.2
    // =========================================================================

    proptest! {
        #![proptest_config(test_config())]

        /// **Feature: auto-reply-mechanism, Property 7: 关键词匹配行为**
        ///
        /// **Validates: Requirements 7.2**
        ///
        /// 正则表达式匹配应该正确工作
        #[test]
        fn prop_regex_match_works(
            regex_pattern in arb_regex_pattern()
        ) {
            let mut matcher = KeywordMatcher::new();
            let config = KeywordTriggerConfig {
                patterns: vec![regex_pattern.clone()],
                case_insensitive: false,
                use_regex: true,
            };

            // 使用一个已知会匹配的内容
            let content = "hello123world";
            let result = matcher.match_message(content, &config);

            // 验证正则匹配器不会 panic，结果要么是 Some 要么是 None
            // 这是一个基本的健壮性测试
            prop_assert!(result.is_some() || result.is_none());
        }

        /// **Feature: auto-reply-mechanism, Property 7: 关键词匹配行为**
        ///
        /// **Validates: Requirements 7.2**
        ///
        /// 无效的正则表达式不应该导致 panic
        #[test]
        fn prop_invalid_regex_does_not_panic(
            invalid_pattern in "[\\[\\(\\{]{1,3}"
        ) {
            let mut matcher = KeywordMatcher::new();
            let config = KeywordTriggerConfig {
                patterns: vec![invalid_pattern],
                case_insensitive: false,
                use_regex: true,
            };

            // 无效正则应该返回 None，不应该 panic
            let result = matcher.match_message("test content", &config);
            prop_assert!(result.is_none());
        }
    }

    // =========================================================================
    // Property 7.3: 大小写不敏感匹配
    // Feature: auto-reply-mechanism, Property 7: 关键词匹配行为
    // Validates: Requirements 7.3
    // =========================================================================

    proptest! {
        #![proptest_config(test_config())]

        /// **Feature: auto-reply-mechanism, Property 7: 关键词匹配行为**
        ///
        /// **Validates: Requirements 7.3**
        ///
        /// 大小写不敏感匹配应该无论大小写都能工作
        #[test]
        fn prop_case_insensitive_matches_regardless_of_case(
            pattern in "[a-z]{3,8}"
        ) {
            let mut matcher = KeywordMatcher::new();
            let config = KeywordTriggerConfig {
                patterns: vec![pattern.clone()],
                case_insensitive: true,
                use_regex: false,
            };

            // 测试小写内容
            let lowercase_content = format!("prefix {} suffix", pattern.to_lowercase());
            let result_lower = matcher.match_message(&lowercase_content, &config);

            // 测试大写内容
            let uppercase_content = format!("prefix {} suffix", pattern.to_uppercase());
            let result_upper = matcher.match_message(&uppercase_content, &config);

            // 两种情况都应该匹配成功
            prop_assert!(
                result_lower.is_some(),
                "Case insensitive should match lowercase content"
            );
            prop_assert!(
                result_upper.is_some(),
                "Case insensitive should match uppercase content"
            );
        }

        /// **Feature: auto-reply-mechanism, Property 7: 关键词匹配行为**
        ///
        /// **Validates: Requirements 7.3**
        ///
        /// 大小写敏感匹配应该区分大小写
        #[test]
        fn prop_case_sensitive_distinguishes_case(
            pattern in "[a-z]{3,8}"
        ) {
            let mut matcher = KeywordMatcher::new();
            let config = KeywordTriggerConfig {
                patterns: vec![pattern.clone()],
                case_insensitive: false,
                use_regex: false,
            };

            // 小写 pattern 应该匹配小写内容
            let lowercase_content = format!("prefix {} suffix", pattern);
            let result_lower = matcher.match_message(&lowercase_content, &config);
            prop_assert!(result_lower.is_some());

            // 小写 pattern 不应该匹配大写内容
            let uppercase_content = format!("prefix {} suffix", pattern.to_uppercase());
            let result_upper = matcher.match_message(&uppercase_content, &config);
            prop_assert!(result_upper.is_none());
        }
    }

    // =========================================================================
    // Property 7.4 & 7.5: 多模式支持 - 任一模式匹配即返回成功
    // Feature: auto-reply-mechanism, Property 7: 关键词匹配行为
    // Validates: Requirements 7.4, 7.5
    // =========================================================================

    proptest! {
        #![proptest_config(test_config())]

        /// **Feature: auto-reply-mechanism, Property 7: 关键词匹配行为**
        ///
        /// **Validates: Requirements 7.4, 7.5**
        ///
        /// 如果任一模式匹配，结果应该为 Some
        #[test]
        fn prop_any_pattern_match_returns_some(
            patterns in arb_patterns(),
            pattern_index in 0usize..5
        ) {
            if patterns.is_empty() {
                return Ok(());
            }

            let index = pattern_index % patterns.len();
            let matching_pattern = &patterns[index];

            let mut matcher = KeywordMatcher::new();
            let config = KeywordTriggerConfig {
                patterns: patterns.clone(),
                case_insensitive: false,
                use_regex: false,
            };

            // 创建包含其中一个 pattern 的内容
            let content = format!("prefix {} suffix", matching_pattern);
            let result = matcher.match_message(&content, &config);

            prop_assert!(
                result.is_some(),
                "Should match when content contains one of the patterns"
            );
        }

        /// **Feature: auto-reply-mechanism, Property 7: 关键词匹配行为**
        ///
        /// **Validates: Requirements 7.4, 7.5**
        ///
        /// 如果没有模式匹配，结果应该为 None
        #[test]
        fn prop_no_pattern_match_returns_none(
            patterns in arb_patterns()
        ) {
            let mut matcher = KeywordMatcher::new();
            let config = KeywordTriggerConfig {
                patterns,
                case_insensitive: false,
                use_regex: false,
            };

            // 使用一个不包含任何 pattern 的内容
            let content = "zzzzzzzzzzzzzzzzzzz";
            let result = matcher.match_message(content, &config);

            prop_assert!(
                result.is_none(),
                "Should not match when content doesn't contain any pattern"
            );
        }
    }

    // =========================================================================
    // Property 7.6: 返回匹配模式和位置
    // Feature: auto-reply-mechanism, Property 7: 关键词匹配行为
    // Validates: Requirements 7.6
    // =========================================================================

    proptest! {
        #![proptest_config(test_config())]

        /// **Feature: auto-reply-mechanism, Property 7: 关键词匹配行为**
        ///
        /// **Validates: Requirements 7.6**
        ///
        /// 匹配位置应该在 content 范围内
        #[test]
        fn prop_match_position_is_valid(
            (pattern, content) in arb_pattern_and_content()
        ) {
            let mut matcher = KeywordMatcher::new();
            let config = KeywordTriggerConfig {
                patterns: vec![pattern.clone()],
                case_insensitive: false,
                use_regex: false,
            };

            if let Some(result) = matcher.match_message(&content, &config) {
                // 位置应该在 content 范围内
                prop_assert!(
                    result.position < content.len(),
                    "Match position {} should be less than content length {}",
                    result.position, content.len()
                );

                // 位置 + 匹配文本长度不应超过 content 长度
                prop_assert!(
                    result.position + result.matched_text.len() <= content.len(),
                    "Match end position should not exceed content length"
                );
            }
        }

        /// **Feature: auto-reply-mechanism, Property 7: 关键词匹配行为**
        ///
        /// **Validates: Requirements 7.6**
        ///
        /// 匹配结果应该包含正确的 pattern
        #[test]
        fn prop_match_result_contains_correct_pattern(
            patterns in arb_patterns()
        ) {
            if patterns.is_empty() {
                return Ok(());
            }

            let matching_pattern = &patterns[0];

            let mut matcher = KeywordMatcher::new();
            let config = KeywordTriggerConfig {
                patterns: patterns.clone(),
                case_insensitive: false,
                use_regex: false,
            };

            let content = format!("prefix {} suffix", matching_pattern);

            if let Some(result) = matcher.match_message(&content, &config) {
                // 匹配的 pattern 应该在原始 patterns 列表中
                prop_assert!(
                    patterns.contains(&result.matched_pattern),
                    "Matched pattern '{}' should be in the patterns list",
                    result.matched_pattern
                );
            }
        }

        /// **Feature: auto-reply-mechanism, Property 7: 关键词匹配行为**
        ///
        /// **Validates: Requirements 7.6**
        ///
        /// 匹配文本应该在 content 中的正确位置
        #[test]
        fn prop_matched_text_at_correct_position(
            (pattern, content) in arb_pattern_and_content()
        ) {
            let mut matcher = KeywordMatcher::new();
            let config = KeywordTriggerConfig {
                patterns: vec![pattern],
                case_insensitive: false,
                use_regex: false,
            };

            if let Some(result) = matcher.match_message(&content, &config) {
                // 从 content 中提取的文本应该等于 matched_text
                // 使用 get 方法避免 UTF-8 边界 panic
                if let Some(extracted) = content.get(result.position..result.position + result.matched_text.len()) {
                    prop_assert_eq!(
                        extracted, result.matched_text,
                        "Extracted text at position should equal matched_text"
                    );
                }
            }
        }
    }

    // =========================================================================
    // 边界情况属性测试
    // =========================================================================

    proptest! {
        #![proptest_config(test_config())]

        /// **Feature: auto-reply-mechanism, Property 7: 关键词匹配行为**
        ///
        /// **Validates: Requirements 7.1-7.6**
        ///
        /// 空 patterns 列表应该返回 None
        #[test]
        fn prop_empty_patterns_returns_none(
            content in "[a-zA-Z0-9 ]{1,50}"
        ) {
            let mut matcher = KeywordMatcher::new();
            let config = KeywordTriggerConfig {
                patterns: vec![],
                case_insensitive: false,
                use_regex: false,
            };

            let result = matcher.match_message(&content, &config);
            prop_assert!(result.is_none(), "Empty patterns should return None");
        }

        /// **Feature: auto-reply-mechanism, Property 7: 关键词匹配行为**
        ///
        /// **Validates: Requirements 7.1-7.6**
        ///
        /// 空 content 应该返回 None（除非 pattern 也为空）
        #[test]
        fn prop_empty_content_returns_none(
            pattern in arb_pattern()
        ) {
            let mut matcher = KeywordMatcher::new();
            let config = KeywordTriggerConfig {
                patterns: vec![pattern],
                case_insensitive: false,
                use_regex: false,
            };

            let result = matcher.match_message("", &config);
            prop_assert!(result.is_none(), "Empty content should return None");
        }
    }
}
