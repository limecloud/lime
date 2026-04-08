//! 资源限制
//!
//! 提供进程资源限制和使用监控

use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

/// 资源使用情况
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ResourceUsage {
    /// 内存使用（字节）
    pub memory_bytes: u64,
    /// CPU 使用率 (0-100)
    pub cpu_percent: f32,
    /// 进程数
    pub process_count: u32,
    /// 打开的文件描述符数
    pub file_descriptors: u32,
    /// 执行时间（毫秒）
    pub execution_time_ms: u64,
}

/// 资源限制器
pub struct ResourceLimiter {
    /// 最大内存
    max_memory: Option<u64>,
    /// 最大 CPU
    max_cpu: Option<u32>,
    /// 最大进程数
    max_processes: Option<u32>,
    /// 最大执行时间
    max_execution_time: Option<Duration>,
    /// 最大文件描述符
    max_file_descriptors: Option<u32>,
    /// 开始时间
    start_time: Option<Instant>,
}

impl ResourceLimiter {
    /// 创建新的资源限制器
    pub fn new() -> Self {
        Self {
            max_memory: None,
            max_cpu: None,
            max_processes: None,
            max_execution_time: None,
            max_file_descriptors: None,
            start_time: None,
        }
    }

    /// 从配置创建
    pub fn from_limits(limits: &super::config::ResourceLimits) -> Self {
        Self {
            max_memory: limits.max_memory,
            max_cpu: limits.max_cpu,
            max_processes: limits.max_processes,
            max_execution_time: limits.max_execution_time.map(Duration::from_millis),
            max_file_descriptors: limits.max_file_descriptors,
            start_time: None,
        }
    }

    /// 设置最大内存
    pub fn with_max_memory(mut self, bytes: u64) -> Self {
        self.max_memory = Some(bytes);
        self
    }

    /// 设置最大 CPU
    pub fn with_max_cpu(mut self, percent: u32) -> Self {
        self.max_cpu = Some(percent);
        self
    }

    /// 设置最大进程数
    pub fn with_max_processes(mut self, count: u32) -> Self {
        self.max_processes = Some(count);
        self
    }

    /// 设置最大执行时间
    pub fn with_max_execution_time(mut self, duration: Duration) -> Self {
        self.max_execution_time = Some(duration);
        self
    }

    /// 开始计时
    pub fn start(&mut self) {
        self.start_time = Some(Instant::now());
    }

    /// 检查是否超时
    pub fn is_timeout(&self) -> bool {
        if let (Some(start), Some(max_time)) = (self.start_time, self.max_execution_time) {
            return start.elapsed() > max_time;
        }
        false
    }

    /// 检查资源使用是否超限
    pub fn check_limits(&self, usage: &ResourceUsage) -> Result<(), ResourceLimitError> {
        if let Some(max_memory) = self.max_memory {
            if usage.memory_bytes > max_memory {
                return Err(ResourceLimitError::MemoryExceeded {
                    used: usage.memory_bytes,
                    limit: max_memory,
                });
            }
        }

        if let Some(max_cpu) = self.max_cpu {
            if usage.cpu_percent > max_cpu as f32 {
                return Err(ResourceLimitError::CpuExceeded {
                    used: usage.cpu_percent,
                    limit: max_cpu as f32,
                });
            }
        }

        if let Some(max_processes) = self.max_processes {
            if usage.process_count > max_processes {
                return Err(ResourceLimitError::ProcessesExceeded {
                    used: usage.process_count,
                    limit: max_processes,
                });
            }
        }

        if let Some(max_fds) = self.max_file_descriptors {
            if usage.file_descriptors > max_fds {
                return Err(ResourceLimitError::FileDescriptorsExceeded {
                    used: usage.file_descriptors,
                    limit: max_fds,
                });
            }
        }

        if self.is_timeout() {
            return Err(ResourceLimitError::Timeout {
                elapsed: self.start_time.map(|s| s.elapsed()).unwrap_or_default(),
                limit: self.max_execution_time.unwrap_or_default(),
            });
        }

        Ok(())
    }

    /// 获取剩余执行时间
    pub fn remaining_time(&self) -> Option<Duration> {
        match (self.start_time, self.max_execution_time) {
            (Some(start), Some(max_time)) => {
                let elapsed = start.elapsed();
                if elapsed < max_time {
                    Some(max_time - elapsed)
                } else {
                    Some(Duration::ZERO)
                }
            }
            _ => None,
        }
    }
}

impl Default for ResourceLimiter {
    fn default() -> Self {
        Self::new()
    }
}

/// 资源限制错误
#[derive(Debug, Clone)]
pub enum ResourceLimitError {
    /// 内存超限
    MemoryExceeded { used: u64, limit: u64 },
    /// CPU 超限
    CpuExceeded { used: f32, limit: f32 },
    /// 进程数超限
    ProcessesExceeded { used: u32, limit: u32 },
    /// 文件描述符超限
    FileDescriptorsExceeded { used: u32, limit: u32 },
    /// 执行超时
    Timeout { elapsed: Duration, limit: Duration },
}

impl std::fmt::Display for ResourceLimitError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MemoryExceeded { used, limit } => {
                write!(f, "内存超限: 使用 {} 字节，限制 {} 字节", used, limit)
            }
            Self::CpuExceeded { used, limit } => {
                write!(f, "CPU 超限: 使用 {:.1}%，限制 {:.1}%", used, limit)
            }
            Self::ProcessesExceeded { used, limit } => {
                write!(f, "进程数超限: 使用 {}，限制 {}", used, limit)
            }
            Self::FileDescriptorsExceeded { used, limit } => {
                write!(f, "文件描述符超限: 使用 {}，限制 {}", used, limit)
            }
            Self::Timeout { elapsed, limit } => {
                write!(f, "执行超时: 已执行 {:?}，限制 {:?}", elapsed, limit)
            }
        }
    }
}

impl std::error::Error for ResourceLimitError {}

/// 构建 ulimit 参数
pub fn build_ulimit_args(limits: &super::config::ResourceLimits) -> Vec<String> {
    let mut args = Vec::new();

    if let Some(max_memory) = limits.max_memory {
        // 虚拟内存限制 (KB)
        args.push(format!("-v {}", max_memory / 1024));
    }

    if let Some(max_fds) = limits.max_file_descriptors {
        // 文件描述符限制
        args.push(format!("-n {}", max_fds));
    }

    if let Some(max_processes) = limits.max_processes {
        // 进程数限制
        args.push(format!("-u {}", max_processes));
    }

    if let Some(max_file_size) = limits.max_file_size {
        // 文件大小限制 (KB)
        args.push(format!("-f {}", max_file_size / 1024));
    }

    args
}
