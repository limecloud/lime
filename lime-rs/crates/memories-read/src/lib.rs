//! Read-path helpers for Lime memories.
//!
//! This crate owns memory injection, memory citation parsing, and telemetry
//! classification for read access to the memory folder. It intentionally does
//! not depend on the memory write pipeline.

pub mod citations;
mod metrics;
pub mod usage;

use lime_utils_absolute_path::AbsolutePathBuf;

pub fn memory_root(lime_home: &AbsolutePathBuf) -> AbsolutePathBuf {
    lime_home.join("memories")
}
