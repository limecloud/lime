import { describe, expect, it, vi } from "vitest";
import { notarizeMacApp, notarizeMacPackages } from "./macos-notarization.mjs";

const appPath = "/release/Lime-darwin-x64/Lime.app";
const credentials = {
  appleId: "release@example.com",
  appleIdPassword: "secret",
  teamId: "TEAM",
};
const unavailable = () =>
  new Error(
    "Failed to staple your application with code: 68\nError Domain=NSURLErrorDomain Code=-1005\nCloudKit's response is inconsistent with expections: (null)",
  );
const submissionId = "5250eab6-e2cf-48a6-854e-3dcc1019eb94";
const pollingTimeout = () =>
  new Error(
    `Failed to notarize via notarytool. HTTPError(statusCode: nil, Error Domain=NSURLErrorDomain Code=-1001 "The request timed out." https://appstoreconnect.apple.com/notary/v2/submissions/${submissionId}?)`,
  );

describe("macOS notarization ticket delivery", () => {
  it("resumes the timed-out Apple submission and staples only after acceptance", async () => {
    const notarizeImpl = vi.fn().mockRejectedValue(pollingTimeout());
    const runImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("NSURLErrorDomain Code=-1001"))
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ id: submissionId, status: "Accepted" }),
      })
      .mockResolvedValue({});
    const sleep = vi.fn().mockResolvedValue();
    await notarizeMacApp(appPath, credentials, {
      notarizeImpl,
      runImpl,
      sleep,
      log: vi.fn(),
    });
    expect(notarizeImpl).toHaveBeenCalledTimes(1);
    expect(runImpl.mock.calls.slice(0, 2).map(([, args]) => args)).toEqual([
      [
        "notarytool",
        "wait",
        submissionId,
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
      [
        "notarytool",
        "wait",
        submissionId,
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
    ]);
    expect(sleep).toHaveBeenCalledWith(15_000);
    expect(runImpl.mock.calls.slice(2).map(([, args]) => args)).toEqual([
      ["stapler", "staple", "-v", appPath],
      ["stapler", "validate", appPath],
    ]);
  });

  it.each([
    { id: submissionId, status: "Invalid" },
    { id: submissionId, status: "In Progress" },
    { id: "foreign-submission", status: "Accepted" },
  ])("rejects an unaccepted or foreign submission: %j", async (response) => {
    const runImpl = vi
      .fn()
      .mockResolvedValue({ stdout: JSON.stringify(response) });
    await expect(
      notarizeMacApp(appPath, credentials, {
        notarizeImpl: vi.fn().mockRejectedValue(pollingTimeout()),
        runImpl,
      }),
    ).rejects.toThrow("was not Accepted");
    expect(runImpl).toHaveBeenCalledTimes(1);
  });

  it("bounds status retries and redacts credentials from native errors", async () => {
    const runImpl = vi
      .fn()
      .mockRejectedValue(
        new Error(
          `Command failed: xcrun --apple-id ${credentials.appleId} --password ${credentials.appleIdPassword} --team-id ${credentials.teamId}: NSURLErrorDomain Code=-1001`,
        ),
      );
    const failure = await notarizeMacApp(appPath, credentials, {
      notarizeImpl: vi.fn().mockRejectedValue(pollingTimeout()),
      runImpl,
      sleep: vi.fn().mockResolvedValue(),
      log: vi.fn(),
    }).catch((error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain("NSURLErrorDomain");
    for (const secret of Object.values(credentials))
      expect(failure.message).not.toContain(secret);
    expect(runImpl).toHaveBeenCalledTimes(6);
  });

  it("fails without resubmitting when a timeout has no known Apple submission", async () => {
    const notarizeImpl = vi
      .fn()
      .mockRejectedValue(new Error("NSURLErrorDomain Code=-1001"));
    const runImpl = vi.fn();
    await expect(
      notarizeMacApp(appPath, credentials, { notarizeImpl, runImpl }),
    ).rejects.toThrow("NSURLErrorDomain");
    expect(notarizeImpl).toHaveBeenCalledTimes(1);
    expect(runImpl).not.toHaveBeenCalled();
  });

  it("retries the same accepted bundle and validates its ticket without resubmitting", async () => {
    const notarizeImpl = vi.fn().mockRejectedValue(unavailable());
    const runImpl = vi
      .fn()
      .mockRejectedValueOnce(unavailable())
      .mockResolvedValue({});
    const sleep = vi.fn().mockResolvedValue();
    await notarizeMacApp(appPath, credentials, {
      notarizeImpl,
      runImpl,
      sleep,
      log: vi.fn(),
    });
    expect(notarizeImpl).toHaveBeenCalledTimes(1);
    expect(notarizeImpl).toHaveBeenCalledWith({ appPath, ...credentials });
    expect(sleep.mock.calls).toEqual([[15_000], [30_000]]);
    expect(
      runImpl.mock.calls.map(([command, args]) => [command, args]),
    ).toEqual([
      ["xcrun", ["stapler", "staple", "-v", appPath]],
      ["xcrun", ["stapler", "staple", "-v", appPath]],
      ["xcrun", ["stapler", "validate", appPath]],
    ]);
  });

  it("fails closed when the ticket delivery retry budget is exhausted", async () => {
    const runImpl = vi.fn().mockRejectedValue(unavailable());
    await expect(
      notarizeMacApp(appPath, credentials, {
        notarizeImpl: vi.fn().mockRejectedValue(unavailable()),
        runImpl,
        sleep: vi.fn().mockResolvedValue(),
        log: vi.fn(),
      }),
    ).rejects.toThrow(/code: 68/);
    expect(runImpl).toHaveBeenCalledTimes(5);
    expect(runImpl.mock.calls.every(([, args]) => args[1] === "staple")).toBe(
      true,
    );
  });

  it("reads native stapler diagnostics from execFile stderr", async () => {
    const nativeError = Object.assign(new Error("Command failed: xcrun"), {
      code: 68,
      stderr:
        "NSURLErrorDomain Code=-1005\nThe staple and validate action failed! Error 68.",
    });
    const runImpl = vi
      .fn()
      .mockRejectedValueOnce(nativeError)
      .mockResolvedValue({});
    await notarizeMacApp(appPath, credentials, {
      notarizeImpl: vi.fn().mockRejectedValue(unavailable()),
      runImpl,
      sleep: vi.fn().mockResolvedValue(),
      log: vi.fn(),
    });
    expect(runImpl).toHaveBeenCalledTimes(3);
    expect(runImpl.mock.calls[2][1]).toEqual(["stapler", "validate", appPath]);
  });

  it.each([
    "Failed to notarize via notarytool: Invalid signature",
    "Failed to staple your application with code: 65: invalid ticket",
    "Failed to staple your application with code: 68: malformed bundle",
  ])("does not retry permanent failure: %s", async (message) => {
    const runImpl = vi.fn();
    const sleep = vi.fn();
    await expect(
      notarizeMacApp(appPath, credentials, {
        notarizeImpl: vi.fn().mockRejectedValue(new Error(message)),
        runImpl,
        sleep,
      }),
    ).rejects.toThrow(message);
    expect(runImpl).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("rejects a permanent stapler failure during recovery", async () => {
    const runImpl = vi.fn().mockRejectedValue(new Error("invalid signature"));
    await expect(
      notarizeMacApp(appPath, credentials, {
        notarizeImpl: vi.fn().mockRejectedValue(unavailable()),
        runImpl,
        sleep: vi.fn().mockResolvedValue(),
        log: vi.fn(),
      }),
    ).rejects.toThrow("invalid signature");
    expect(runImpl).toHaveBeenCalledTimes(1);
  });

  it("requires validation even when official notarization succeeds", async () => {
    const runImpl = vi.fn().mockRejectedValue(new Error("ticket invalid"));
    await expect(
      notarizeMacApp(appPath, credentials, {
        notarizeImpl: vi.fn().mockResolvedValue(),
        runImpl,
      }),
    ).rejects.toThrow("ticket invalid");
    expect(runImpl.mock.calls[0].slice(0, 2)).toEqual([
      "xcrun",
      ["stapler", "validate", appPath],
    ]);
  });

  it("retries transient validation after notarization without submitting again", async () => {
    const notarizeImpl = vi.fn().mockResolvedValue();
    const failure = Object.assign(new Error("Command failed: xcrun"), {
      stdout:
        "NSURLErrorDomain Code=-1005\nThe validate action failed! Error 68.",
    });
    const runImpl = vi
      .fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValue({});
    const sleep = vi.fn().mockResolvedValue();
    await notarizeMacApp(appPath, credentials, {
      notarizeImpl,
      runImpl,
      sleep,
      log: vi.fn(),
    });
    expect(notarizeImpl).toHaveBeenCalledTimes(1);
    expect(runImpl).toHaveBeenCalledTimes(2);
    expect(runImpl.mock.calls.every(([, args]) => args[1] === "validate")).toBe(
      true,
    );
    expect(sleep).toHaveBeenCalledWith(15_000);
  });

  it("notarizes Forge output before makers and skips local or Windows packages", async () => {
    const notarizeImpl = vi.fn().mockResolvedValue();
    await notarizeMacPackages(
      { platform: "darwin", outputPaths: ["/release/Lime-darwin-x64"] },
      credentials,
      { notarizeImpl },
    );
    expect(notarizeImpl).toHaveBeenCalledWith(appPath, credentials);
    await notarizeMacPackages(
      { platform: "win32", outputPaths: ["/release/windows"] },
      credentials,
      { notarizeImpl },
    );
    await notarizeMacPackages(
      { platform: "darwin", outputPaths: [] },
      undefined,
      { notarizeImpl },
    );
    expect(notarizeImpl).toHaveBeenCalledTimes(1);
    await expect(
      notarizeMacPackages({ platform: "darwin", outputPaths: [] }, credentials),
    ).rejects.toThrow("No signed macOS package");
  });
});
