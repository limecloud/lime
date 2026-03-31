import type {
  A2UIComponent,
  A2UIEvent,
  A2UIFormData,
  ChildList as A2UIChildList,
} from "@/components/workspace/a2ui/types";
import { ComponentRenderer } from "@/components/workspace/a2ui/components/ComponentRenderer";
import { resolveChildEntries } from "@/components/workspace/a2ui/catalog/basic/childList";

export interface ChildListProps {
  childList: A2UIChildList;
  components: A2UIComponent[];
  data: Record<string, unknown>;
  formData?: A2UIFormData;
  onFormChange?: (id: string, value: unknown) => void;
  onAction?: (event: A2UIEvent) => void;
  scopePath?: string;
}

export function ChildList({
  childList,
  components,
  data,
  formData = {},
  onFormChange = () => undefined,
  onAction = () => undefined,
  scopePath = "/",
}: ChildListProps) {
  const entries = resolveChildEntries({
    children: childList,
    components,
    data,
    scopePath,
  });

  return (
    <>
      {entries.map((entry) => (
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
    </>
  );
}

export const ChildListRenderer = ChildList;
