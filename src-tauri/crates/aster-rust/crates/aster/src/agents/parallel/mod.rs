// Parallel Agent Execution Module
//
// This module provides parallel execution capabilities:
// - Parallel agent executor with dependency management
// - Agent resource pool for worker management

mod executor;
mod pool;

#[cfg(test)]
mod executor_property_tests;

pub use executor::*;
pub use pool::*;
