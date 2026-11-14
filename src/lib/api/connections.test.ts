import { beforeEach, describe, expect, it, vi } from "vitest";
import { listConnectionGrants } from "./connections";

const request = vi.hoisted(() => vi.fn());
vi.mock("./cloudClient", () => ({ requestCloud: request }));

const valid = {
  id: "icg_original",
  connectionId: "icn_original",
  connectionRevision: 2,
  applicationId: "app_lime",
  applicationName: "Lime",
  actions: ["drive.files.read"],
  fileCount: 2,
  status: "active",
  revision: 1,
  expiresAt: "2026-11-13T00:00:00Z",
};

beforeEach(() => {
  request.mockReset();
  request.mockResolvedValue({ items: [valid] });
});

describe("listConnectionGrants", () => {
  it("uses the fixed read route and returns the safe projection", async () => {
    await expect(listConnectionGrants()).resolves.toEqual([valid]);
    expect(request).toHaveBeenCalledWith({
      path: "/connections",
      method: "GET",
    });
  });

  it("accepts an empty list and an unnamed application", async () => {
    request.mockResolvedValueOnce({ items: [] });
    await expect(listConnectionGrants()).resolves.toEqual([]);
    const { applicationName: _name, ...unnamed } = valid;
    request.mockResolvedValueOnce({ items: [unnamed] });
    await expect(listConnectionGrants()).resolves.toEqual([unnamed]);
  });

  it("rejects unknown, null and incomplete projections", async () => {
    for (const body of [
      null,
      {},
      { items: null },
      { items: [{ ...valid, files: [] }] },
      { items: [{ ...valid, consumer: { authorizationId: "grt_original" } }] },
      { items: [{ ...valid, status: "revoked" }] },
      { items: [{ ...valid, fileCount: 0 }] },
      { items: [{ ...valid, actions: ["drive.files.write"] }] },
      { items: [{ ...valid, expiresAt: "not-a-date" }] },
      { items: [{ ...valid, revision: Number.MAX_SAFE_INTEGER + 1 }] },
      { items: Array.from({ length: 201 }, () => valid) },
    ]) {
      request.mockResolvedValueOnce(body);
      await expect(listConnectionGrants()).rejects.toThrow(
        "connection grants returned an invalid list",
      );
    }
  });
});
