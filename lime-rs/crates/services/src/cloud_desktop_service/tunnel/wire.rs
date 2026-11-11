//! Session Manager binary stream, bounded to a single TCP connection.
//! Protocol reference: Alibaba Cloud aliyun_assist_client, Apache-2.0.

use futures::{SinkExt, StreamExt};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::{timeout, Duration, Instant};
use tokio_tungstenite::{
    connect_async_with_config,
    tungstenite::{protocol::WebSocketConfig, Message},
};
use tracing::instrument::WithSubscriber;

const MAX_PAYLOAD: usize = 1024 * 1024;
const IO_TIMEOUT: Duration = Duration::from_secs(15);
const INITIAL_DELAY: Duration = Duration::from_secs(3);
const DEFAULT_BITS_PER_SECOND: u64 = 200 * 1024;

pub(super) struct Frame<'a> {
    pub kind: u32,
    pub payload: &'a [u8],
}

pub(super) fn parse(bytes: &[u8]) -> Result<Frame<'_>, &'static str> {
    // Current ECS agents send 1.00 status frames while the official client
    // sends 1.01 input. Both use the same variable-identity header layout.
    if bytes.len() < 30 || !matches!(&bytes[4..8], b"1.00" | b"1.01") {
        return Err("Invalid Session Manager frame");
    }
    let session_length = bytes[8] as usize;
    let instance_length_offset = 9 + session_length;
    let instance_length = *bytes
        .get(instance_length_offset)
        .ok_or("Truncated session identity")? as usize;
    let created_offset = instance_length_offset + 1 + instance_length;
    let length_offset = created_offset + 16;
    let payload_offset = length_offset + 4;
    if bytes.len() < payload_offset {
        return Err("Truncated Session Manager header");
    }
    let created = u64::from_le_bytes(
        bytes[created_offset..created_offset + 8]
            .try_into()
            .unwrap(),
    );
    let length =
        u32::from_le_bytes(bytes[length_offset..payload_offset].try_into().unwrap()) as usize;
    if created == 0 || length > MAX_PAYLOAD || payload_offset + length != bytes.len() {
        return Err("Invalid Session Manager payload");
    }
    Ok(Frame {
        kind: u32::from_le_bytes(bytes[..4].try_into().unwrap()),
        payload: &bytes[payload_offset..],
    })
}

pub(super) fn encode(kind: u32, sequence: u64, payload: &[u8]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(30 + payload.len());
    bytes.extend_from_slice(&kind.to_le_bytes());
    bytes.extend_from_slice(b"1.01");
    bytes.extend_from_slice(&[0, 0]);
    bytes.extend_from_slice(&(chrono::Utc::now().timestamp_millis() as u64).to_le_bytes());
    bytes.extend_from_slice(&sequence.to_le_bytes());
    bytes.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    bytes.extend_from_slice(payload);
    bytes
}

fn speed(payload: &[u8], current: u64) -> Result<u64, &'static str> {
    if !(2..=5).contains(&payload.len()) {
        return Err("Invalid Session Manager rate limit");
    }
    let bits = payload[1..]
        .iter()
        .fold(0u64, |number, byte| (number << 8) | u64::from(*byte));
    Ok(if bits == 0 {
        current
    } else {
        bits.min(64 * 1024 * 1024)
    })
}

pub(super) async fn forward(socket: TcpStream, url: url::Url) -> Result<(), &'static str> {
    // Tungstenite's trace diagnostics include handshake URLs and raw frames.
    // The application's tracing/log bridge must not record this credential or
    // desktop traffic, even when the workstation enables verbose diagnostics.
    forward_private(socket, url)
        .with_subscriber(tracing::subscriber::NoSubscriber::default())
        .await
}

async fn forward_private(mut socket: TcpStream, url: url::Url) -> Result<(), &'static str> {
    let mut config = WebSocketConfig::default();
    config.max_message_size = Some(MAX_PAYLOAD + 1024);
    config.max_frame_size = Some(MAX_PAYLOAD + 1024);
    let (mut upstream, _) = timeout(
        IO_TIMEOUT,
        connect_async_with_config(url.as_str(), Some(config), true),
    )
    .await
    .map_err(|_| "Session Manager connection timed out")?
    .map_err(|_| "Session Manager connection failed")?;
    let mut sequence = 0u64;
    let mut bits_per_second = DEFAULT_BITS_PER_SECOND;
    // The official port-forward client gives the agent three seconds to attach
    // the target socket. Keep local input unread until then; never replay it.
    let mut next_send = Instant::now() + INITIAL_DELAY;
    let mut last_send: Option<(Instant, usize)> = None;
    let idle = tokio::time::sleep(super::IDLE);
    tokio::pin!(idle);
    let mut buffer = [0u8; 2048];
    let mut keepalive = tokio::time::interval(Duration::from_secs(60));
    keepalive.tick().await;
    let result = loop {
        tokio::select! {
            _ = &mut idle => break Ok(()),
            incoming = upstream.next() => {
                let Some(incoming) = incoming else { break Ok(()); };
                match incoming.map_err(|_| "Session Manager stream failed")? {
                    Message::Binary(bytes) => {
                        let frame = parse(&bytes)?;
                        match frame.kind {
                            1 => {
                                timeout(IO_TIMEOUT, socket.write_all(frame.payload)).await
                                    .map_err(|_| "Local desktop stream timed out")?
                                    .map_err(|_| "Local desktop stream closed")?;
                                if !frame.payload.is_empty() { idle.as_mut().reset(Instant::now() + super::IDLE); }
                            },
                            3 => break Ok(()),
                            5 => match frame.payload.first() {
                                Some(2 | 5) => break Err("Session Manager closed the channel"),
                                Some(7) => {
                                    bits_per_second = speed(frame.payload, bits_per_second)?;
                                    if let Some((sent_at, bytes)) = last_send {
                                        next_send = next_send.max(sent_at + Duration::from_nanos((bytes as u64 * 8 * 1_000_000_000).div_ceil(bits_per_second)));
                                    }
                                },
                                Some(1 | 3) => {},
                                _ => break Err("Unknown Session Manager status"),
                            },
                            _ => break Err("Unsupported Session Manager frame"),
                        }
                    }
                    Message::Ping(bytes) => {
                        timeout(IO_TIMEOUT, upstream.send(Message::Pong(bytes))).await
                            .map_err(|_| "Session Manager write timed out")?
                            .map_err(|_| "Session Manager write failed")?;
                    }
                    Message::Pong(_) => {},
                    Message::Close(_) => break Ok(()),
                    _ => break Err("Unsupported Session Manager message"),
                }
            }
            read = async {
                tokio::time::sleep_until(next_send).await;
                socket.read(&mut buffer).await
            } => {
                let count = read.map_err(|_| "Local desktop stream failed")?;
                if count == 0 { break Ok(()); }
                timeout(IO_TIMEOUT, upstream.send(Message::Binary(encode(0, sequence, &buffer[..count])))).await
                    .map_err(|_| "Session Manager write timed out")?
                    .map_err(|_| "Session Manager write failed")?;
                sequence = sequence.checked_add(1).ok_or("Session Manager sequence exhausted")?;
                let sent_at = Instant::now();
                last_send = Some((sent_at, count));
                idle.as_mut().reset(sent_at + super::IDLE);
                next_send = sent_at + Duration::from_nanos((count as u64 * 8 * 1_000_000_000).div_ceil(bits_per_second));
            }
            _ = keepalive.tick() => {
                timeout(IO_TIMEOUT, upstream.send(Message::Binary(encode(0, sequence, &[])))).await
                    .map_err(|_| "Session Manager write timed out")?
                    .map_err(|_| "Session Manager write failed")?;
                sequence = sequence.checked_add(1).ok_or("Session Manager sequence exhausted")?;
            }
        }
    };
    let _ = timeout(
        Duration::from_secs(2),
        upstream.send(Message::Binary(encode(3, sequence, b"1"))),
    )
    .await;
    let _ = socket.shutdown().await;
    result
}
