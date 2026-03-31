import type {
  ColumnComponent,
  A2UIComponent,
  A2UIFormData,
  A2UIEvent,
} from "../../../types";
import { getA2UILayoutClasses } from "../../../layoutTokens";
import { ComponentRenderer } from "../../../components/ComponentRenderer";
import { resolveChildEntries } from "../childList";

interface ColumnRendererProps {
  component: ColumnComponent;
  components: A2UIComponent[];
  data: Record<string, unknown>;
  formData: A2UIFormData;
  onFormChange: (id: string, value: unknown) => void;
  onAction: (event: A2UIEvent) => void;
  scopePath?: string;
}

export function ColumnRenderer({
  component,
  components,
  data,
  formData,
  onFormChange,
  onAction,
  scopePath = "/",
}: ColumnRendererProps) {
  const childEntries = resolveChildEntries({
    children: component.children,
    components,
    data,
    scopePath,
  });

  return (
    <div
      className={getA2UILayoutClasses({
        direction: "column",
        justify: component.justify,
        align: component.align,
        defaultAlign: "stretch",
      })}
      style={{ gap: component.gap || 12 }}
    >
      {childEntries.map((entry) => (
        <ComponentRenderer
          key={entry.key}
          component={entry.component}
          components={components}
          data={data}
          formData={formData}
          onFormChange={onFormChange}
          onAction={onAction}
          scopePath={entry.scopePath}
        />
      ))}
    </div>
  );
}

export const Column = ColumnRenderer;
