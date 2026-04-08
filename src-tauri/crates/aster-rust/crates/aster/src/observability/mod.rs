//! 统一可观测性模块
//!
//! 提供 Observer trait 和常用实现

mod log_observer;
mod noop_observer;
mod traits;

pub use log_observer::LogObserver;
pub use noop_observer::NoopObserver;
pub use traits::{Observer, ObserverEvent};
