//! 摘要生成模块
//!
//! 为 SubAgent 结果生成精炼摘要，减少返回给父 Agent 的 token 数

use super::types::{SubAgentResult, TokenUsage};

/// 摘要生成器
pub struct SummaryGenerator {
    /// 最大摘要 token 数
    max_tokens: usize,
}

impl Default for SummaryGenerator {
    fn default() -> Self {
        Self::new(2000)
    }
}

impl SummaryGenerator {
    /// 创建摘要生成器
    pub fn new(max_tokens: usize) -> Self {
        Self { max_tokens }
    }

    /// 为单个结果生成摘要
    pub fn summarize_result(&self, result: &SubAgentResult) -> String {
        if let Some(summary) = &result.summary {
            return self.truncate_to_tokens(summary, self.max_tokens);
        }

        if let Some(output) = &result.output {
            return self.create_summary_from_output(output, result);
        }

        if let Some(error) = &result.error {
            return format!("任务 {} 失败: {}", result.task_id, error);
        }

        format!("任务 {} 完成，无输出", result.task_id)
    }

    /// 合并多个结果的摘要
    pub fn merge_summaries(&self, results: &[SubAgentResult]) -> String {
        let mut sections = Vec::new();
        let mut total_tokens = 0;
        let tokens_per_result = self.max_tokens / results.len().max(1);

        for result in results {
            let summary = self.summarize_result(result);
            let truncated = self.truncate_to_tokens(&summary, tokens_per_result);

            let section = if result.success {
                format!("✅ {}: {}", result.task_id, truncated)
            } else {
                format!("❌ {}: {}", result.task_id, truncated)
            };

            total_tokens += self.estimate_tokens(&section);
            if total_tokens > self.max_tokens {
                sections.push("... (更多结果已省略)".to_string());
                break;
            }

            sections.push(section);
        }

        // 添加统计信息
        let success_count = results.iter().filter(|r| r.success).count();
        let fail_count = results.len() - success_count;
        let total_duration: u64 = results.iter().map(|r| r.duration.as_millis() as u64).sum();

        let stats = format!(
            "\n---\n📊 统计: {} 成功, {} 失败, 总耗时 {:.2}s",
            success_count,
            fail_count,
            total_duration as f64 / 1000.0
        );

        format!("{}\n{}", sections.join("\n\n"), stats)
    }

    /// 从输出创建摘要
    fn create_summary_from_output(&self, output: &str, result: &SubAgentResult) -> String {
        let status = if result.success { "成功" } else { "失败" };
        let duration = result.duration.as_secs_f64();

        // 提取关键信息
        let key_points = self.extract_key_points(output);

        let mut summary = format!(
            "任务 {} {} (耗时 {:.2}s)\n",
            result.task_id, status, duration
        );

        if !key_points.is_empty() {
            summary.push_str("关键发现:\n");
            for point in key_points.iter().take(5) {
                summary.push_str(&format!("- {}\n", point));
            }
        }

        self.truncate_to_tokens(&summary, self.max_tokens)
    }

    /// 提取关键点
    fn extract_key_points(&self, text: &str) -> Vec<String> {
        let mut points = Vec::new();

        // 提取以特定标记开头的行
        for line in text.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("- ")
                || trimmed.starts_with("* ")
                || trimmed.starts_with("• ")
                || trimmed.starts_with("✓ ")
                || trimmed.starts_with("✅ ")
            {
                points.push(trimmed.chars().skip(2).collect());
            } else if trimmed.starts_with("1.")
                || trimmed.starts_with("2.")
                || trimmed.starts_with("3.")
            {
                if let Some(content) = trimmed.split_once('.') {
                    points.push(content.1.trim().to_string());
                }
            }
        }

        // 如果没有找到列表项，提取首尾段落
        if points.is_empty() {
            let paragraphs: Vec<&str> = text
                .split("\n\n")
                .filter(|p| !p.trim().is_empty())
                .collect();

            if let Some(first) = paragraphs.first() {
                points.push(self.truncate_text(first, 200));
            }
            if paragraphs.len() > 1 {
                if let Some(last) = paragraphs.last() {
                    points.push(self.truncate_text(last, 200));
                }
            }
        }

        points
    }

    /// 截断文本到指定字符数
    fn truncate_text(&self, text: &str, max_chars: usize) -> String {
        if text.chars().count() <= max_chars {
            text.to_string()
        } else {
            let truncated: String = text.chars().take(max_chars - 3).collect();
            format!("{}...", truncated)
        }
    }

    /// 截断到指定 token 数
    fn truncate_to_tokens(&self, text: &str, max_tokens: usize) -> String {
        let estimated = self.estimate_tokens(text);
        if estimated <= max_tokens {
            return text.to_string();
        }

        // 粗略估算：4 字符 ≈ 1 token
        let max_chars = max_tokens * 4;
        self.truncate_text(text, max_chars)
    }

    /// 估算 token 数（粗略）
    fn estimate_tokens(&self, text: &str) -> usize {
        // 简单估算：4 字符 ≈ 1 token
        text.len() / 4
    }
}

/// 计算总 token 使用量
pub fn calculate_total_token_usage(results: &[SubAgentResult]) -> TokenUsage {
    let mut total = TokenUsage::default();

    for result in results {
        if let Some(usage) = &result.token_usage {
            total.input_tokens += usage.input_tokens;
            total.output_tokens += usage.output_tokens;
            total.total_tokens += usage.total_tokens;
        }
    }

    total
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use std::collections::HashMap;
    use std::time::Duration;

    fn create_test_result(task_id: &str, success: bool, output: Option<&str>) -> SubAgentResult {
        SubAgentResult {
            task_id: task_id.to_string(),
            success,
            output: output.map(|s| s.to_string()),
            summary: None,
            error: if success {
                None
            } else {
                Some("测试错误".to_string())
            },
            duration: Duration::from_secs(1),
            retries: 0,
            started_at: Utc::now(),
            completed_at: Utc::now(),
            token_usage: Some(TokenUsage {
                input_tokens: 100,
                output_tokens: 50,
                total_tokens: 150,
            }),
            metadata: HashMap::new(),
        }
    }

    #[test]
    fn test_summarize_success_result() {
        let generator = SummaryGenerator::new(1000);
        let result = create_test_result("task-1", true, Some("任务完成"));

        let summary = generator.summarize_result(&result);
        assert!(summary.contains("task-1"));
        assert!(summary.contains("成功"));
    }

    #[test]
    fn test_summarize_failed_result() {
        let generator = SummaryGenerator::new(1000);
        let result = create_test_result("task-1", false, None);

        let summary = generator.summarize_result(&result);
        assert!(summary.contains("task-1"));
        assert!(summary.contains("失败"));
    }

    #[test]
    fn test_merge_summaries() {
        let generator = SummaryGenerator::new(2000);
        let results = vec![
            create_test_result("task-1", true, Some("结果1")),
            create_test_result("task-2", true, Some("结果2")),
            create_test_result("task-3", false, None),
        ];

        let merged = generator.merge_summaries(&results);
        assert!(merged.contains("task-1"));
        assert!(merged.contains("task-2"));
        assert!(merged.contains("task-3"));
        assert!(merged.contains("2 成功"));
        assert!(merged.contains("1 失败"));
    }

    #[test]
    fn test_extract_key_points() {
        let generator = SummaryGenerator::new(1000);
        let text = "概述\n- 发现1\n- 发现2\n* 发现3";

        let points = generator.extract_key_points(text);
        assert_eq!(points.len(), 3);
        assert!(points.contains(&"发现1".to_string()));
    }

    #[test]
    fn test_calculate_total_token_usage() {
        let results = vec![
            create_test_result("task-1", true, None),
            create_test_result("task-2", true, None),
        ];

        let total = calculate_total_token_usage(&results);
        assert_eq!(total.input_tokens, 200);
        assert_eq!(total.output_tokens, 100);
        assert_eq!(total.total_tokens, 300);
    }
}
