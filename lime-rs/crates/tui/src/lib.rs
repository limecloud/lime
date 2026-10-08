mod app;
mod app_backtrack;
mod app_event;
mod app_event_sender;
mod app_server_session;
mod bottom_pane;
mod chatwidget;
mod clipboard_copy;
mod clipboard_paste;
mod collaboration_modes;
#[allow(dead_code)]
mod cwd_prompt;
mod diff_render;
mod entry;
#[allow(dead_code, unused_imports)]
mod exec_cell;
mod external_editor;
mod footer_hint;
mod fuzzy_match;
#[allow(dead_code, unused_imports)]
mod history_cell;
mod history_filter;
#[allow(dead_code)]
mod insert_history;
mod key_hint;
mod keymap;
mod line_truncation;
mod live_wrap;
mod local_settings;
mod locale;
mod markdown;
mod markdown_render;
mod mention_codec;
mod model_catalog;
mod model_picker;
mod multi_agents;
mod pager_overlay;
mod projection;
#[allow(dead_code)]
mod render;
mod resume_picker;
mod runtime;
#[allow(dead_code)]
mod selection_list;
mod session_resume;
mod settings;
mod slash_command;
mod status;
// Shared shortcut layout owner used by the shortcut overlay and Agent Center.
mod shortcut_help;
#[allow(dead_code)]
mod status_indicator_widget;
mod style;
mod table_detect;
mod terminal_hyperlinks;
mod terminal_palette;
mod terminal_probe;
mod terminal_title;
mod text_formatting;
mod text_selection;
mod thread_transcript;
#[allow(dead_code)]
mod transcript_reflow;
mod transcript_view;
mod tui;
mod view;
mod viewport;
mod vim_search;
mod width;
mod wrapping;

pub use insert_history::{insert_history_lines, HistoryLineWrapPolicy, HistoryTerminal};
pub use live_wrap::RowBuilder;
pub type Terminal<B> = ratatui::Terminal<B>;
pub use runtime::{run_exec, run_resume, run_tui, ExecOptions, ExecResult, TuiOptions};
