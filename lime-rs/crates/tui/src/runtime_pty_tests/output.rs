//! Keep UTF-8 scalars intact across arbitrary PTY reads before observers decode each chunk.

use super::*;

pub(super) fn read_output(mut reader: impl Read, sender: mpsc::Sender<Vec<u8>>) {
    let mut buffer = [0; 4096];
    let mut pending = Vec::new();
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => {
                assert!(
                    pending.is_empty(),
                    "PTY closed during an incomplete UTF-8 scalar"
                );
                break;
            }
            Ok(read) => {
                pending.extend_from_slice(&buffer[..read]);
                let complete = match std::str::from_utf8(&pending) {
                    Ok(_) => pending.len(),
                    Err(error) if error.error_len().is_none() => error.valid_up_to(),
                    Err(error) => panic!("PTY emitted invalid UTF-8: {error}"),
                };
                if complete > 0 {
                    let remainder = pending.split_off(complete);
                    if sender
                        .send(std::mem::replace(&mut pending, remainder))
                        .is_err()
                    {
                        break;
                    }
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) => {
                let _ = sender.send(format!("PTY_READER_ERROR: {error}\n").into_bytes());
                break;
            }
        }
    }
}

#[test]
fn every_pty_read_split_preserves_unicode_ansi_and_terminal_geometry() {
    let sequence = "\x1b[2J\x1b[H› [x] 界👩‍💻\r\n←/→ reorder\x1b]0;标题🙂\x07";
    let mut expected = vt100::Parser::new(24, 100, 0);
    expected.process(sequence.as_bytes());
    struct SplitRead<'a> {
        first: &'a [u8],
        rest: &'a [u8],
    }
    impl Read for SplitRead<'_> {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            let chunk = if self.first.is_empty() {
                std::mem::take(&mut self.rest)
            } else {
                std::mem::take(&mut self.first)
            };
            buffer[..chunk.len()].copy_from_slice(chunk);
            Ok(chunk.len())
        }
    }
    for split in 0..=sequence.len() {
        let (first, rest) = sequence.as_bytes().split_at(split);
        let (sender, receiver) = mpsc::channel();
        read_output(SplitRead { first, rest }, sender);
        let output = receiver
            .into_iter()
            .map(|chunk| String::from_utf8(chunk).unwrap())
            .collect::<String>();
        assert_eq!(output, sequence, "split={split}");
        let mut actual = vt100::Parser::new(24, 100, 0);
        actual.process(output.as_bytes());
        assert_eq!(
            actual.screen().contents(),
            expected.screen().contents(),
            "split={split}"
        );
        assert_eq!(
            actual.screen().cursor_position(),
            expected.screen().cursor_position(),
            "split={split}"
        );
    }
}
