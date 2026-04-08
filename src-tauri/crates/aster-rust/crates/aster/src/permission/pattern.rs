//! 工具名模式匹配模块
//!
//! 本模块实现了工具名的通配符模式匹配功能，支持：
//! - `*` 通配符：匹配任意数量的任意字符（包括零个）
//! - `?` 通配符：匹配单个任意字符
//!
//! Requirements: 2.1

/// 检查值是否匹配给定的模式
///
/// # Arguments
/// * `value` - 要检查的字符串值
/// * `pattern` - 包含通配符的模式字符串
///
/// # Returns
/// 如果值匹配模式则返回 `true`，否则返回 `false`
///
/// # Examples
/// ```
/// use aster::permission::pattern::match_pattern;
///
/// assert!(match_pattern("file_read", "file_*"));
/// assert!(match_pattern("file_write", "file_*"));
/// assert!(match_pattern("bash_exec", "bash_?xec"));
/// assert!(!match_pattern("other_tool", "file_*"));
/// ```
pub fn match_pattern(value: &str, pattern: &str) -> bool {
    let normalized_value = value.to_ascii_lowercase();
    let normalized_pattern = pattern.to_ascii_lowercase();
    match_pattern_recursive(normalized_value.as_bytes(), normalized_pattern.as_bytes())
}

/// 递归实现模式匹配
///
/// 使用动态规划思想的递归实现，处理 `*` 和 `?` 通配符
fn match_pattern_recursive(value: &[u8], pattern: &[u8]) -> bool {
    // 使用迭代方式避免栈溢出
    let mut v_idx = 0;
    let mut p_idx = 0;
    let mut star_idx: Option<usize> = None;
    let mut match_idx = 0;

    while v_idx < value.len() {
        if p_idx < pattern.len() && (pattern[p_idx] == b'?' || pattern[p_idx] == value[v_idx]) {
            // 当前字符匹配或模式是 '?'
            v_idx += 1;
            p_idx += 1;
        } else if p_idx < pattern.len() && pattern[p_idx] == b'*' {
            // 遇到 '*'，记录位置
            star_idx = Some(p_idx);
            match_idx = v_idx;
            p_idx += 1;
        } else if let Some(star) = star_idx {
            // 回溯到上一个 '*' 的位置
            p_idx = star + 1;
            match_idx += 1;
            v_idx = match_idx;
        } else {
            // 不匹配且没有 '*' 可以回溯
            return false;
        }
    }

    // 检查剩余的模式字符是否都是 '*'
    while p_idx < pattern.len() && pattern[p_idx] == b'*' {
        p_idx += 1;
    }

    p_idx == pattern.len()
}

/// 检查模式是否包含通配符
///
/// # Arguments
/// * `pattern` - 要检查的模式字符串
///
/// # Returns
/// 如果模式包含 `*` 或 `?` 通配符则返回 `true`
pub fn has_wildcards(pattern: &str) -> bool {
    pattern.contains('*') || pattern.contains('?')
}

/// 将模式转换为正则表达式字符串
///
/// # Arguments
/// * `pattern` - 通配符模式
///
/// # Returns
/// 等效的正则表达式字符串
pub fn pattern_to_regex(pattern: &str) -> String {
    let mut regex = String::with_capacity(pattern.len() * 2);
    regex.push('^');

    for ch in pattern.chars() {
        match ch {
            '*' => regex.push_str(".*"),
            '?' => regex.push('.'),
            // 转义正则表达式特殊字符
            '.' | '+' | '^' | '$' | '(' | ')' | '[' | ']' | '{' | '}' | '|' | '\\' => {
                regex.push('\\');
                regex.push(ch);
            }
            _ => regex.push(ch),
        }
    }

    regex.push('$');
    regex
}

#[cfg(test)]
mod tests {
    use super::*;

    // 基本匹配测试
    #[test]
    fn test_exact_match() {
        assert!(match_pattern("file_read", "file_read"));
        assert!(match_pattern("bash_exec", "bash_exec"));
        assert!(match_pattern("", ""));
    }

    #[test]
    fn test_exact_no_match() {
        assert!(!match_pattern("file_read", "file_write"));
        assert!(!match_pattern("bash", "bash_exec"));
    }

    // 星号通配符测试
    #[test]
    fn test_star_at_end() {
        assert!(match_pattern("file_read", "file_*"));
        assert!(match_pattern("file_write", "file_*"));
        assert!(match_pattern("file_", "file_*"));
        assert!(match_pattern("file_read_all", "file_*"));
    }

    #[test]
    fn test_star_at_start() {
        assert!(match_pattern("read_file", "*_file"));
        assert!(match_pattern("write_file", "*_file"));
        assert!(match_pattern("_file", "*_file"));
    }

    #[test]
    fn test_star_in_middle() {
        assert!(match_pattern("file_read_all", "file_*_all"));
        assert!(match_pattern("file__all", "file_*_all"));
        assert!(match_pattern("file_xyz_all", "file_*_all"));
    }

    #[test]
    fn test_multiple_stars() {
        assert!(match_pattern("file_read_write", "*_*_*"));
        assert!(match_pattern("a_b_c", "*_*_*"));
        assert!(match_pattern("__", "*_*_*"));
    }

    #[test]
    fn test_star_matches_empty() {
        assert!(match_pattern("file", "file*"));
        assert!(match_pattern("file", "*file"));
        assert!(match_pattern("file", "*file*"));
    }

    #[test]
    fn test_only_star() {
        assert!(match_pattern("anything", "*"));
        assert!(match_pattern("", "*"));
        assert!(match_pattern("file_read_write_delete", "*"));
    }

    // 问号通配符测试
    #[test]
    fn test_question_mark() {
        assert!(match_pattern("file_read", "file_rea?"));
        assert!(match_pattern("file_reax", "file_rea?"));
        assert!(!match_pattern("file_re", "file_rea?"));
        assert!(!match_pattern("file_read_", "file_rea?"));
    }

    #[test]
    fn test_multiple_question_marks() {
        assert!(match_pattern("abc", "???"));
        assert!(!match_pattern("ab", "???"));
        assert!(!match_pattern("abcd", "???"));
    }

    #[test]
    fn test_question_mark_in_middle() {
        assert!(match_pattern("file_read", "file_?ead"));
        assert!(match_pattern("file_xead", "file_?ead"));
    }

    // 混合通配符测试
    #[test]
    fn test_mixed_wildcards() {
        assert!(match_pattern("file_read", "f*_?ead"));
        assert!(match_pattern("file_xead", "f*_?ead"));
        assert!(match_pattern("f_read", "f*_?ead"));
    }

    #[test]
    fn test_star_and_question() {
        assert!(match_pattern("bash_exec", "bash_*?"));
        assert!(match_pattern("bash_e", "bash_*?"));
        assert!(!match_pattern("bash_", "bash_*?"));
    }

    // 边界情况测试
    #[test]
    fn test_empty_pattern() {
        assert!(match_pattern("", ""));
        assert!(!match_pattern("a", ""));
    }

    #[test]
    fn test_empty_value() {
        assert!(match_pattern("", "*"));
        assert!(!match_pattern("", "?"));
        assert!(!match_pattern("", "a"));
    }

    #[test]
    fn test_special_characters() {
        assert!(match_pattern("file.txt", "file.txt"));
        assert!(match_pattern("file.txt", "file.*"));
        assert!(match_pattern("file.txt", "*.txt"));
    }

    // has_wildcards 测试
    #[test]
    fn test_has_wildcards() {
        assert!(has_wildcards("file_*"));
        assert!(has_wildcards("file_?"));
        assert!(has_wildcards("*"));
        assert!(has_wildcards("?"));
        assert!(has_wildcards("file_*_?"));
        assert!(!has_wildcards("file_read"));
        assert!(!has_wildcards(""));
    }

    // pattern_to_regex 测试
    #[test]
    fn test_pattern_to_regex() {
        assert_eq!(pattern_to_regex("file_*"), "^file_.*$");
        assert_eq!(pattern_to_regex("file_?"), "^file_.$");
        assert_eq!(pattern_to_regex("file.txt"), "^file\\.txt$");
        assert_eq!(pattern_to_regex("*"), "^.*$");
        assert_eq!(pattern_to_regex("?"), "^.$");
    }

    // 实际工具名匹配场景测试
    #[test]
    fn test_tool_name_patterns() {
        // 文件操作工具
        assert!(match_pattern("file_read", "file_*"));
        assert!(match_pattern("file_write", "file_*"));
        assert!(match_pattern("file_delete", "file_*"));
        assert!(match_pattern("file_list", "file_*"));

        // Bash 工具
        assert!(match_pattern("bash_exec", "bash_*"));
        assert!(match_pattern("bash_run", "bash_*"));

        // 不匹配的情况
        assert!(!match_pattern("http_get", "file_*"));
        assert!(!match_pattern("database_query", "bash_*"));
    }

    #[test]
    fn test_complex_patterns() {
        // 匹配所有以 _read 结尾的工具
        assert!(match_pattern("file_read", "*_read"));
        assert!(match_pattern("database_read", "*_read"));
        assert!(!match_pattern("file_write", "*_read"));

        // 匹配特定前缀和后缀
        assert!(match_pattern("file_read_async", "file_*_async"));
        assert!(match_pattern("file_write_async", "file_*_async"));
        assert!(!match_pattern("file_read_sync", "file_*_async"));
    }
}

/// Property-based tests for tool name pattern matching
///
/// **Feature: tool-permission-system, Property 4: Tool Name Pattern Matching**
/// **Validates: Requirements 2.1**
#[cfg(test)]
mod property_tests {
    use super::*;
    use proptest::prelude::*;

    /// 生成有效的工具名（字母数字和下划线）
    fn tool_name_strategy() -> impl Strategy<Value = String> {
        "[a-z][a-z0-9_]{0,20}".prop_map(|s| s)
    }

    /// 生成简单的模式（带有可选的通配符）
    fn simple_pattern_strategy() -> impl Strategy<Value = String> {
        prop_oneof![
            // 精确匹配模式
            tool_name_strategy(),
            // 以 * 结尾的模式
            tool_name_strategy().prop_map(|s| format!("{}*", s)),
            // 以 * 开头的模式
            tool_name_strategy().prop_map(|s| format!("*{}", s)),
            // 只有 *
            Just("*".to_string()),
            // 带 ? 的模式
            tool_name_strategy().prop_map(|s| {
                if s.len() > 1 {
                    let prefix: String = s.chars().take(s.len() - 1).collect();
                    format!("{}?", prefix)
                } else {
                    format!("{}?", s)
                }
            }),
        ]
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        /// Property: 精确匹配 - 任何字符串都应该匹配自身
        ///
        /// **Feature: tool-permission-system, Property 4: Tool Name Pattern Matching**
        /// **Validates: Requirements 2.1**
        #[test]
        fn prop_exact_match_self(value in tool_name_strategy()) {
            prop_assert!(
                match_pattern(&value, &value),
                "Value '{}' should match itself as pattern",
                value
            );
        }

        /// Property: 星号通配符匹配所有 - "*" 模式应该匹配任何字符串
        ///
        /// **Feature: tool-permission-system, Property 4: Tool Name Pattern Matching**
        /// **Validates: Requirements 2.1**
        #[test]
        fn prop_star_matches_all(value in tool_name_strategy()) {
            prop_assert!(
                match_pattern(&value, "*"),
                "Pattern '*' should match any value, but failed for '{}'",
                value
            );
        }

        /// Property: 前缀匹配 - "prefix*" 应该匹配所有以 prefix 开头的字符串
        ///
        /// **Feature: tool-permission-system, Property 4: Tool Name Pattern Matching**
        /// **Validates: Requirements 2.1**
        #[test]
        fn prop_prefix_match(
            prefix in "[a-z]{1,5}",
            suffix in "[a-z0-9_]{0,10}"
        ) {
            let value = format!("{}{}", prefix, suffix);
            let pattern = format!("{}*", prefix);
            prop_assert!(
                match_pattern(&value, &pattern),
                "Value '{}' should match pattern '{}'",
                value, pattern
            );
        }

        /// Property: 后缀匹配 - "*suffix" 应该匹配所有以 suffix 结尾的字符串
        ///
        /// **Feature: tool-permission-system, Property 4: Tool Name Pattern Matching**
        /// **Validates: Requirements 2.1**
        #[test]
        fn prop_suffix_match(
            prefix in "[a-z0-9_]{0,10}",
            suffix in "[a-z]{1,5}"
        ) {
            let value = format!("{}{}", prefix, suffix);
            let pattern = format!("*{}", suffix);
            prop_assert!(
                match_pattern(&value, &pattern),
                "Value '{}' should match pattern '{}'",
                value, pattern
            );
        }

        /// Property: 问号匹配单个字符 - "?" 应该只匹配单个字符
        ///
        /// **Feature: tool-permission-system, Property 4: Tool Name Pattern Matching**
        /// **Validates: Requirements 2.1**
        #[test]
        fn prop_question_mark_single_char(ch in "[a-z]") {
            prop_assert!(
                match_pattern(&ch, "?"),
                "Pattern '?' should match single char '{}'",
                ch
            );
        }

        /// Property: 问号不匹配空字符串
        ///
        /// **Feature: tool-permission-system, Property 4: Tool Name Pattern Matching**
        /// **Validates: Requirements 2.1**
        #[test]
        fn prop_question_mark_not_empty(_dummy in Just(())) {
            prop_assert!(
                !match_pattern("", "?"),
                "Pattern '?' should not match empty string"
            );
        }

        /// Property: 问号不匹配多个字符
        ///
        /// **Feature: tool-permission-system, Property 4: Tool Name Pattern Matching**
        /// **Validates: Requirements 2.1**
        #[test]
        fn prop_question_mark_not_multiple(value in "[a-z]{2,5}") {
            prop_assert!(
                !match_pattern(&value, "?"),
                "Pattern '?' should not match multi-char string '{}'",
                value
            );
        }

        /// Property: 前缀不匹配 - 不以 prefix 开头的字符串不应匹配 "prefix*"
        ///
        /// **Feature: tool-permission-system, Property 4: Tool Name Pattern Matching**
        /// **Validates: Requirements 2.1**
        #[test]
        fn prop_prefix_no_match(
            prefix in "[a-m]{2,4}",
            other_prefix in "[n-z]{2,4}",
            suffix in "[a-z0-9_]{0,5}"
        ) {
            let value = format!("{}{}", other_prefix, suffix);
            let pattern = format!("{}*", prefix);
            // 只有当 other_prefix 确实不以 prefix 开头时才测试
            if !value.starts_with(&prefix) {
                prop_assert!(
                    !match_pattern(&value, &pattern),
                    "Value '{}' should not match pattern '{}'",
                    value, pattern
                );
            }
        }

        /// Property: 空模式只匹配空字符串
        ///
        /// **Feature: tool-permission-system, Property 4: Tool Name Pattern Matching**
        /// **Validates: Requirements 2.1**
        #[test]
        fn prop_empty_pattern_only_empty(value in "[a-z]{1,10}") {
            prop_assert!(
                !match_pattern(&value, ""),
                "Empty pattern should not match non-empty value '{}'",
                value
            );
        }

        /// Property: 空字符串匹配空模式
        ///
        /// **Feature: tool-permission-system, Property 4: Tool Name Pattern Matching**
        /// **Validates: Requirements 2.1**
        #[test]
        fn prop_empty_matches_empty(_dummy in Just(())) {
            prop_assert!(
                match_pattern("", ""),
                "Empty string should match empty pattern"
            );
        }

        /// Property: 中间通配符匹配 - "prefix*suffix" 应该匹配以 prefix 开头且以 suffix 结尾的字符串
        ///
        /// **Feature: tool-permission-system, Property 4: Tool Name Pattern Matching**
        /// **Validates: Requirements 2.1**
        #[test]
        fn prop_middle_star_match(
            prefix in "[a-z]{1,3}",
            middle in "[a-z0-9_]{0,5}",
            suffix in "[a-z]{1,3}"
        ) {
            let value = format!("{}{}{}", prefix, middle, suffix);
            let pattern = format!("{}*{}", prefix, suffix);
            prop_assert!(
                match_pattern(&value, &pattern),
                "Value '{}' should match pattern '{}'",
                value, pattern
            );
        }

        /// Property: has_wildcards 正确检测通配符
        ///
        /// **Feature: tool-permission-system, Property 4: Tool Name Pattern Matching**
        /// **Validates: Requirements 2.1**
        #[test]
        fn prop_has_wildcards_detection(pattern in simple_pattern_strategy()) {
            let expected = pattern.contains('*') || pattern.contains('?');
            prop_assert_eq!(
                has_wildcards(&pattern),
                expected,
                "has_wildcards('{}') should be {}",
                pattern, expected
            );
        }

        /// Property: 无通配符的模式等同于精确匹配
        ///
        /// **Feature: tool-permission-system, Property 4: Tool Name Pattern Matching**
        /// **Validates: Requirements 2.1**
        #[test]
        fn prop_no_wildcard_exact_match(
            value in tool_name_strategy(),
            pattern in tool_name_strategy()
        ) {
            // 无通配符时，匹配等同于字符串相等
            if !has_wildcards(&pattern) {
                prop_assert_eq!(
                    match_pattern(&value, &pattern),
                    value == pattern,
                    "Without wildcards, match_pattern('{}', '{}') should equal string equality",
                    value, pattern
                );
            }
        }
    }
}
