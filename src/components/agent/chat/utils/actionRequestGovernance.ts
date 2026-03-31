import type { ActionRequired, ActionRequestGovernanceMeta } from "../types";

type SchemaRecord = Record<string, unknown>;

const SINGLE_TURN_SINGLE_QUESTION_STRATEGY = "single_turn_single_question";
const ASK_USER_QUESTIONS_SCHEMA_KEY = "x-lime-ask-user-questions";

function buildGovernanceMeta(
  source: ActionRequestGovernanceMeta["source"],
  partial: Omit<ActionRequestGovernanceMeta, "strategy" | "source">,
): ActionRequestGovernanceMeta {
  return {
    strategy: SINGLE_TURN_SINGLE_QUESTION_STRATEGY,
    source,
    ...partial,
  };
}

function normalizeRequiredKeys(
  value: unknown,
  availableKeys: string[],
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const available = new Set(availableKeys);
  return value.filter(
    (item): item is string => typeof item === "string" && available.has(item),
  );
}

function governAskUserRequest(request: ActionRequired): ActionRequired {
  const questions = request.questions || [];
  if (questions.length <= 1) {
    return request;
  }

  return {
    ...request,
    questions: [questions[0]],
    governance: buildGovernanceMeta("runtime_action_required", {
      originalQuestionCount: questions.length,
      retainedQuestionIndex: 0,
      deferredQuestionCount: questions.length - 1,
    }),
  };
}

function governElicitationRequest(request: ActionRequired): ActionRequired {
  const questions = request.questions || [];
  const schema =
    request.requestedSchema &&
    typeof request.requestedSchema === "object" &&
    !Array.isArray(request.requestedSchema)
      ? (request.requestedSchema as SchemaRecord)
      : null;
  const properties =
    schema?.properties &&
    typeof schema.properties === "object" &&
    !Array.isArray(schema.properties)
      ? (schema.properties as Record<string, SchemaRecord>)
      : null;

  if (!schema || !properties) {
    if (questions.length <= 1) {
      return request;
    }

    return {
      ...request,
      questions: [questions[0]],
      governance: buildGovernanceMeta("runtime_action_required", {
        originalQuestionCount: questions.length,
        retainedQuestionIndex: 0,
        deferredQuestionCount: questions.length - 1,
      }),
    };
  }

  const propertyKeys = Object.keys(properties);
  if (propertyKeys.length <= 1) {
    return request;
  }

  const normalizedRequired = normalizeRequiredKeys(
    schema.required,
    propertyKeys,
  );
  const retainedFieldKey = normalizedRequired[0] || propertyKeys[0];
  const retainedProperty = properties[retainedFieldKey];
  const nextSchema: SchemaRecord = {
    ...schema,
    properties: {
      [retainedFieldKey]: retainedProperty,
    },
  };

  if (normalizedRequired.includes(retainedFieldKey)) {
    nextSchema.required = [retainedFieldKey];
  } else {
    delete nextSchema.required;
  }

  const nextQuestions =
    questions.length > 1 ? [questions[0]] : request.questions;

  if (nextQuestions && nextQuestions.length > 0) {
    nextSchema[ASK_USER_QUESTIONS_SCHEMA_KEY] = nextQuestions;
  }

  return {
    ...request,
    questions: nextQuestions,
    requestedSchema: nextSchema,
    governance: buildGovernanceMeta("runtime_action_required", {
      ...(questions.length > 1
        ? {
            originalQuestionCount: questions.length,
            retainedQuestionIndex: 0,
            deferredQuestionCount: questions.length - 1,
          }
        : {}),
      originalFieldCount: propertyKeys.length,
      retainedFieldKey,
      deferredFieldCount: propertyKeys.length - 1,
    }),
  };
}

export function governActionRequest(request: ActionRequired): ActionRequired {
  if (request.actionType === "ask_user") {
    return governAskUserRequest(request);
  }

  if (request.actionType === "elicitation") {
    return governElicitationRequest(request);
  }

  return request;
}
