//! 显式选择的云端实测入口。请求、收据和 CLI profile 均由本机操作者提供。
//! 默认测试绝不访问云服务；执行前必须审阅请求中的资源、报价和 confirmation。
use lime_services::cloud_desktop_service::CloudDesktopService;

#[tokio::test]
#[ignore = "requires an authorized local cloud request file and Alibaba CLI profile"]
async fn authorized_cloud_desktop_request() {
    assert_eq!(std::env::var("LIME_CLOUD_LIVE").as_deref(), Ok("authorized"));
    let request_file = std::env::var_os("LIME_CLOUD_REQUEST_FILE").expect("request file");
    let root = std::env::var_os("LIME_CLOUD_STATE_DIR").expect("private state directory");
    let bytes = std::fs::read(request_file).unwrap();
    assert!(bytes.len() <= 64 * 1024);
    let params = serde_json::from_slice(&bytes).expect("typed CloudDesktopParams");
    let response = CloudDesktopService::new(root).request(params).await.unwrap();
    // Service responses exclude tokens and provider credentials.
    println!("{}", serde_json::to_string(&response).unwrap());
}
