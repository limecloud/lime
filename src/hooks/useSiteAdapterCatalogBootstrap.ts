import { useEffect } from "react";
import {
  applyInitialSiteAdapterCatalogBootstrap,
  subscribeSiteAdapterCatalogBootstrap,
} from "@/lib/siteAdapterCatalogBootstrap";

export function useSiteAdapterCatalogBootstrap(): void {
  useEffect(() => {
    void applyInitialSiteAdapterCatalogBootstrap();
    return subscribeSiteAdapterCatalogBootstrap();
  }, []);
}
