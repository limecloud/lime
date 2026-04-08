//! TDD 执行器
//!
//!
//! 提供：
//! 1. TDD 循环管理（红灯→绿灯→重构）
//! 2. 阶段转换和状态跟踪
//! 3. 测试执行和结果解析

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::types::*;

// ============================================================================
// TDD 循环状态
// ============================================================================

/// TDD 循环状态（详细版）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TddLoopState {
    pub task_id: String,
    pub phase: TddPhase,
    pub iteration: u32,
    pub max_iterations: u32,

    /// 测试规格
    pub test_spec: Option<TestSpec>,
    /// 测试代码是否已编写
    pub test_written: bool,
    /// 代码是否已编写
    pub code_written: bool,

    /// 最后一次测试结果
    pub last_test_result: Option<TestResult>,
    /// 错误信息
    pub last_error: Option<String>,

    /// 开始时间
    pub started_at: DateTime<Utc>,
    /// 各阶段耗时（毫秒）
    pub phase_durations: HashMap<String, u64>,
}

impl TddLoopState {
    /// 创建新的 TDD 循环状态
    pub fn new(task_id: String) -> Self {
        Self {
            task_id,
            phase: TddPhase::WriteTest,
            iteration: 0,
            max_iterations: 10,
            test_spec: None,
            test_written: false,
            code_written: false,
            last_test_result: None,
            last_error: None,
            started_at: Utc::now(),
            phase_durations: HashMap::new(),
        }
    }
}

// ============================================================================
// TDD 配置
// ============================================================================

/// TDD 执行器配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TddConfig {
    /// 最大迭代次数
    pub max_iterations: u32,
    /// 测试超时时间（毫秒）
    pub test_timeout: u64,
    /// 是否自动重构
    pub auto_refactor: bool,
    /// 是否在红灯阶段失败时继续
    pub continue_on_red_failure: bool,
}

impl Default for TddConfig {
    fn default() -> Self {
        Self {
            max_iterations: 10,
            test_timeout: 60000,
            auto_refactor: true,
            continue_on_red_failure: true,
        }
    }
}

// ============================================================================
// TDD 提示词模板
// ============================================================================

/// TDD 各阶段的提示词
pub struct TddPrompts;

impl TddPrompts {
    /// 编写测试阶段提示词
    pub fn write_test() -> &'static str {
        r#"你现在处于 TDD 的「编写测试」阶段。

请根据任务描述编写测试代码：
1. 测试应该覆盖主要功能和边界情况
2. 测试应该是失败的（因为还没有实现代码）
3. 使用清晰的测试描述和断言

输出格式：
```
// 测试代码
```"#
    }

    /// 运行测试（红灯）阶段提示词
    pub fn run_test_red() -> &'static str {
        r#"你现在处于 TDD 的「红灯」阶段。

请运行测试并确认测试失败：
1. 执行测试命令
2. 确认测试失败（这是预期的）
3. 记录失败信息

如果测试意外通过，说明测试可能有问题。"#
    }

    /// 编写代码阶段提示词
    pub fn write_code() -> &'static str {
        r#"你现在处于 TDD 的「编写代码」阶段。

请编写最小可行代码使测试通过：
1. 只编写让测试通过的代码
2. 不要过度设计
3. 专注于当前测试

输出格式：
### 文件：path/to/file.rs
```rust
// 代码内容
```"#
    }

    /// 运行测试（绿灯）阶段提示词
    pub fn run_test_green() -> &'static str {
        r#"你现在处于 TDD 的「绿灯」阶段。

请运行测试并确认测试通过：
1. 执行测试命令
2. 确认所有测试通过
3. 如果测试失败，返回「编写代码」阶段"#
    }

    /// 重构阶段提示词
    pub fn refactor() -> &'static str {
        r#"你现在处于 TDD 的「重构」阶段。

请在保持测试通过的前提下优化代码：
1. 消除重复代码
2. 改善命名
3. 简化逻辑
4. 提高可读性

重构后再次运行测试确认通过。"#
    }

    /// 根据阶段获取提示词
    pub fn get_prompt(phase: TddPhase) -> &'static str {
        match phase {
            TddPhase::WriteTest => Self::write_test(),
            TddPhase::RunTestRed => Self::run_test_red(),
            TddPhase::WriteCode => Self::write_code(),
            TddPhase::RunTestGreen => Self::run_test_green(),
            TddPhase::Refactor => Self::refactor(),
            TddPhase::Done => "TDD 循环已完成。",
        }
    }
}

// ============================================================================
// TDD 执行器
// ============================================================================

/// TDD 执行器
pub struct TddExecutor {
    config: TddConfig,
    /// 活跃的 TDD 循环（task_id -> state）
    active_loops: HashMap<String, TddLoopState>,
}

impl Default for TddExecutor {
    fn default() -> Self {
        Self::new(TddConfig::default())
    }
}

impl TddExecutor {
    /// 创建新的 TDD 执行器
    pub fn new(config: TddConfig) -> Self {
        Self {
            config,
            active_loops: HashMap::new(),
        }
    }

    /// 启动 TDD 循环
    pub fn start_loop(&mut self, task_id: String) -> &TddLoopState {
        let mut state = TddLoopState::new(task_id.clone());
        state.max_iterations = self.config.max_iterations;
        self.active_loops.insert(task_id.clone(), state);
        self.active_loops.get(&task_id).unwrap()
    }

    /// 检查任务是否在 TDD 循环中
    pub fn is_in_loop(&self, task_id: &str) -> bool {
        self.active_loops.contains_key(task_id)
    }

    /// 获取循环状态
    pub fn get_loop_state(&self, task_id: &str) -> Option<&TddLoopState> {
        self.active_loops.get(task_id)
    }

    /// 获取可变循环状态
    pub fn get_loop_state_mut(&mut self, task_id: &str) -> Option<&mut TddLoopState> {
        self.active_loops.get_mut(task_id)
    }

    /// 结束 TDD 循环
    pub fn end_loop(&mut self, task_id: &str) -> Option<TddLoopState> {
        self.active_loops.remove(task_id)
    }

    /// 推进到下一阶段
    pub fn advance_phase(&mut self, task_id: &str) -> Result<TddPhase, String> {
        let state = self
            .active_loops
            .get_mut(task_id)
            .ok_or_else(|| format!("任务 {} 不在 TDD 循环中", task_id))?;

        let next_phase = match state.phase {
            TddPhase::WriteTest => TddPhase::RunTestRed,
            TddPhase::RunTestRed => TddPhase::WriteCode,
            TddPhase::WriteCode => TddPhase::RunTestGreen,
            TddPhase::RunTestGreen => {
                // 检查测试是否通过
                if let Some(ref result) = state.last_test_result {
                    if result.passed {
                        TddPhase::Refactor
                    } else {
                        // 测试失败，回到编写代码阶段
                        state.iteration += 1;
                        if state.iteration >= state.max_iterations {
                            return Err(format!(
                                "任务 {} 达到最大迭代次数 {}",
                                task_id, state.max_iterations
                            ));
                        }
                        TddPhase::WriteCode
                    }
                } else {
                    TddPhase::WriteCode
                }
            }
            TddPhase::Refactor => TddPhase::Done,
            TddPhase::Done => TddPhase::Done,
        };

        state.phase = next_phase;
        Ok(next_phase)
    }

    /// 记录测试结果
    pub fn record_test_result(&mut self, task_id: &str, result: TestResult) -> Result<(), String> {
        let state = self
            .active_loops
            .get_mut(task_id)
            .ok_or_else(|| format!("任务 {} 不在 TDD 循环中", task_id))?;

        state.last_test_result = Some(result);
        Ok(())
    }

    /// 记录错误
    pub fn record_error(&mut self, task_id: &str, error: String) -> Result<(), String> {
        let state = self
            .active_loops
            .get_mut(task_id)
            .ok_or_else(|| format!("任务 {} 不在 TDD 循环中", task_id))?;

        state.last_error = Some(error);
        Ok(())
    }

    /// 设置测试规格
    pub fn set_test_spec(&mut self, task_id: &str, spec: TestSpec) -> Result<(), String> {
        let state = self
            .active_loops
            .get_mut(task_id)
            .ok_or_else(|| format!("任务 {} 不在 TDD 循环中", task_id))?;

        state.test_spec = Some(spec);
        state.test_written = true;
        Ok(())
    }

    /// 标记代码已编写
    pub fn mark_code_written(&mut self, task_id: &str) -> Result<(), String> {
        let state = self
            .active_loops
            .get_mut(task_id)
            .ok_or_else(|| format!("任务 {} 不在 TDD 循环中", task_id))?;

        state.code_written = true;
        Ok(())
    }

    /// 获取当前阶段的提示词
    pub fn get_current_prompt(&self, task_id: &str) -> Option<&'static str> {
        self.active_loops
            .get(task_id)
            .map(|state| TddPrompts::get_prompt(state.phase))
    }

    /// 检查是否可以跳过红灯阶段
    /// 如果任务已有验收测试，可以跳过编写测试阶段
    pub fn can_skip_write_test(&self, task_id: &str, has_acceptance_tests: bool) -> bool {
        if let Some(state) = self.active_loops.get(task_id) {
            state.phase == TddPhase::WriteTest && has_acceptance_tests
        } else {
            false
        }
    }

    /// 跳过编写测试阶段（当已有验收测试时）
    pub fn skip_write_test(&mut self, task_id: &str) -> Result<(), String> {
        let state = self
            .active_loops
            .get_mut(task_id)
            .ok_or_else(|| format!("任务 {} 不在 TDD 循环中", task_id))?;

        if state.phase != TddPhase::WriteTest {
            return Err("只能在 WriteTest 阶段跳过".to_string());
        }

        state.phase = TddPhase::RunTestRed;
        state.test_written = true;
        Ok(())
    }

    /// 获取所有活跃循环
    pub fn get_active_loops(&self) -> Vec<&TddLoopState> {
        self.active_loops.values().collect()
    }

    /// 获取配置
    pub fn get_config(&self) -> &TddConfig {
        &self.config
    }

    /// 更新配置
    pub fn update_config(&mut self, config: TddConfig) {
        self.config = config;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tdd_executor_creation() {
        let executor = TddExecutor::default();
        assert_eq!(executor.config.max_iterations, 10);
        assert!(executor.active_loops.is_empty());
    }

    #[test]
    fn test_start_loop() {
        let mut executor = TddExecutor::default();
        let state = executor.start_loop("task-1".to_string());

        assert_eq!(state.task_id, "task-1");
        assert_eq!(state.phase, TddPhase::WriteTest);
        assert_eq!(state.iteration, 0);
    }

    #[test]
    fn test_advance_phase() {
        let mut executor = TddExecutor::default();
        executor.start_loop("task-1".to_string());

        // WriteTest -> RunTestRed
        let phase = executor.advance_phase("task-1").unwrap();
        assert_eq!(phase, TddPhase::RunTestRed);

        // RunTestRed -> WriteCode
        let phase = executor.advance_phase("task-1").unwrap();
        assert_eq!(phase, TddPhase::WriteCode);
    }

    #[test]
    fn test_tdd_prompts() {
        assert!(!TddPrompts::write_test().is_empty());
        assert!(!TddPrompts::run_test_red().is_empty());
        assert!(!TddPrompts::write_code().is_empty());
        assert!(!TddPrompts::run_test_green().is_empty());
        assert!(!TddPrompts::refactor().is_empty());
    }
}
