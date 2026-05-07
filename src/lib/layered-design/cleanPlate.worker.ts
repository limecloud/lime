import { createLayeredDesignSimpleCleanPlateProvider } from "./cleanPlate";
import { installLayeredDesignCleanPlateWorkerRuntime } from "./cleanPlateWorker";

installLayeredDesignCleanPlateWorkerRuntime(
  self,
  createLayeredDesignSimpleCleanPlateProvider(),
);
