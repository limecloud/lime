import { cn } from "@/lib/utils";
import type {
  ListComponent,
  A2UIComponent,
  A2UIFormData,
  A2UIEvent,
} from "../../../types";
import { ComponentRenderer } from "../../../components/ComponentRenderer";
import { resolveChildEntries } from "../childList";

interface ListRendererProps {
  component: ListComponent;
  components: A2UIComponent[];
  data: Record<string, unknown>;
  formData: A2UIFormData;
  onFormChange: (id: string, value: unknown) => void;
  onAction: (event: A2UIEvent) => void;
  scopePath?: string;
}

export function ListRenderer({
  component,
  components,
  data,
  formData,
  onFormChange,
  onAction,
  scopePath = "/",
}: ListRendererProps) {
  const childEntries = resolveChildEntries({
    children: component.children,
    components,
    data,
    scopePath,
  });

  const isHorizontal = component.direction === "horizontal";

  return (
    <div
      className={cn(
        "flex gap-3",
        isHorizontal ? "flex-row overflow-x-auto pb-1" : "flex-col",
        component.align === "center" && "items-center",
        component.align === "end" && "items-end",
        component.align === "stretch" && "items-stretch",
      )}
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

export const List = ListRenderer;
