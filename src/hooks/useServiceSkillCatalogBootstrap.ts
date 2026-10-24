import { useEffect } from "react";
import { applyInitialServiceSkillCatalogBootstrap } from "@/lib/serviceSkillCatalogBootstrap";

export function useServiceSkillCatalogBootstrap(): void {
  useEffect(() => {
    applyInitialServiceSkillCatalogBootstrap();
  }, []);
}
