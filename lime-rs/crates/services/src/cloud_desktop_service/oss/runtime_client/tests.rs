use super::*;

// Official SDK interoperability vectors, signer/signer_test.go at d3474aa.
#[test]
fn oss_v4_matches_official_header_vectors_with_and_without_sts() {
    for (date, token, expected) in [
        (
            "20231216T162057Z",
            None,
            "e21d18daa82167720f9b1047ae7e7f1ce7cb77a31e8203a7d5f4624fa0284afe",
        ),
        (
            "20231217T034736Z",
            Some("token"),
            "b94a3f999cf85bcdc00d332fbd3734ba03e48382c36fa4d5af5df817395bd9ea",
        ),
    ] {
        let mut headers = BTreeMap::from([
            ("x-oss-head1".into(), "value".into()),
            ("content-type".into(), "text/plain".into()),
            ("x-oss-content-sha256".into(), "UNSIGNED-PAYLOAD".into()),
            ("x-oss-date".into(), date.into()),
        ]);
        if let Some(token) = token {
            headers.insert("x-oss-security-token".into(), token.into());
        }
        let request = canonical(
            "PUT",
            "bucket",
            "1234+-/123/1.txt",
            "%2Bparam1=value3&%2Bparam2=&%7Cparam1=value4&%7Cparam2=&param1=value1&param2=",
            &headers,
        );
        assert_eq!(signature("sk", "cn-hangzhou", date, &request).1, expected);
    }
}

#[test]
fn oss_v4_matches_official_query_vector() {
    let date = "20231217T025437Z";
    let query = "%2Bparam1=value3&%2Bparam2=&%7Cparam1=value4&%7Cparam2=&param1=value1&param2=&x-oss-credential=ak%2F20231217%2Fcn-hangzhou%2Foss%2Faliyun_v4_request&x-oss-date=20231217T025437Z&x-oss-expires=599&x-oss-signature-version=OSS4-HMAC-SHA256";
    let headers = BTreeMap::from([
        ("x-oss-head1".into(), "value".into()),
        ("content-type".into(), "application/octet-stream".into()),
    ]);
    let request = canonical("PUT", "bucket", "1234+-/123/1.txt", query, &headers);
    assert_eq!(
        signature("sk", "cn-hangzhou", date, &request).1,
        "a39966c61718be0d5b14e668088b3fa07601033f6518ac7b523100014269c0fe"
    );
}

#[test]
fn get_capability_is_bound_to_one_object_and_never_outlives_sts() {
    let now = chrono::Utc::now().timestamp();
    let client = Client::new(
        Credentials {
            access_key: "synthetic-access".into(),
            secret_key: "synthetic-secret".into(),
            token: "synthetic/+token=".into(),
            expires_at: now + 3600,
        },
        "cn-hangzhou",
        "lime-runtime-fixture",
    )
    .unwrap();
    let (url, expiry) = client.download_url("runtime/fixture.tar.gz").unwrap();
    let url = url::Url::parse(&url).unwrap();
    assert_eq!(
        url.host_str(),
        Some("lime-runtime-fixture.oss-cn-hangzhou.aliyuncs.com")
    );
    assert_eq!(url.path(), "/runtime/fixture.tar.gz");
    assert!(expiry <= now + 3540);
    assert!(!url.as_str().contains("synthetic-secret"));
    assert_eq!(
        url.query_pairs()
            .find(|(key, _)| key == "x-oss-security-token")
            .unwrap()
            .1,
        "synthetic/+token="
    );
    let client = Client::new(
        Credentials {
            expires_at: now + 1800,
            ..client.credentials
        },
        "cn-hangzhou",
        "lime-runtime-fixture",
    )
    .unwrap();
    assert_eq!(
        client.download_url("runtime/fixture.tar.gz").unwrap_err(),
        "OSS_AUTHORIZATION_FAILED"
    );
}
