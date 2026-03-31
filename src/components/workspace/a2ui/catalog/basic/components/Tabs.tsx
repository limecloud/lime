import { useMemo } from "react";
import {
  Tabs as UITabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import type {
  TabsComponent,
  A2UIComponent,
  A2UIFormData,
  A2UIEvent,
} from "../../../types";
import { getComponentById, resolveDynamicValue } from "../../../parser";
import { ComponentRenderer } from "../../../components/ComponentRenderer";

interface TabsRendererProps {
  component: TabsComponent;
  components: A2UIComponent[];
  data: Record<string, unknown>;
  formData: A2UIFormData;
  onFormChange: (id: string, value: unknown) => void;
  onAction: (event: A2UIEvent) => void;
  scopePath?: string;
}

export function TabsRenderer({
  component,
  components,
  data,
  formData,
  onFormChange,
  onAction,
  scopePath = "/",
}: TabsRendererProps) {
  const tabItems = useMemo(
    () =>
      component.tabs
        .map((tab, index) => {
          const child = getComponentById(components, tab.child);
          if (!child) {
            return null;
          }

          return {
            key: `${component.id}-tab-${index}`,
            value: `${component.id}-tab-${index}`,
            title: String(resolveDynamicValue(tab.title, data, "", scopePath)),
            child,
          };
        })
        .filter(
          (
            entry,
          ): entry is {
            key: string;
            value: string;
            title: string;
            child: A2UIComponent;
          } => entry !== null,
        ),
    [component.id, component.tabs, components, data, scopePath],
  );

  if (tabItems.length === 0) {
    return null;
  }

  return (
    <UITabs defaultValue={tabItems[0].value} className="w-full">
      <TabsList className="w-full justify-start rounded-2xl bg-slate-100 p-1">
        {tabItems.map((tab) => (
          <TabsTrigger key={tab.key} value={tab.value} className="rounded-xl">
            {tab.title}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabItems.map((tab) => (
        <TabsContent key={tab.key} value={tab.value} className="mt-4">
          <ComponentRenderer
            component={tab.child}
            components={components}
            data={data}
            formData={formData}
            onFormChange={onFormChange}
            onAction={onAction}
            scopePath={scopePath}
          />
        </TabsContent>
      ))}
    </UITabs>
  );
}

export const Tabs = TabsRenderer;
