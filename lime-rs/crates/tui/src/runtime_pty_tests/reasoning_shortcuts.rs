//! Real key steps retain the same model, Thread and durable App Server settings owner.

use super::*;

fn step(
    writer: &mut impl Write,
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
    key: u8,
    marker: &str,
) {
    writer
        .write_all(&[0x1b, key])
        .expect("send real Alt reasoning shortcut");
    writer.flush().unwrap();
    wait_for_screen_marker(output_rx, output, marker, Duration::from_secs(10));
}

pub(super) fn exercise_steps(
    writer: &mut impl Write,
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
) {
    for (key, marker) in [
        (b',', "Reasoning: Medium"),
        (b',', "Reasoning: Low"),
        (b',', "Reasoning is already at the lowest level (Low)."),
        (b'.', "Reasoning: Medium"),
        (b'.', "Reasoning: High"),
        (b'.', "Reasoning: Max"),
        (b'.', "Ultra is available under /model"),
    ] {
        step(writer, output_rx, output, key, marker);
    }
    writer
        .write_all(b"\x1b[200~/status\x1b[201~\x05\r")
        .expect("inspect Max after Ultra navigation instead of mutation");
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "Ultra shortcut leaves catalog model at Max",
        |screen| screen.contains("gate-reasoner") && screen.contains("max"),
    );
    writer
        .write_all(b"\x1b,q")
        .expect("status owns Alt reasoning and then closes");
    writer.flush().unwrap();
    wait_for_screen_marker(
        output_rx,
        output,
        "Ask Lime to do anything",
        Duration::from_secs(10),
    );
    // If the status pager leaked Alt+, the following step would produce Medium, not High.
    step(writer, output_rx, output, b',', "Reasoning: High");
}
