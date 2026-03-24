import { useEffect } from "react";
import {
  applyInitialServiceSkillCatalogBootstrap,
  subscribeServiceSkillCatalogBootstrap,
} from "@/lib/serviceSkillCatalogBootstrap";

export function useServiceSkillCatalogBootstrap(): void {
  useEffect(() => {
    applyInitialServiceSkillCatalogBootstrap();
    return subscribeServiceSkillCatalogBootstrap();
  }, []);
}
