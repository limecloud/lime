//! 菜单文本格式化模块
//!
//! 提供托盘菜单文本的格式化函数

/// 格式化请求统计文本
///
/// # 示例输出
/// - "◌ 今日调用：128 次"
pub fn format_request_count(count: u64) -> String {
    format!("◌ 今日调用：{count} 次")
}

/// 格式化当前模型文本
///
/// # 示例输出
/// - "◉ Claw 模型：Claude / claude-sonnet-4-5"
/// - "◉ Claw 模型：Claude / claude-sonnet-4-5 · 内容创作"
/// - "◉ Claw 模型：未同步"
pub fn format_current_model_status(
    provider_label: &str,
    model: &str,
    theme_label: Option<&str>,
) -> String {
    let normalized_provider = provider_label.trim();
    let normalized_model = model.trim();
    let normalized_theme = theme_label.unwrap_or("").trim();

    if normalized_provider.is_empty() || normalized_model.is_empty() {
        return "◉ Claw 模型：未同步".to_string();
    }

    if normalized_theme.is_empty() {
        return format!("◉ Claw 模型：{normalized_provider} / {normalized_model}");
    }

    format!("◉ Claw 模型：{normalized_provider} / {normalized_model} · {normalized_theme}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    proptest! {
        /// **Feature: system-tray, Property 2: 菜单内容格式化正确性**
        /// **Validates: Requirements 2.2, 2.3, 2.4**
        #[test]
        fn prop_menu_content_formatting(
            requests in 0u64..1000000
        ) {
            let req_status = format_request_count(requests);
            prop_assert!(req_status.contains(&requests.to_string()), "请求统计应包含请求次数");
        }

    }

    #[test]
    fn test_format_request_count() {
        let status = format_request_count(128);
        assert_eq!(status, "◌ 今日调用：128 次");
    }

    #[test]
    fn test_format_current_model_status_basic() {
        let status = format_current_model_status("Claude", "claude-sonnet-4-5", None);
        assert_eq!(status, "◉ Claw 模型：Claude / claude-sonnet-4-5");
    }

    #[test]
    fn test_format_current_model_status_with_theme() {
        let status = format_current_model_status("Claude", "claude-sonnet-4-5", Some("内容创作"));
        assert_eq!(status, "◉ Claw 模型：Claude / claude-sonnet-4-5 · 内容创作");
    }

    #[test]
    fn test_format_current_model_status_empty() {
        let status = format_current_model_status("", "", None);
        assert_eq!(status, "◉ Claw 模型：未同步");
    }
}
