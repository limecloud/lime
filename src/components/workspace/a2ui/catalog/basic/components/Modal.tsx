import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import type {
  ModalComponent,
  A2UIComponent,
  A2UIFormData,
  A2UIEvent,
} from "../../../types";
import { getComponentById } from "../../../parser";
import { ComponentRenderer } from "../../../components/ComponentRenderer";

interface ModalRendererProps {
  component: ModalComponent;
  components: A2UIComponent[];
  data: Record<string, unknown>;
  formData: A2UIFormData;
  onFormChange: (id: string, value: unknown) => void;
  onAction: (event: A2UIEvent) => void;
  scopePath?: string;
}

export function ModalRenderer({
  component,
  components,
  data,
  formData,
  onFormChange,
  onAction,
  scopePath = "/",
}: ModalRendererProps) {
  const trigger = getComponentById(components, component.trigger);
  const content = getComponentById(components, component.content);

  if (!trigger || !content) {
    return null;
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <div className="inline-flex">
          <ComponentRenderer
            component={trigger}
            components={components}
            data={data}
            formData={formData}
            onFormChange={onFormChange}
            onAction={onAction}
            scopePath={scopePath}
          />
        </div>
      </DialogTrigger>
      <DialogContent className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-xl">
        <ComponentRenderer
          component={content}
          components={components}
          data={data}
          formData={formData}
          onFormChange={onFormChange}
          onAction={onAction}
          scopePath={scopePath}
        />
      </DialogContent>
    </Dialog>
  );
}

export const Modal = ModalRenderer;
