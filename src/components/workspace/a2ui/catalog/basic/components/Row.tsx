import type { CSSProperties } from "react";
import type {
  RowComponent,
  A2UIComponent,
  A2UIFormData,
  A2UIEvent,
} from "../../../types";
import { getA2UILayoutClasses } from "../../../layoutTokens";
import { ComponentRenderer } from "../../../components/ComponentRenderer";
import { resolveChildEntries } from "../childList";

interface RowRendererProps {
  component: RowComponent;
  components: A2UIComponent[];
  data: Record<string, unknown>;
  formData: A2UIFormData;
  onFormChange: (id: string, value: unknown) => void;
  onAction: (event: A2UIEvent) => void;
  scopePath?: string;
}

function buildRowChildStyle(
  weight: number | undefined,
  wrap: boolean,
  minChildWidth: number | undefined,
): CSSProperties | undefined {
  if (weight === undefined && !wrap) {
    return undefined;
  }

  const resolvedMinWidth = wrap ? (minChildWidth ?? 220) : 0;

  if (typeof weight === "number" && Number.isFinite(weight) && weight > 0) {
    return {
      flex: `${weight} 1 0px`,
      minWidth: resolvedMinWidth,
    };
  }

  if (wrap) {
    return {
      flex: `1 1 ${resolvedMinWidth}px`,
      minWidth: resolvedMinWidth,
    };
  }

  return undefined;
}

export function RowRenderer({
  component,
  components,
  data,
  formData,
  onFormChange,
  onAction,
  scopePath = "/",
}: RowRendererProps) {
  const childEntries = resolveChildEntries({
    children: component.children,
    components,
    data,
    scopePath,
  });

  return (
    <div
      className={getA2UILayoutClasses({
        direction: "row",
        justify: component.justify,
        align: component.align,
        defaultAlign: "start",
      })}
      style={{
        gap: component.gap || 8,
        flexWrap: component.wrap ? "wrap" : "nowrap",
      }}
    >
      {childEntries.map((entry) => (
        <div
          key={entry.key}
          className="min-w-0"
          style={buildRowChildStyle(
            entry.component.weight,
            Boolean(component.wrap),
            component.minChildWidth,
          )}
        >
          <ComponentRenderer
            component={entry.component}
            components={components}
            data={data}
            formData={formData}
            onFormChange={onFormChange}
            onAction={onAction}
            scopePath={entry.scopePath}
          />
        </div>
      ))}
    </div>
  );
}

export const Row = RowRenderer;
