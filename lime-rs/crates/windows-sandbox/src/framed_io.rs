//! Shared length-prefixed JSON framing for independent Windows sandbox IPC protocols.

use anyhow::Result;
use serde::Serialize;
use serde::de::DeserializeOwned;
use std::fs::File;
use std::io;
use std::io::Read;
use std::io::Write;
use std::os::windows::io::AsRawHandle;
use std::ptr;
use std::time::Duration;
use std::time::Instant;
use windows_sys::Win32::System::Pipes::PeekNamedPipe;

/// Bound the memory used by an individual untrusted IPC frame.
const MAX_FRAME_LEN: usize = 8 * 1024 * 1024;
const FRAME_POLL_INTERVAL: Duration = Duration::from_millis(5);

pub(crate) fn write_frame<W: Write, T: Serialize>(mut writer: W, message: &T) -> Result<()> {
    let payload = serde_json::to_vec(message)?;
    if payload.len() > MAX_FRAME_LEN {
        anyhow::bail!("frame too large: {}", payload.len());
    }
    let len = payload.len() as u32;
    writer.write_all(&len.to_le_bytes())?;
    writer.write_all(&payload)?;
    writer.flush()?;
    Ok(())
}

pub(crate) fn read_frame<R: Read, T: DeserializeOwned>(mut reader: R) -> Result<Option<T>> {
    let mut len_buf = [0u8; 4];
    match reader.read_exact(&mut len_buf) {
        Ok(()) => {}
        Err(err) if err.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(err) => return Err(err.into()),
    }
    let len = u32::from_le_bytes(len_buf) as usize;
    if len > MAX_FRAME_LEN {
        anyhow::bail!("frame too large: {len}");
    }
    let mut payload = vec![0u8; len];
    reader.read_exact(&mut payload)?;
    let message = serde_json::from_slice(&payload)?;
    Ok(Some(message))
}

pub(crate) fn wait_for_complete_frame(pipe: &File, deadline: Instant) -> io::Result<()> {
    let mut len_buf = [0_u8; 4];

    loop {
        let mut bytes_read = 0_u32;
        let mut total_available = 0_u32;
        let ok = unsafe {
            PeekNamedPipe(
                pipe.as_raw_handle() as _,
                len_buf.as_mut_ptr().cast(),
                len_buf.len() as u32,
                &mut bytes_read,
                &mut total_available,
                ptr::null_mut(),
            )
        };
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }

        if bytes_read == len_buf.len() as u32 {
            let frame_len = u32::from_le_bytes(len_buf) as usize;
            if frame_len > MAX_FRAME_LEN {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!("frame too large: {frame_len}"),
                ));
            }
            if total_available as usize >= len_buf.len() + frame_len {
                return Ok(());
            }
        }

        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "timed out waiting for a complete IPC frame",
            ));
        }
        std::thread::sleep(remaining.min(FRAME_POLL_INTERVAL));
    }
}
