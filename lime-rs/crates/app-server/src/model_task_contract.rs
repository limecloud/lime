use app_server_protocol::{
    CapabilitySnapshot, ModelTaskRequest, ResolvedModelRoute, RouteFailure, RouteFailureCategory,
};
pub(crate) use model_routing_core::{
    build_model_task_request, capability_snapshot_from_model_capabilities,
    model_task_request_value, route_capability_gap, ModelTaskRequestInput,
};
use serde_json::{json, Value};

#[derive(Debug, Clone)]
pub(crate) struct MediaRouteAssessment {
    pub(crate) route_failure: Option<RouteFailure>,
    pub(crate) capability_snapshot: Option<CapabilitySnapshot>,
    pub(crate) resolved_route: Option<ResolvedModelRoute>,
}

impl MediaRouteAssessment {
    pub(crate) fn from_snapshot(
        task_request: &ModelTaskRequest,
        snapshot: CapabilitySnapshot,
    ) -> Self {
        let route_failure = route_capability_gap(task_request, &snapshot).map(|gap| {
            let (provider_id, model_id) = task_request
                .model_ref
                .as_ref()
                .map(|model_ref| {
                    (
                        Some(model_ref.provider_id.clone()),
                        Some(model_ref.model_id.clone()),
                    )
                })
                .unwrap_or((None, None));

            RouteFailure {
                category: RouteFailureCategory::CapabilityGap,
                reason_code: "capability_gap".to_string(),
                message: Some(format!("model capability gap: {gap}")),
                provider_id,
                model_id,
                capability_gap: Some(gap),
                retryable: false,
            }
        });

        Self {
            route_failure,
            capability_snapshot: Some(snapshot),
            resolved_route: None,
        }
    }

    pub(crate) fn with_resolved_route(mut self, resolved_route: ResolvedModelRoute) -> Self {
        self.route_failure = resolved_route.failure.clone();
        self.capability_snapshot = Some(resolved_route.capability_snapshot.clone());
        self.resolved_route = Some(resolved_route);
        self
    }
}

pub(crate) fn apply_media_route_assessment_payload(
    payload: &mut Value,
    assessment: Option<&MediaRouteAssessment>,
) {
    let Some(assessment) = assessment else {
        return;
    };
    let execution_binding_value = assessment
        .resolved_route
        .as_ref()
        .filter(|_| assessment.route_failure.is_none())
        .and_then(|route| {
            crate::model_route_execution::media_route_execution_binding(payload, route)
        });
    let Some(object) = payload.as_object_mut() else {
        return;
    };

    let failure_value = assessment
        .route_failure
        .as_ref()
        .map(|failure| serde_json::to_value(failure).unwrap_or_else(|_| json!({})));
    let snapshot_value = assessment
        .capability_snapshot
        .as_ref()
        .map(|snapshot| serde_json::to_value(snapshot).unwrap_or_else(|_| json!({})));
    let resolved_route_value = assessment
        .resolved_route
        .as_ref()
        .map(|route| serde_json::to_value(route).unwrap_or_else(|_| json!({})));
    object.insert(
        "model_route_assessment".to_string(),
        json!({
            "status": if assessment.route_failure.is_some() { "blocked" } else { "accepted" },
            "routeFailure": failure_value.clone(),
            "capabilitySnapshot": snapshot_value.clone(),
            "resolvedRoute": resolved_route_value.clone(),
            "routeExecution": execution_binding_value.clone(),
        }),
    );
    object.insert(
        "modelRouteAssessment".to_string(),
        json!({
            "status": if assessment.route_failure.is_some() { "blocked" } else { "accepted" },
            "routeFailure": failure_value.clone(),
            "capabilitySnapshot": snapshot_value,
            "resolvedRoute": resolved_route_value.clone(),
            "routeExecution": execution_binding_value.clone(),
        }),
    );
    if let Some(resolved_route_value) = resolved_route_value {
        object.insert("resolved_route".to_string(), resolved_route_value.clone());
        object.insert("resolvedRoute".to_string(), resolved_route_value);
    }
    if let Some(execution_binding_value) = execution_binding_value {
        object.insert(
            "model_route_execution".to_string(),
            execution_binding_value.clone(),
        );
        object.insert("modelRouteExecution".to_string(), execution_binding_value);
    }

    if let Some(failure) = assessment.route_failure.as_ref() {
        let failure_value = failure_value.unwrap_or_else(|| json!({}));
        object.insert("route_failure".to_string(), failure_value.clone());
        object.insert("routeFailure".to_string(), failure_value);
        object.insert(
            "failure_code".to_string(),
            Value::String(failure.reason_code.clone()),
        );
        object.insert(
            "failureCode".to_string(),
            Value::String(failure.reason_code.clone()),
        );
        object.insert(
            "reason_code".to_string(),
            Value::String(failure.reason_code.clone()),
        );
        object.insert(
            "reasonCode".to_string(),
            Value::String(failure.reason_code.clone()),
        );
        object.insert("failure_category".to_string(), json!(failure.category));
        object.insert("failureCategory".to_string(), json!(failure.category));
        if let Some(capability_gap) = failure.capability_gap.as_ref() {
            object.insert(
                "capability_gap".to_string(),
                Value::String(capability_gap.clone()),
            );
            object.insert(
                "capabilityGap".to_string(),
                Value::String(capability_gap.clone()),
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use app_server_protocol::{ModelRefSource, ModelTaskKind, ModelTaskSource};

    #[test]
    fn media_route_assessment_reports_capability_gap() {
        let request = build_model_task_request(ModelTaskRequestInput {
            task_kind: ModelTaskKind::ImageGenerate,
            source: ModelTaskSource::MediaTaskArtifact,
            provider_id: Some("openai".to_string()),
            model_id: Some("text-only".to_string()),
            model_ref_source: ModelRefSource::Task,
            modality_contract_key: Some("image_generation".to_string()),
            routing_slot: Some("image_generation_model".to_string()),
            task_families: vec!["image_generation".to_string()],
            input_modalities: vec!["text".to_string()],
            output_modalities: vec!["image".to_string()],
            runtime_features: Vec::new(),
            capabilities: vec!["image_generation".to_string()],
            session_id: None,
            thread_id: None,
            turn_id: None,
            content_id: None,
            trace_id: None,
        });
        let snapshot = capability_snapshot_from_model_capabilities(&json!({
            "capabilities": {
                "vision": false,
                "streaming": true
            },
            "taskFamilies": ["chat"],
            "inputModalities": ["text"],
            "outputModalities": ["text"],
            "runtimeFeatures": ["streaming"]
        }));
        let assessment = MediaRouteAssessment::from_snapshot(&request, snapshot);

        let failure = assessment.route_failure.expect("capability gap");
        assert_eq!(failure.category, RouteFailureCategory::CapabilityGap);
        assert_eq!(failure.reason_code, "capability_gap");
        assert_eq!(
            failure.capability_gap.as_deref(),
            Some("task_family:image_generation")
        );
        assert_eq!(failure.provider_id.as_deref(), Some("openai"));
        assert_eq!(failure.model_id.as_deref(), Some("text-only"));
    }
}
