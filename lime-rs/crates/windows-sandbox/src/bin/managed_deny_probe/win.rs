use std::ffi::c_void;
use std::io::Write as _;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use std::path::PathBuf;

#[link(name = "kernel32")]
unsafe extern "system" {
    #[link_name = "LoadLibraryW"]
    fn load_library_w(file_name: *const u16) -> *mut c_void;
    #[link_name = "FreeLibrary"]
    fn free_library(module: *mut c_void) -> i32;
}

fn load_library(path: &Path) -> std::io::Result<()> {
    let wide_path: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    // SAFETY: `wide_path` is NUL-terminated and remains alive for the call.
    let module = unsafe { load_library_w(wide_path.as_ptr()) };
    if module.is_null() {
        return Err(std::io::Error::last_os_error());
    }
    // SAFETY: `module` is a non-null handle returned by `LoadLibraryW` above.
    if unsafe { free_library(module) } == 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

fn access_was_denied(err: &std::io::Error) -> bool {
    err.kind() == std::io::ErrorKind::PermissionDenied || err.raw_os_error() == Some(5)
}

fn probe_path(key: &str) -> PathBuf {
    let Some(value) = std::env::var_os(key) else {
        eprintln!("managed deny probe is missing {key}");
        probe_exit(/*code*/ 21);
    };
    PathBuf::from(value)
}

fn probe_exit(code: i32) -> ! {
    let _ = std::io::stdout().flush();
    let _ = std::io::stderr().flush();
    std::process::exit(code);
}

pub(super) fn main() {
    let allowed_text = probe_path("LIME_WINDOWS_ALLOWED_TEXT");
    let denied_text = probe_path("LIME_WINDOWS_DENIED_TEXT");
    let allowed_module = probe_path("LIME_WINDOWS_ALLOWED_MODULE");
    let denied_module = probe_path("LIME_WINDOWS_DENIED_MODULE");

    match std::fs::read_to_string(&allowed_text) {
        Ok(contents) if contents.trim() == "ALLOW-CONTROL" => println!("allowed-read:OK"),
        Ok(_) => {
            eprintln!("allowed read returned unexpected contents");
            probe_exit(/*code*/ 21);
        }
        Err(err) => {
            eprintln!("allowed read failed: {err}");
            probe_exit(/*code*/ 21);
        }
    }
    if let Err(err) = load_library(&allowed_module) {
        eprintln!("allowed import failed: {err}");
        probe_exit(/*code*/ 21);
    }
    println!("allowed-import:OK");

    let mut failures = 0;
    match std::fs::read(&denied_text) {
        Ok(_) => {
            println!("denied-read:UNEXPECTED_SUCCESS");
            failures += 1;
        }
        Err(err) if access_was_denied(&err) => println!("denied-read:DENIED"),
        Err(err) => {
            eprintln!("denied read failed for a non-access reason: {err}");
            probe_exit(/*code*/ 21);
        }
    }
    match load_library(&denied_module) {
        Ok(()) => {
            println!("denied-import:UNEXPECTED_SUCCESS");
            failures += 1;
        }
        Err(err) if access_was_denied(&err) => println!("denied-import:DENIED"),
        Err(err) => {
            eprintln!("denied import failed for a non-access reason: {err}");
            probe_exit(/*code*/ 21);
        }
    }

    if failures != 0 {
        probe_exit(/*code*/ 20);
    }
}
