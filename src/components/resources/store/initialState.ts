import type { ResourceItem } from "../services/types";
import type {
  ResourceSortDirection,
  ResourceSortField,
} from "../services/resourceQueries";
export type {
  ResourceSortDirection,
  ResourceSortField,
} from "../services/resourceQueries";

export interface ResourcesState {
  projectId: string | null;
  items: ResourceItem[];
  loading: boolean;
  saving: boolean;
  error: string | null;
  currentFolderId: string | null;
  searchQuery: string;
  sortField: ResourceSortField;
  sortDirection: ResourceSortDirection;
}

export const initialState: ResourcesState = {
  projectId: null,
  items: [],
  loading: false,
  saving: false,
  error: null,
  currentFolderId: null,
  searchQuery: "",
  sortField: "updatedAt",
  sortDirection: "desc",
};
