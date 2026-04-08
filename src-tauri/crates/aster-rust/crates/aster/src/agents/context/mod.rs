// Agent Context Management Module
//
// This module provides context management for agents, including:
// - Context creation and inheritance
// - Context compression and filtering
// - Context persistence and loading
// - Context isolation and sandboxing

mod isolation;
mod manager;
mod types;

#[cfg(test)]
mod isolation_property_tests;

pub use isolation::*;
pub use manager::*;
pub use types::*;
