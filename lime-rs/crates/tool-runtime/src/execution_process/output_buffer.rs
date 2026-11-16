use std::collections::VecDeque;

use super::ExecutionOutputKind;

/// Bounded process output that preserves the first and last bytes.
///
/// Keeping both ends matches the unified exec contract: command headers and
/// final diagnostics remain available while the middle is explicitly counted
/// as omitted. The buffer stores bytes only and never grows with process
/// output after the configured retention limit is reached.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BoundedProcessOutput {
    retain_bytes: usize,
    head: Vec<u8>,
    tail: VecDeque<u8>,
    bytes: u64,
    omitted_bytes: u64,
}

impl Default for BoundedProcessOutput {
    fn default() -> Self {
        Self::new(super::DEFAULT_OUTPUT_RETAIN_BYTES)
    }
}

impl BoundedProcessOutput {
    pub fn new(retain_bytes: usize) -> Self {
        Self {
            retain_bytes,
            head: Vec::new(),
            tail: VecDeque::new(),
            bytes: 0,
            omitted_bytes: 0,
        }
    }

    /// Append raw output while retaining only the configured head/tail window.
    pub fn push(&mut self, bytes: &[u8]) {
        self.bytes = self.bytes.saturating_add(bytes.len() as u64);
        let remaining_head = self.head_budget().saturating_sub(self.head.len());
        let (head, tail) = bytes
            .split_at_checked(remaining_head)
            .unwrap_or((bytes, &[]));
        self.head.extend_from_slice(head);
        self.push_tail(tail);
    }

    pub fn snapshot(&self) -> BoundedProcessOutputSnapshot {
        let retained_bytes = self.head.len().saturating_add(self.tail.len());
        let marker = (self.omitted_bytes > 0)
            .then(|| format!("... {} bytes omitted ...", self.omitted_bytes));
        let marker_bytes = marker
            .as_ref()
            .map(|marker| marker.len().saturating_add(2))
            .unwrap_or_default();
        let mut retained = Vec::with_capacity(retained_bytes.saturating_add(marker_bytes));
        retained.extend_from_slice(&self.head);
        if let Some(marker) = marker {
            retained.push(b'\n');
            retained.extend_from_slice(marker.as_bytes());
            retained.push(b'\n');
        }
        retained.extend(self.tail.iter().copied());
        BoundedProcessOutputSnapshot {
            bytes: self.bytes,
            omitted_bytes: self.omitted_bytes,
            truncated: self.omitted_bytes > 0,
            text: String::from_utf8_lossy(&retained).into_owned(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.bytes == 0
    }

    fn head_budget(&self) -> usize {
        self.retain_bytes / 2
    }

    fn tail_budget(&self) -> usize {
        self.retain_bytes.saturating_sub(self.head_budget())
    }

    fn push_tail(&mut self, bytes: &[u8]) {
        let remaining_tail = self.tail_budget().saturating_sub(self.tail.len());
        let excess = bytes.len().saturating_sub(remaining_tail);
        self.omitted_bytes = self.omitted_bytes.saturating_add(excess as u64);

        // Drop old tail bytes before skipping incoming bytes. This keeps the
        // newest suffix when one chunk is larger than the entire tail budget.
        let bytes = match excess.checked_sub(self.tail.len()) {
            None => {
                self.tail.drain(..excess);
                bytes
            }
            Some(skip) => {
                self.tail.clear();
                &bytes[skip..]
            }
        };
        self.tail.extend(bytes);
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BoundedProcessOutputSnapshot {
    pub bytes: u64,
    pub omitted_bytes: u64,
    pub truncated: bool,
    pub text: String,
}

/// Frames process output on UTF-8 scalar boundaries without changing raw bytes.
///
/// A scalar spans at most four bytes, so each stream retains at most three
/// incomplete bytes between producer chunks.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProcessOutputFramers {
    stdout: Utf8OutputFramer,
    stderr: Utf8OutputFramer,
    combined: Utf8OutputFramer,
}

impl ProcessOutputFramers {
    pub fn push(&mut self, kind: ExecutionOutputKind, bytes: &[u8]) -> Vec<u8> {
        self.framer(kind).push(bytes)
    }

    pub fn finish(&mut self, kind: ExecutionOutputKind) -> Vec<u8> {
        self.framer(kind).finish()
    }

    pub fn finish_all(&mut self) -> Vec<(ExecutionOutputKind, Vec<u8>)> {
        [
            ExecutionOutputKind::Stdout,
            ExecutionOutputKind::Stderr,
            ExecutionOutputKind::Combined,
        ]
        .into_iter()
        .filter_map(|kind| {
            let bytes = self.finish(kind);
            (!bytes.is_empty()).then_some((kind, bytes))
        })
        .collect()
    }

    fn framer(&mut self, kind: ExecutionOutputKind) -> &mut Utf8OutputFramer {
        match kind {
            ExecutionOutputKind::Stdout => &mut self.stdout,
            ExecutionOutputKind::Stderr => &mut self.stderr,
            ExecutionOutputKind::Combined => &mut self.combined,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct Utf8OutputFramer {
    pending: Vec<u8>,
}

impl Utf8OutputFramer {
    fn push(&mut self, bytes: &[u8]) -> Vec<u8> {
        let mut frame = std::mem::take(&mut self.pending);
        frame.extend_from_slice(bytes);
        let boundary = utf8_boundary(&frame);
        self.pending = frame.split_off(boundary);
        frame
    }

    fn finish(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.pending)
    }
}

/// Keep only a potentially incomplete UTF-8 suffix; malformed bytes remain raw.
fn utf8_boundary(bytes: &[u8]) -> usize {
    let mut boundary = bytes.len().saturating_sub(char::MAX.len_utf8() - 1);
    while boundary < bytes.len() {
        match std::str::from_utf8(&bytes[boundary..]) {
            Ok(value) => return boundary + value.len(),
            Err(error) => {
                boundary += error.valid_up_to();
                if let Some(invalid_len) = error.error_len() {
                    boundary += invalid_len;
                } else {
                    return boundary;
                }
            }
        }
    }
    bytes.len()
}

#[cfg(test)]
mod tests {
    use super::{BoundedProcessOutput, ProcessOutputFramers};
    use crate::execution_process::ExecutionOutputKind;

    #[test]
    fn preserves_head_and_tail_when_output_exceeds_budget() {
        let mut output = BoundedProcessOutput::new(10);
        output.push(b"0123456789");
        output.push(b"ab");

        let snapshot = output.snapshot();
        assert_eq!(snapshot.bytes, 12);
        assert_eq!(snapshot.omitted_bytes, 2);
        assert!(snapshot.truncated);
        assert_eq!(snapshot.text, "01234\n... 2 bytes omitted ...\n789ab");
    }

    #[test]
    fn zero_budget_drops_every_byte_without_growing() {
        let mut output = BoundedProcessOutput::new(0);
        output.push(b"abc");

        let snapshot = output.snapshot();
        assert_eq!(snapshot.bytes, 3);
        assert_eq!(snapshot.omitted_bytes, 3);
        assert_eq!(snapshot.text, "\n... 3 bytes omitted ...\n");
    }

    #[test]
    fn a_single_byte_budget_keeps_the_latest_byte() {
        let mut output = BoundedProcessOutput::new(1);
        output.push(b"abc");

        let snapshot = output.snapshot();
        assert_eq!(snapshot.omitted_bytes, 2);
        assert_eq!(snapshot.text, "\n... 2 bytes omitted ...\nc");
    }

    #[test]
    fn converts_utf8_after_joining_retained_bytes() {
        let mut output = BoundedProcessOutput::new(8);
        output.push(&[b'a', b'b', 0xf0, 0x9f]);
        output.push(&[0x98, 0x80, b'c', b'd']);

        let snapshot = output.snapshot();
        assert_eq!(snapshot.bytes, 8);
        assert_eq!(snapshot.omitted_bytes, 0);
        assert_eq!(snapshot.text, "ab\u{1f600}cd");
    }

    #[test]
    fn frames_multibyte_characters_across_chunks() {
        let mut framers = ProcessOutputFramers::default();

        assert!(
            framers
                .push(ExecutionOutputKind::Stdout, &[0xf0, 0x9f])
                .is_empty()
        );
        assert_eq!(
            framers.push(ExecutionOutputKind::Stdout, &[0x98, 0x80]),
            "\u{1f600}".as_bytes()
        );
    }

    #[test]
    fn frames_streams_independently_and_flushes_incomplete_suffixes() {
        let mut framers = ProcessOutputFramers::default();

        assert!(
            framers
                .push(ExecutionOutputKind::Stdout, &[0xc3])
                .is_empty()
        );
        assert_eq!(
            framers.push(ExecutionOutputKind::Stderr, b"error"),
            b"error"
        );
        assert_eq!(framers.finish(ExecutionOutputKind::Stdout), vec![0xc3]);
        assert!(framers.finish(ExecutionOutputKind::Stderr).is_empty());
    }

    #[test]
    fn malformed_bytes_do_not_block_later_valid_output() {
        let mut framers = ProcessOutputFramers::default();

        assert_eq!(
            framers.push(ExecutionOutputKind::Combined, &[0xff, 0xc3]),
            vec![0xff]
        );
        assert_eq!(
            framers.push(ExecutionOutputKind::Combined, &[0xa9, b'!']),
            ["\u{e9}".as_bytes(), b"!"].concat()
        );
    }
}
