import { createAppServerClient } from "./appServer";
import type { InstructionsReadResponse } from "../../../packages/app-server-client/src/protocol";

export type { InstructionsReadResponse };

export async function readInstructions(): Promise<InstructionsReadResponse> {
  return (await createAppServerClient().readInstructions()).result;
}

export async function writeInstructions(
  contents: string,
  expectedRevision: string,
) {
  return (
    await createAppServerClient().writeInstructions({
      contents,
      expectedRevision,
    })
  ).result;
}
