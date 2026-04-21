//! Aster - AI Agent Framework
//!
//! This crate provides the core functionality for the Aster AI agent.

// Allow dead code for now as some code is reserved for future use
#![allow(dead_code)]

pub mod action_required_manager;
pub mod agents;
pub mod aster_apps;
pub mod auto_reply;
pub mod background;
pub mod blueprint;
pub mod checkpoint;
pub mod chrome;
pub mod chrome_mcp;
pub mod claude_plugin_cache;
pub mod codesign;
pub mod config;
pub mod context;
pub mod context_mgmt;
pub mod conversation;
pub mod core;
pub mod diagnostics;
pub mod execution;
pub mod git;
pub mod github;
pub mod heartbeat;
pub mod hints;
pub mod hooks;
pub mod logging;
pub mod lsp;
pub mod map;
pub mod mcp;
pub mod mcp_utils;
pub mod media;
pub mod memory;
pub mod model;
pub mod network;
pub mod notifications;
pub mod oauth;
pub mod observability;
pub mod parser;
pub mod permission;
pub mod plan;
pub mod plugins;
pub mod posthog;
pub mod prompt;
pub mod prompt_template;
pub mod providers;
pub mod ratelimit;
pub mod recipe;
pub mod recipe_deeplink;
pub mod rewind;
pub mod rules;
pub mod sandbox;
pub mod scheduler;
pub mod scheduler_trait;
pub mod search;
pub mod security;
pub mod session;
pub mod session_context;
pub mod skills;
pub mod slash_commands;
pub mod streaming;
pub mod subprocess;
pub mod telemetry;
pub mod teleport;
pub mod token_counter;
pub mod tool_inspection;
pub mod tool_monitor;
pub mod tools;
pub mod tracing;
pub mod updater;
pub mod user_message_manager;
pub mod utils;
