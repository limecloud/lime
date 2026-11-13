use super::*;
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

fn response(status: u16, body: &str) -> String {
    format!(
        "HTTP/1.1 {status} Test\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}

async fn fixture(
    responses: Vec<String>,
) -> (reqwest::Client, Vec<String>, Arc<Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let endpoints = (0..responses.len())
        .map(|index| format!("http://{address}/{index}"))
        .collect();
    let requests = Arc::new(Mutex::new(Vec::new()));
    let observed = requests.clone();
    tokio::spawn(async move {
        for response in responses {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            while !request.ends_with(b"\r\n\r\n") {
                let mut byte = [0];
                assert_eq!(socket.read(&mut byte).await.unwrap(), 1);
                request.push(byte[0]);
                assert!(request.len() < 8192);
            }
            let request = String::from_utf8(request).unwrap().to_lowercase();
            assert!(!request.contains("authorization:") && !request.contains("cookie:"));
            observed.lock().unwrap().push(request);
            socket.write_all(response.as_bytes()).await.unwrap();
            socket.shutdown().await.unwrap();
        }
    });
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(2))
        .build()
        .unwrap();
    (client, endpoints, requests)
}

#[tokio::test]
async fn unavailable_source_still_requires_two_matching_observations() {
    let (client, endpoints, requests) = fixture(vec![
        response(503, "Unavailable"),
        response(200, "8.8.8.8\n"),
        response(200, "8.8.8.8\n"),
    ])
    .await;
    let endpoints: Vec<_> = endpoints.iter().map(String::as_str).collect();
    assert_eq!(
        discover_public_ipv4(&client, &endpoints).await.unwrap(),
        "8.8.8.8/32"
    );
    assert_eq!(requests.lock().unwrap().len(), 3);
}

#[tokio::test]
async fn connection_failure_does_not_prevent_two_remaining_sources() {
    let unavailable = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = unavailable.local_addr().unwrap();
    drop(unavailable);
    let (client, endpoints, requests) =
        fixture(vec![response(200, "8.8.8.8"), response(200, "8.8.8.8")]).await;
    let missing = format!("http://{address}/");
    let sources = [missing.as_str(), &endpoints[0], &endpoints[1]];
    assert_eq!(
        discover_public_ipv4(&client, &sources).await.unwrap(),
        "8.8.8.8/32"
    );
    assert_eq!(requests.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn one_success_cannot_authorize_the_connection() {
    let (client, endpoints, requests) = fixture(vec![
        response(503, "Unavailable"),
        response(200, "8.8.8.8"),
        response(503, "Unavailable"),
    ])
    .await;
    let endpoints: Vec<_> = endpoints.iter().map(String::as_str).collect();
    assert_eq!(
        discover_public_ipv4(&client, &endpoints).await.unwrap_err(),
        "Cannot verify current public IPv4 address"
    );
    assert_eq!(requests.lock().unwrap().len(), 3);
}

#[tokio::test]
async fn disagreement_is_not_resolved_by_selecting_a_third_source() {
    let (client, endpoints, requests) = fixture(vec![
        response(200, "8.8.8.8"),
        response(200, "1.1.1.1"),
        response(200, "8.8.8.8"),
    ])
    .await;
    let endpoints: Vec<_> = endpoints.iter().map(String::as_str).collect();
    assert_eq!(
        discover_public_ipv4(&client, &endpoints).await.unwrap_err(),
        "Public address discovery disagreed; no connection rules were submitted"
    );
    assert_eq!(requests.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn malformed_private_or_oversized_answers_cannot_use_another_source() {
    for body in [
        "10.0.0.1",
        "::1",
        "100.64.0.1",
        "",
        "8.8.8.8invalid",
        &"x".repeat(65),
    ] {
        let (client, endpoints, requests) = fixture(vec![
            response(200, body),
            response(200, "8.8.8.8"),
            response(200, "8.8.8.8"),
        ])
        .await;
        let endpoints: Vec<_> = endpoints.iter().map(String::as_str).collect();
        assert!(discover_public_ipv4(&client, &endpoints).await.is_err());
        assert_eq!(requests.lock().unwrap().len(), 1);
    }
}

#[tokio::test]
async fn truncated_answer_is_unavailable_and_never_counts_as_confirmation() {
    let (client, endpoints, requests) = fixture(vec![
        "HTTP/1.1 200 Test\r\nContent-Length: 32\r\nConnection: close\r\n\r\n8.8.8.8".into(),
        response(200, "8.8.8.8"),
        response(200, "8.8.8.8"),
    ])
    .await;
    let endpoints: Vec<_> = endpoints.iter().map(String::as_str).collect();
    assert_eq!(
        discover_public_ipv4(&client, &endpoints).await.unwrap(),
        "8.8.8.8/32"
    );
    assert_eq!(requests.lock().unwrap().len(), 3);
}

#[tokio::test]
async fn unknown_length_response_cannot_exceed_the_body_limit() {
    let (client, endpoints, requests) = fixture(vec![
        format!(
            "HTTP/1.1 200 Test\r\nConnection: close\r\n\r\n{}",
            "x".repeat(65)
        ),
        response(200, "8.8.8.8"),
        response(200, "8.8.8.8"),
    ])
    .await;
    let endpoints: Vec<_> = endpoints.iter().map(String::as_str).collect();
    assert_eq!(
        discover_public_ipv4(&client, &endpoints).await.unwrap_err(),
        "Invalid public address discovery response"
    );
    assert_eq!(requests.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn redirect_is_not_followed_and_a_third_request_is_unnecessary_after_agreement() {
    let (client, endpoints, requests) = fixture(vec![
        "HTTP/1.1 302 Test\r\nLocation: /forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into(),
        response(200, "8.8.8.8"),
        response(200, "8.8.8.8"),
    ])
    .await;
    let endpoints: Vec<_> = endpoints.iter().map(String::as_str).collect();
    assert!(discover_public_ipv4(&client, &endpoints).await.is_ok());
    {
        let observed = requests.lock().unwrap();
        assert_eq!(observed.len(), 3);
        assert!(observed
            .iter()
            .all(|request| !request.contains("/forbidden")));
    }

    let (client, endpoints, requests) = fixture(vec![
        response(200, "8.8.8.8"),
        response(200, "8.8.8.8"),
        response(200, "1.1.1.1"),
    ])
    .await;
    let endpoints: Vec<_> = endpoints.iter().map(String::as_str).collect();
    assert!(discover_public_ipv4(&client, &endpoints).await.is_ok());
    assert_eq!(requests.lock().unwrap().len(), 2);
}

#[tokio::test]
#[ignore = "requires public HTTPS network, sends no credentials and creates no cloud resources"]
async fn public_sources_confirm_current_address_without_cloud_resources() {
    assert!(public_ipv4().await.is_ok());
}
