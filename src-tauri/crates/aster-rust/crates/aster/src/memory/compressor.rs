//! 记忆压缩器
//!
//! 负责将多条对话摘要压缩成更精简的形式

use std::collections::HashMap;

use chrono::{DateTime, Datelike, Utc};

use super::types::{ConversationSummary, MemoryEmotion, MemoryImportance, Timestamp};

/// 压缩结果
#[derive(Debug, Clone)]
pub struct CompressionResult {
    /// 压缩后的摘要
    pub compressed_summary: String,
    /// 保留的核心话题
    pub preserved_topics: Vec<String>,
    /// 保留的重要文件
    pub preserved_files: Vec<String>,
    /// 原始消息数量
    pub original_count: usize,
    /// 时间范围
    pub time_range: (Timestamp, Timestamp),
    /// 整体情感
    pub dominant_emotion: MemoryEmotion,
    /// 重要性评分
    pub importance: MemoryImportance,
}

/// 压缩器配置
#[derive(Debug, Clone)]
pub struct CompressorConfig {
    /// 最大摘要长度（字符）
    pub max_summary_length: usize,
    /// 保留的话题数量
    pub max_topics: usize,
    /// 保留的文件数量
    pub max_files: usize,
}

impl Default for CompressorConfig {
    fn default() -> Self {
        Self {
            max_summary_length: 500,
            max_topics: 5,
            max_files: 10,
        }
    }
}

/// 记忆压缩器
pub struct MemoryCompressor {
    config: CompressorConfig,
}

impl MemoryCompressor {
    pub fn new(config: Option<CompressorConfig>) -> Self {
        Self {
            config: config.unwrap_or_default(),
        }
    }

    /// 压缩多条对话摘要为一条
    pub fn compress(&self, summaries: &[ConversationSummary]) -> Result<CompressionResult, String> {
        if summaries.is_empty() {
            return Err("Cannot compress empty summaries".to_string());
        }

        if summaries.len() == 1 {
            return Ok(self.single_to_result(&summaries[0]));
        }

        let all_topics = self.collect_topics(summaries);
        let all_files = self.collect_files(summaries);
        let time_range = self.calculate_time_range(summaries);
        let dominant_emotion = self.calculate_dominant_emotion(summaries);
        let importance = self.calculate_importance(summaries);
        let compressed_summary = self.generate_summary(summaries);

        Ok(CompressionResult {
            compressed_summary,
            preserved_topics: all_topics
                .into_iter()
                .take(self.config.max_topics)
                .collect(),
            preserved_files: all_files.into_iter().take(self.config.max_files).collect(),
            original_count: summaries.len(),
            time_range,
            dominant_emotion,
            importance,
        })
    }

    /// 判断是否应该压缩
    pub fn should_compress(&self, summaries: &[ConversationSummary], threshold: usize) -> bool {
        summaries.len() >= threshold
    }

    /// 按时间分组摘要
    pub fn group_by_period<'a>(
        &self,
        summaries: &'a [ConversationSummary],
        period: Period,
    ) -> HashMap<String, Vec<&'a ConversationSummary>> {
        let mut groups: HashMap<String, Vec<&ConversationSummary>> = HashMap::new();

        for summary in summaries {
            if let Ok(date) = DateTime::parse_from_rfc3339(&summary.start_time) {
                let key = match period {
                    Period::Day => date.format("%Y-%m-%d").to_string(),
                    Period::Week => {
                        let week_start = date.date_naive()
                            - chrono::Duration::days(date.weekday().num_days_from_sunday() as i64);
                        week_start.format("%Y-%m-%d").to_string()
                    }
                    Period::Month => date.format("%Y-%m").to_string(),
                };

                groups.entry(key).or_default().push(summary);
            }
        }

        groups
    }

    /// 评估摘要的重要性
    pub fn evaluate_importance(&self, summary: &ConversationSummary) -> MemoryImportance {
        let mut score = 0;

        if summary.emotion == MemoryEmotion::Meaningful {
            score += 2;
        }
        if summary.emotion == MemoryEmotion::Positive {
            score += 1;
        }
        if summary.topics.len() >= 3 {
            score += 1;
        }
        if summary.files_discussed.len() >= 5 {
            score += 1;
        }
        if summary.message_count >= 20 {
            score += 1;
        }

        match score {
            4.. => MemoryImportance::High,
            2..=3 => MemoryImportance::Medium,
            1 => MemoryImportance::Low,
            _ => MemoryImportance::Ephemeral,
        }
    }

    // === 私有方法 ===

    fn single_to_result(&self, summary: &ConversationSummary) -> CompressionResult {
        CompressionResult {
            compressed_summary: summary.summary.clone(),
            preserved_topics: summary.topics.clone(),
            preserved_files: summary.files_discussed.clone(),
            original_count: 1,
            time_range: (summary.start_time.clone(), summary.end_time.clone()),
            dominant_emotion: summary.emotion,
            importance: summary.importance,
        }
    }

    fn collect_topics(&self, summaries: &[ConversationSummary]) -> Vec<String> {
        let mut topic_count: HashMap<&str, usize> = HashMap::new();

        for summary in summaries {
            for topic in &summary.topics {
                *topic_count.entry(topic.as_str()).or_default() += 1;
            }
        }

        let mut topics: Vec<_> = topic_count.into_iter().collect();
        topics.sort_by(|a, b| b.1.cmp(&a.1));
        topics.into_iter().map(|(t, _)| t.to_string()).collect()
    }

    fn collect_files(&self, summaries: &[ConversationSummary]) -> Vec<String> {
        let mut file_count: HashMap<&str, usize> = HashMap::new();

        for summary in summaries {
            for file in &summary.files_discussed {
                *file_count.entry(file.as_str()).or_default() += 1;
            }
        }

        let mut files: Vec<_> = file_count.into_iter().collect();
        files.sort_by(|a, b| b.1.cmp(&a.1));
        files.into_iter().map(|(f, _)| f.to_string()).collect()
    }

    fn calculate_time_range(&self, summaries: &[ConversationSummary]) -> (Timestamp, Timestamp) {
        let times: Vec<_> = summaries
            .iter()
            .flat_map(|s| {
                vec![
                    DateTime::parse_from_rfc3339(&s.start_time).ok(),
                    DateTime::parse_from_rfc3339(&s.end_time).ok(),
                ]
            })
            .flatten()
            .collect();

        if times.is_empty() {
            let now = Utc::now().to_rfc3339();
            return (now.clone(), now);
        }

        let min = times.iter().min().unwrap();
        let max = times.iter().max().unwrap();

        (min.to_rfc3339(), max.to_rfc3339())
    }

    fn calculate_dominant_emotion(&self, summaries: &[ConversationSummary]) -> MemoryEmotion {
        let mut emotion_count: HashMap<MemoryEmotion, usize> = HashMap::new();

        for summary in summaries {
            *emotion_count.entry(summary.emotion).or_default() += 1;
        }

        emotion_count
            .into_iter()
            .max_by_key(|(_, count)| *count)
            .map(|(emotion, _)| emotion)
            .unwrap_or(MemoryEmotion::Neutral)
    }

    fn calculate_importance(&self, summaries: &[ConversationSummary]) -> MemoryImportance {
        summaries
            .iter()
            .map(|s| s.importance)
            .max()
            .unwrap_or(MemoryImportance::Medium)
    }

    fn generate_summary(&self, summaries: &[ConversationSummary]) -> String {
        let topics: Vec<_> = self.collect_topics(summaries).into_iter().take(5).collect();
        let files: Vec<_> = self.collect_files(summaries).into_iter().take(3).collect();
        let (start, end) = self.calculate_time_range(summaries);

        let mut parts = Vec::new();

        // 时间范围
        let start_date = start.get(..10).unwrap_or(&start);
        let end_date = end.get(..10).unwrap_or(&end);
        if start_date == end_date {
            parts.push(format!("{}：", start_date));
        } else {
            parts.push(format!("{} 至 {}：", start_date, end_date));
        }

        parts.push(format!("共 {} 次对话。", summaries.len()));

        if !topics.is_empty() {
            parts.push(format!("主要话题：{}。", topics.join("、")));
        }

        if !files.is_empty() {
            parts.push(format!("涉及文件：{}。", files.join("、")));
        }

        let mut result = parts.join(" ");

        if result.len() > self.config.max_summary_length {
            result.truncate(self.config.max_summary_length - 3);
            result.push_str("...");
        }

        result
    }
}

/// 时间周期
#[derive(Debug, Clone, Copy)]
pub enum Period {
    Day,
    Week,
    Month,
}

impl Default for MemoryCompressor {
    fn default() -> Self {
        Self::new(None)
    }
}
