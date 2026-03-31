import type {
  CardComponent,
  A2UIComponent,
  A2UIFormData,
  A2UIEvent,
} from "../../../types";
import { getComponentById } from "../../../parser";
import { A2UI_LAYOUT_TOKENS } from "../../../layoutTokens";
import { ComponentRenderer } from "../../../components/ComponentRenderer";

interface CardRendererProps {
  component: CardComponent;
  components: A2UIComponent[];
  data: Record<string, unknown>;
  formData: A2UIFormData;
  onFormChange: (id: string, value: unknown) => void;
  onAction: (event: A2UIEvent) => void;
  scopePath?: string;
}

export function CardRenderer({
  component,
  components,
  data,
  formData,
  onFormChange,
  onAction,
  scopePath = "/",
}: CardRendererProps) {
  const child = getComponentById(components, component.child);
  if (!child) {
    return null;
  }

  return (
    <div className={A2UI_LAYOUT_TOKENS.cardShell}>
      <ComponentRenderer
        component={child}
        components={components}
        data={data}
        formData={formData}
        onFormChange={onFormChange}
        onAction={onAction}
        scopePath={scopePath}
      />
    </div>
  );
}

export const Card = CardRenderer;
