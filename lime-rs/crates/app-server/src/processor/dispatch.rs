//! JSON-RPC method dispatch for the App Server processor.

mod requests;
mod response;
mod v2_ingress;
use super::{ConnectionRequestId, JsonRpcError, RequestProcessor};
use crate::AppServerError;
use app_server_protocol::error_codes;
use app_server_protocol::protocol::v2;
use app_server_protocol::AppServerClientRequest;
use app_server_protocol::JsonRpcErrorResponse;
use app_server_protocol::JsonRpcMessage;
use app_server_protocol::JsonRpcRequest;
use app_server_protocol::METHOD_TURN_START;
use futures::FutureExt;

impl RequestProcessor {
    pub(super) async fn handle_request_inner(
        &self,
        request: JsonRpcRequest,
        connection_request_id: Option<ConnectionRequestId>,
        event_callback: Option<&mut (dyn FnMut(JsonRpcMessage) + Send)>,
    ) -> Result<Vec<JsonRpcMessage>, AppServerError> {
        let v2_request = match v2_ingress::decode(&request) {
            Ok(request) => request,
            Err(error) => {
                return Ok(vec![JsonRpcMessage::Error(JsonRpcErrorResponse {
                    id: request.id,
                    error,
                })]);
            }
        };
        let request_id = request.id.clone();
        let (id, method, params) = if let Some(v2_request) = v2_request {
            match v2_ingress::into_parts(v2_request) {
                Ok(parts) => parts,
                Err(error) => {
                    return Ok(vec![JsonRpcMessage::Error(JsonRpcErrorResponse {
                        id: request_id,
                        error,
                    })]);
                }
            }
        } else {
            let request = match AppServerClientRequest::try_from(request) {
                Ok(request) => request,
                Err(error) => {
                    return Ok(vec![JsonRpcMessage::Error(JsonRpcErrorResponse {
                        id: request_id,
                        error: JsonRpcError::new(error_codes::METHOD_NOT_FOUND, error),
                    })]);
                }
            };
            let (id, method, params) = request.into_jsonrpc_parts();
            (id, method.as_str().to_string(), params)
        };
        let method = method.as_str();
        if self.is_request_canceled(&id) {
            self.clear_request_cancel_state(&id);
            return Ok(vec![JsonRpcMessage::Error(JsonRpcErrorResponse {
                id,
                error: JsonRpcError::new(error_codes::REQUEST_CANCELLED, "request canceled"),
            })]);
        }
        let mut params = params;
        let result = if let Some(request) = self.dispatch_model_request(method, &mut params) {
            request.await
        } else if let Some(request) = self.dispatch_skill_request(method, &mut params) {
            request.await
        } else if let Some(request) = self.dispatch_project_git_request(
            method,
            &mut params,
            &id,
            connection_request_id
                .as_ref()
                .map(|request| request.connection_id),
        ) {
            request.await
        } else {
            match method {
                v2::METHOD_THREAD_QUEUE_ADD => {
                    self.handle_thread_queue_add_impl(params, event_callback)
                        .boxed()
                        .await
                }
                v2::METHOD_MEDIA_READ => {
                    self.handle_media_read_v2_impl(&id, params, event_callback)
                        .boxed()
                        .await
                }
                METHOD_TURN_START => {
                    self.handle_turn_start_v2_impl(params, event_callback)
                        .boxed()
                        .await
                }
                v2::METHOD_TURN_STEER => {
                    self.handle_turn_steer_impl(params, event_callback)
                        .boxed()
                        .await
                }
                _ => {
                    self.dispatch_request(method, params, connection_request_id)
                        .await
                }
            }
        };

        self.clear_request_cancel_state(&id);
        response::into_messages(id, result)
    }
}
