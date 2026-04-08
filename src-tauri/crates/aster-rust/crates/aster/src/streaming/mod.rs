//! Streaming Module
//!
//! Provides comprehensive streaming support including:
//! - SSE (Server-Sent Events) parsing
//! - Enhanced message stream handling with delta processing
//! - Stream JSON I/O for CLI communication
//! - Backpressure control and timeout handling
//!

pub mod message_stream;
pub mod sse;
pub mod stream_io;

// Re-exports
pub use message_stream::{
    ContentBlock, DeltaType, EnhancedMessageStream, MessageState, StreamCallbacks, StreamEventType,
    StreamOptions,
};
pub use sse::{SSEDecoder, SSEEvent, SSEStream};
pub use stream_io::{
    AnyStreamMessage, StreamJsonReader, StreamJsonWriter, StreamMessageType, StreamSession,
};
