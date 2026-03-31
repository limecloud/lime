import type { A2UIComponent, ChildList } from "../../types";
import { getComponentById } from "../../parser";
import {
  appendJsonPointer,
  normalizeDataPath,
  resolveDataAtPath,
} from "../../dataModel";

export interface ResolvedChildEntry {
  component: A2UIComponent;
  key: string;
  scopePath: string;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isChildTemplate(
  value: ChildList,
): value is Exclude<ChildList, string[]> {
  return !Array.isArray(value);
}

export function resolveChildEntries(options: {
  children: ChildList;
  components: A2UIComponent[];
  data: Record<string, unknown>;
  scopePath?: string;
}): ResolvedChildEntry[] {
  const scopePath = options.scopePath || "/";

  if (Array.isArray(options.children)) {
    return options.children
      .map((childId) => {
        const component = getComponentById(options.components, childId);
        if (!component) {
          return null;
        }

        return {
          component,
          key: childId,
          scopePath,
        };
      })
      .filter((entry): entry is ResolvedChildEntry => entry !== null);
  }

  if (!isChildTemplate(options.children)) {
    return [];
  }

  const childTemplate = options.children;
  const templateComponent = getComponentById(
    options.components,
    childTemplate.componentId,
  );
  if (!templateComponent) {
    return [];
  }

  const templateBasePath = normalizeDataPath(childTemplate.path, scopePath);
  const collection = resolveDataAtPath(
    options.data,
    childTemplate.path,
    scopePath,
  );

  if (Array.isArray(collection)) {
    return collection.map((_, index) => ({
      component: templateComponent,
      key: `${childTemplate.componentId}:${index}`,
      scopePath: appendJsonPointer(templateBasePath, String(index)),
    }));
  }

  if (isObjectRecord(collection)) {
    return Object.keys(collection).map((key) => ({
      component: templateComponent,
      key: `${childTemplate.componentId}:${key}`,
      scopePath: appendJsonPointer(templateBasePath, key),
    }));
  }

  return [];
}
