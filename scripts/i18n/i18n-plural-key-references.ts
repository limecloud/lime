import ts from "typescript";

const PLURAL_CATEGORIES = ["zero", "one", "two", "few", "many", "other"];

function resolveOptions(
  expression: ts.Expression | undefined,
  initializers: Map<string, ts.Expression>,
  seen = new Set<string>(),
): ts.ObjectLiteralExpression | undefined {
  if (!expression) return undefined;
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  )
    return resolveOptions(expression.expression, initializers, seen);
  if (ts.isIdentifier(expression) && !seen.has(expression.text)) {
    seen.add(expression.text);
    return resolveOptions(
      initializers.get(expression.text),
      initializers,
      seen,
    );
  }
  return ts.isObjectLiteralExpression(expression) ? expression : undefined;
}

export function collectPluralKeyReferences(
  call: ts.CallExpression,
  keys: string[],
  initializers: Map<string, ts.Expression>,
): string[] {
  const options = resolveOptions(
    call.arguments[2] ?? call.arguments[1],
    initializers,
  );
  if (
    !options?.properties.some(
      (property) =>
        (ts.isPropertyAssignment(property) ||
          ts.isShorthandPropertyAssignment(property)) &&
        (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
        property.name.text === "count",
    )
  )
    return [];
  const ordinal = options.properties.some(
    (property) =>
      ts.isPropertyAssignment(property) &&
      (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
      property.name.text === "ordinal" &&
      property.initializer.kind === ts.SyntaxKind.TrueKeyword,
  );
  return keys.flatMap((key) =>
    PLURAL_CATEGORIES.map(
      (category) => `${key}_${ordinal ? "ordinal_" : ""}${category}`,
    ),
  );
}
