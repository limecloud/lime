//! Real key steps retain the same model, Thread and durable App Server settings owner.

use super::*;

pub(super) fn respond_to_palette_probes(
    writer: &mut impl Write,
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while !output.contains("\x1b]10;?") || !output.contains("\x1b]11;?") {
        let remaining = deadline.saturating_duration_since(Instant::now());
        assert!(!remaining.is_zero(), "real terminal must query its palette");
        let chunk = output_rx
            .recv_timeout(remaining)
            .expect("terminal startup probe");
        output.push_str(&String::from_utf8_lossy(&chunk));
    }
    writer
        .write_all(b"\x1b[1;1R\x1b]10;rgb:eeee/eeee/eeee\x1b\\\x1b]11;rgb:1111/1111/1111\x1b\\")
        .unwrap();
    writer.flush().unwrap();
}

fn wait_for_ignition_tint(output_rx: &mpsc::Receiver<Vec<u8>>, output: &mut String) {
    let deadline = Instant::now() + Duration::from_secs(3);
    let (red, green, blue) = crate::style::user_message_bg_rgb((17, 17, 17));
    let band = vt100::Color::Rgb(red, green, blue);
    loop {
        let mut parser = vt100::Parser::new(24, 100, 0);
        parser.process(output.as_bytes());
        if let Some((row, _)) = terminal_marker_position(output, "» Ask Lime to do anything") {
            let top = row.saturating_sub(1);
            let tinted = (0..100).any(|column| {
                parser.screen().cell(top, column).is_some_and(|cell| {
                    matches!(cell.bgcolor(), vt100::Color::Rgb(..)) && cell.bgcolor() != band
                })
            });
            if tinted {
                return;
            }
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        assert!(
            !remaining.is_zero(),
            "ignition must paint the real composer band"
        );
        let chunk = output_rx
            .recv_timeout(remaining)
            .expect("next animation frame");
        output.push_str(&String::from_utf8_lossy(&chunk));
    }
}

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
    exercise_ultra_prompt(writer, output_rx, output, false);
}

pub(super) fn exercise_animation(
    writer: &mut impl Write,
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
) {
    exercise_ultra_prompt(writer, output_rx, output, true);
}

fn exercise_ultra_prompt(
    writer: &mut impl Write,
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
    verify_animation: bool,
) {
    writer.write_all(b"\x1b[200~/model\x1b[201~\x05\r").unwrap();
    writer.flush().unwrap();
    wait_for_screen_marker(
        output_rx,
        output,
        "Select Model and Effort",
        Duration::from_secs(10),
    );
    write_typed_text(writer, b"gate");
    wait_for_screen_marker(output_rx, output, "Gate Reasoner", Duration::from_secs(10));
    writer.write_all(b"\x1b[20~").unwrap();
    writer.flush().unwrap();
    wait_for_screen_marker(
        output_rx,
        output,
        "Select Reasoning Level",
        Duration::from_secs(10),
    );
    writer.write_all(b"\x04\x1b[20~").unwrap();
    writer.flush().unwrap();
    wait_for_screen_marker(
        output_rx,
        output,
        "Advanced Reasoning",
        Duration::from_secs(10),
    );
    writer.write_all(b"j\x1b[20~").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "Ultra settings refresh the actual composer prompt",
        |screen| {
            !screen.contains("Advanced Reasoning") && screen.contains("» Ask Lime to do anything")
        },
    );
    if verify_animation {
        wait_for_ignition_tint(output_rx, output);
        wait_for_screen(
            output_rx,
            output,
            "Ultra label assembles on the real passive footer",
            |screen| screen.contains("U L T R A") && screen.contains("» Ask Lime to do anything"),
        );
        wait_for_screen(
            output_rx,
            output,
            "refreshed canonical Ultra status fades back in",
            |screen| {
                screen
                    .lines()
                    .last()
                    .is_some_and(|row| row.contains("ultra"))
                    && !screen.contains("U L T R A")
            },
        );
        eprintln!(
        "TUI_EFFORT_ANIMATION_OK palette=probed ignition=tinted ultra=assembled status=restored frames=shared"
    );
    }
    writer
        .write_all(b"\x1b[200~/status\x1b[201~\x05\r")
        .unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "Ultra is the current server-backed model setting",
        |screen| screen.contains("gate-reasoner") && screen.contains("ultra"),
    );
    writer.write_all(b"q").unwrap();
    writer.flush().unwrap();
    wait_for_screen(
        output_rx,
        output,
        "Ultra accent survives closing the status surface",
        |screen| screen.contains("» Ask Lime to do anything"),
    );
    step(writer, output_rx, output, b',', "Reasoning: Max");
    wait_for_screen(
        output_rx,
        output,
        "Max restores the single arrow on the same input baseline",
        |screen| {
            screen.contains("› Ask Lime to do anything")
                && !screen.contains("» Ask Lime to do anything")
        },
    );
    step(writer, output_rx, output, b',', "Reasoning: High");
    eprintln!(
        "TUI_EFFORT_PROMPT_OK ultra=double-arrow max=single-arrow status=preserved keyboard=ok"
    );
}
