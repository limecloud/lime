import { execFile } from "node:child_process";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";
import { notarize } from "@electron/notarize";
import {
  isTransientStapleError,
  retryMacOSTicketDelivery,
  ticketRetryDelays as retryDelays,
} from "./macos-ticket-delivery.mjs";

const run = promisify(execFile);

function transientNotaryError(error) {
  return /NSURLErrorDomain|HTTPError\(statusCode: nil|ETIMEDOUT|ECONNRESET|timeout while waiting|timed out/iu.test(
    `${error.message}\n${error.stdout || ""}\n${error.stderr || ""}`,
  );
}

async function resumeNotarySubmission(
  error,
  credentials,
  { runImpl, sleep, log },
) {
  const id = String(error.message).match(
    /https:\/\/appstoreconnect\.apple\.com\/notary\/v2\/submissions\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})(?:[?\s,]|$)/iu,
  )?.[1];
  if (
    !id ||
    !transientNotaryError(error) ||
    !credentials.appleId ||
    !credentials.appleIdPassword ||
    !credentials.teamId
  ) {
    return false;
  }
  for (let attempt = 0; ; attempt += 1) {
    let result;
    try {
      result = await runImpl(
        "xcrun",
        [
          "notarytool",
          "wait",
          id,
          "--apple-id",
          credentials.appleId,
          "--password",
          credentials.appleIdPassword,
          "--team-id",
          credentials.teamId,
          "--output-format",
          "json",
          "--timeout",
          "5m",
        ],
        { timeout: 330_000, maxBuffer: 1024 * 1024 },
      );
    } catch (waitError) {
      if (!transientNotaryError(waitError) || attempt === retryDelays.length) {
        // execFile includes command arguments in its message. Never expose auth.
        const message = [waitError.message, waitError.stdout, waitError.stderr]
          .filter(Boolean)
          .join("\n");
        throw new Error(
          Object.values(credentials).reduce(
            (text, secret) =>
              typeof secret === "string" && secret
                ? text.split(secret).join("[REDACTED]")
                : text,
            message,
          ),
        );
      }
      log(
        `Apple submission ${id} is still unavailable; retrying status in ${retryDelays[attempt] / 1000}s`,
      );
      await sleep(retryDelays[attempt]);
      continue;
    }
    const response = JSON.parse(result.stdout);
    if (response.id !== id || response.status !== "Accepted") {
      throw new Error(`Apple submission ${id} was not Accepted`);
    }
    return true;
  }
}

export async function notarizeMacApp(
  appPath,
  credentials,
  {
    notarizeImpl = notarize,
    runImpl = run,
    sleep = setTimeout,
    log = console.log,
  } = {},
) {
  try {
    await notarizeImpl({ appPath, ...credentials });
  } catch (error) {
    // A polling timeout can leave a valid submission running at Apple. Continue
    // that submission instead of rebuilding and uploading the bundle again.
    if (
      await resumeNotarySubmission(error, credentials, { runImpl, sleep, log })
    ) {
      await retryMacOSTicketDelivery(
        () =>
          runImpl("xcrun", ["stapler", "staple", "-v", appPath], {
            timeout: 60_000,
            maxBuffer: 1024 * 1024,
          }),
        { sleep, log },
      );
    } else {
      // A staple failure occurs after Apple's Accepted response. Keep that signed
      // bundle and ticket instead of rebuilding, re-signing and submitting again.
      if (!isTransientStapleError(error)) throw error;
      for (const [index, delay] of retryDelays.entries()) {
        log(
          `Apple ticket delivery unavailable; retrying staple ${index + 1}/${retryDelays.length} in ${delay / 1000}s`,
        );
        await sleep(delay);
        try {
          await runImpl("xcrun", ["stapler", "staple", "-v", appPath], {
            timeout: 60_000,
            maxBuffer: 1024 * 1024,
          });
          break;
        } catch (stapleError) {
          if (
            !isTransientStapleError(stapleError) ||
            index === retryDelays.length - 1
          ) {
            throw stapleError;
          }
        }
      }
    }
  }
  await retryMacOSTicketDelivery(
    () =>
      runImpl("xcrun", ["stapler", "validate", appPath], { timeout: 60_000 }),
    { sleep, log },
  );
}

export async function notarizeMacPackages(
  { platform, outputPaths },
  credentials,
  { notarizeImpl = notarizeMacApp } = {},
) {
  if (platform !== "darwin" || !credentials) return;
  if (outputPaths.length === 0)
    throw new Error("No signed macOS package to notarize");
  for (const outputPath of outputPaths) {
    await notarizeImpl(path.join(outputPath, "Lime.app"), credentials);
  }
}
