//! 代码搜索模块
//!
//! 提供 ripgrep 集成的代码搜索功能

mod ripgrep;

pub use ripgrep::{
    download_vendored_rg, ensure_ripgrep_available, get_rg_path, get_ripgrep_version,
    get_system_rg_path, get_vendored_rg_path, is_ripgrep_available, list_files, search,
    search_sync, RipgrepMatch, RipgrepOptions, RipgrepResult, RG_VERSION,
};
