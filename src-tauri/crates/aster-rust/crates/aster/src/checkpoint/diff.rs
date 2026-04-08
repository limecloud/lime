//! Diff 引擎
//!
//! 计算和应用文件差异

use serde::{Deserialize, Serialize};

/// Diff 操作类型
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DiffOp {
    #[serde(rename = "add")]
    Add,
    #[serde(rename = "del")]
    Del,
    #[serde(rename = "eq")]
    Eq,
}

/// Diff 条目
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffEntry {
    pub op: DiffOp,
    pub line: String,
    pub num: usize,
}

/// Diff 引擎
pub struct DiffEngine;

impl DiffEngine {
    /// 创建新的 Diff 引擎
    pub fn new() -> Self {
        Self
    }

    /// 计算两个字符串之间的 diff
    pub fn calculate_diff(&self, old_content: &str, new_content: &str) -> String {
        let old_lines: Vec<&str> = old_content.lines().collect();
        let new_lines: Vec<&str> = new_content.lines().collect();

        let lcs = self.longest_common_subsequence(&old_lines, &new_lines);
        let mut diff: Vec<DiffEntry> = Vec::new();

        let mut old_idx = 0;
        let mut new_idx = 0;
        let mut lcs_idx = 0;

        while old_idx < old_lines.len() || new_idx < new_lines.len() {
            if lcs_idx < lcs.len() {
                // 找到下一个公共行
                while old_idx < old_lines.len() && old_lines[old_idx] != lcs[lcs_idx] {
                    diff.push(DiffEntry {
                        op: DiffOp::Del,
                        line: old_lines[old_idx].to_string(),
                        num: old_idx,
                    });
                    old_idx += 1;
                }
                while new_idx < new_lines.len() && new_lines[new_idx] != lcs[lcs_idx] {
                    diff.push(DiffEntry {
                        op: DiffOp::Add,
                        line: new_lines[new_idx].to_string(),
                        num: new_idx,
                    });
                    new_idx += 1;
                }
                if old_idx < old_lines.len() && new_idx < new_lines.len() {
                    diff.push(DiffEntry {
                        op: DiffOp::Eq,
                        line: old_lines[old_idx].to_string(),
                        num: old_idx,
                    });
                    old_idx += 1;
                    new_idx += 1;
                    lcs_idx += 1;
                }
            } else {
                // 剩余行
                while old_idx < old_lines.len() {
                    diff.push(DiffEntry {
                        op: DiffOp::Del,
                        line: old_lines[old_idx].to_string(),
                        num: old_idx,
                    });
                    old_idx += 1;
                }
                while new_idx < new_lines.len() {
                    diff.push(DiffEntry {
                        op: DiffOp::Add,
                        line: new_lines[new_idx].to_string(),
                        num: new_idx,
                    });
                    new_idx += 1;
                }
            }
        }

        serde_json::to_string(&diff).unwrap_or_default()
    }

    /// 应用 diff 到内容
    pub fn apply_diff(&self, old_content: &str, diff_str: &str) -> String {
        let diff: Vec<DiffEntry> = match serde_json::from_str(diff_str) {
            Ok(d) => d,
            Err(_) => return old_content.to_string(),
        };

        let mut result: Vec<String> = Vec::new();

        for entry in diff {
            match entry.op {
                DiffOp::Add | DiffOp::Eq => {
                    result.push(entry.line);
                }
                DiffOp::Del => {
                    // 删除的行不添加到结果
                }
            }
        }

        result.join("\n")
    }

    /// 最长公共子序列算法
    fn longest_common_subsequence<'a>(&self, arr1: &[&'a str], arr2: &[&'a str]) -> Vec<&'a str> {
        let m = arr1.len();
        let n = arr2.len();
        let mut dp: Vec<Vec<usize>> = vec![vec![0; n + 1]; m + 1];

        for i in 1..=m {
            for j in 1..=n {
                if arr1[i - 1] == arr2[j - 1] {
                    dp[i][j] = dp[i - 1][j - 1] + 1;
                } else {
                    dp[i][j] = dp[i - 1][j].max(dp[i][j - 1]);
                }
            }
        }

        // 回溯找到 LCS
        let mut lcs: Vec<&'a str> = Vec::new();
        let mut i = m;
        let mut j = n;

        while i > 0 && j > 0 {
            if arr1[i - 1] == arr2[j - 1] {
                lcs.push(arr1[i - 1]);
                i -= 1;
                j -= 1;
            } else if dp[i - 1][j] > dp[i][j - 1] {
                i -= 1;
            } else {
                j -= 1;
            }
        }

        lcs.reverse();
        lcs
    }
}

impl Default for DiffEngine {
    fn default() -> Self {
        Self::new()
    }
}
