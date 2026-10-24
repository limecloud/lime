use super::ConfigError;
use std::{ffi::OsString, os::windows::ffi::OsStringExt, path::PathBuf};
use windows_sys::Win32::{
    System::Com::CoTaskMemFree,
    UI::Shell::{FOLDERID_ProgramData, SHGetKnownFolderPath},
};

pub(super) fn system_requirements_path() -> Result<PathBuf, ConfigError> {
    let mut raw = std::ptr::null_mut();
    // 系统已知目录不读取用户可改的 ProgramData 环境变量。
    let result = unsafe { SHGetKnownFolderPath(&FOLDERID_ProgramData, 0, 0, &mut raw) };
    if result < 0 {
        return Err(ConfigError::ReadError(format!(
            "Cannot resolve ProgramData: {result}"
        )));
    }
    let path = unsafe {
        let mut length = 0;
        while *raw.add(length) != 0 {
            length += 1;
        }
        let path = PathBuf::from(OsString::from_wide(std::slice::from_raw_parts(raw, length)));
        CoTaskMemFree(raw.cast());
        path
    };
    Ok(path.join("Lime").join("requirements.toml"))
}
