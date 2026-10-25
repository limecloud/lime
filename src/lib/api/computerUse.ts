import { AppServerClient } from "./appServer";
import type {
  ComputerUseLeaseAcquireParams,
  ComputerUseLeaseReleaseParams,
  ComputerUseRevokeParams,
  ComputerUseSetupParams,
  ComputerUseStatusParams,
} from "@limecloud/app-server-client";

type ComputerUseClient = Pick<
  AppServerClient,
  | "readComputerUseStatus"
  | "setupComputerUse"
  | "revokeComputerUse"
  | "acquireComputerUseLease"
  | "releaseComputerUseLease"
>;

export async function readComputerUseStatus(
  params: ComputerUseStatusParams = {},
  client: ComputerUseClient = new AppServerClient(),
) {
  return (await client.readComputerUseStatus(params)).result;
}

export async function setupComputerUse(
  params: ComputerUseSetupParams,
  client: ComputerUseClient = new AppServerClient(),
) {
  return (await client.setupComputerUse(params)).result;
}

export async function revokeComputerUse(
  params: ComputerUseRevokeParams,
  client: ComputerUseClient = new AppServerClient(),
) {
  return (await client.revokeComputerUse(params)).result;
}

export async function acquireComputerUseLease(
  params: ComputerUseLeaseAcquireParams,
  client: ComputerUseClient = new AppServerClient(),
) {
  return (await client.acquireComputerUseLease(params)).result;
}

export async function releaseComputerUseLease(
  params: ComputerUseLeaseReleaseParams,
  client: ComputerUseClient = new AppServerClient(),
) {
  return (await client.releaseComputerUseLease(params)).result;
}
