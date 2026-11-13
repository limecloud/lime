use super::*;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

fn account(base: &str) -> Account {
    Account::Cloud {
        base_url: base.into(),
        issuer: base.into(),
        application_id: "app".into(),
        client_id: "native".into(),
        environment: "sandbox".into(),
        user_id: "user".into(),
        email: "".into(),
        display_name: "".into(),
        generation: "test".into(),
        resources: Vec::new(),
    }
}

async fn request(socket: &mut tokio::net::TcpStream) -> String {
    let mut buffer = Vec::new();
    while !buffer.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
        let mut bytes = [0; 4096];
        let read = socket.read(&mut bytes).await.unwrap();
        assert!(read > 0 && buffer.len() < 16 * 1024);
        buffer.extend_from_slice(&bytes[..read]);
    }
    String::from_utf8(buffer).unwrap()
}

#[tokio::test]
async fn bundle_download_streams_original_bytes_without_account_headers() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        let mut requests = Vec::new();
        for response in [
            "HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nContent-Length: 5\r\nConnection: close\r\n\r\nbytes",
        ] {
            let (mut socket, _) = listener.accept().await.unwrap();
            requests.push(request(&mut socket).await);
            socket.write_all(response.as_bytes()).await.unwrap();
        }
        requests
    });
    let file = download_with_limit(
        &format!("{url}/bundle"),
        &account(&url),
        10,
        Duration::from_secs(3),
    )
    .await
    .unwrap();
    assert_eq!(std::fs::read(file.path()).unwrap(), b"bytes");
    for request in task.await.unwrap() {
        assert!(!request.to_ascii_lowercase().contains("authorization:"));
        assert!(!request.to_ascii_lowercase().contains("cookie:"));
        assert!(request
            .to_ascii_lowercase()
            .contains("accept-encoding: identity"));
    }
}

#[tokio::test]
async fn bundle_download_rejects_declared_and_streamed_oversize_without_echoing_private_url() {
    for body in [
        "HTTP/1.1 200 OK\r\nContent-Length: 999\r\nConnection: close\r\n\r\n",
        "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n5\r\nbytes\r\n0\r\n\r\n",
        "HTTP/1.1 302 Found\r\nLocation: http://example.invalid/private-signature\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        "HTTP/1.1 403 Forbidden\r\nContent-Length: 17\r\nConnection: close\r\n\r\nprivate-signature",
    ] {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            request(&mut socket).await;
            let _ = socket.write_all(body.as_bytes()).await;
        });
        let error = download_with_limit(
            &format!("{url}/private-signature"),
            &account(&url),
            4,
            Duration::from_secs(3),
        )
        .await
        .unwrap_err();
        assert!(!error.contains("private-signature"));
        assert!(!error.contains(&url));
        task.await.unwrap();
    }
}

#[tokio::test]
async fn bundle_download_deadline_covers_the_response_body() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        request(&mut socket).await;
        socket
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\n")
            .await
            .unwrap();
        std::future::pending::<()>().await;
    });
    assert!(
        download_with_limit(&url, &account(&url), 10, Duration::from_millis(150))
            .await
            .is_err()
    );
    task.abort();
}
