export function tool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = [],
) {
  return Object.freeze({
    type: "function" as const,
    name,
    description,
    inputSchema: Object.freeze({
      type: "object",
      properties: Object.freeze(properties),
      ...(required.length > 0 ? { required: Object.freeze(required) } : {}),
      additionalProperties: false,
    }),
  });
}

export function stringProperty(
  description: string,
  options: { allowEmpty?: boolean } = {},
) {
  return Object.freeze({
    type: "string",
    description,
    ...(options.allowEmpty === true ? { allowEmpty: true } : {}),
  });
}

export function integerProperty(description: string) {
  return Object.freeze({ type: "integer", minimum: 1, description });
}
