import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { packageLinuxGuest } from "./linux-guest-package.mjs";

const native = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../electron/native/linux");

test("native archive packaging round-trips through the actual guest verifier", async () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "lime-guest-package-"));
  try {
    const payload = path.join(temporary, "runtime with spaces");
    mkdirSync(payload);
    const prepared = spawnSync("python3", ["-c",
      "import sys,pathlib;sys.path.insert(0,sys.argv[1]);from test_linux_guest import payload;print(payload(pathlib.Path(sys.argv[2])))",
      native, payload], { encoding: "utf8", shell: false });
    assert.equal(prepared.status, 0, prepared.stderr);
    const receipt = await packageLinuxGuest(payload);
    assert.equal(receipt.manifestSha256, prepared.stdout.trim());
    assert.deepEqual(JSON.parse(readFileSync(payload + ".tar.gz.json", "utf8")), receipt);
    const extracted = path.join(temporary, "extracted");
    mkdirSync(extracted, { mode: 0o700 });
    const checked = spawnSync("python3", ["-c",
      "import sys,pathlib;sys.path.insert(0,sys.argv[1]);from test_linux_guest import guest;root=pathlib.Path(sys.argv[3]);guest.unpack_payload(sys.argv[2],sys.argv[4],root);guest.verify_payload(root,sys.argv[5])",
      native, payload + ".tar.gz", extracted, receipt.archiveSha256, receipt.manifestSha256],
      { encoding: "utf8", shell: false });
    assert.equal(checked.status, 0, checked.stderr);
    assert.match(readFileSync(path.join(extracted, "bin/app-server"), "utf8"), /explicit unit test fixture/u);
    const before = readFileSync(payload + ".tar.gz");
    await assert.rejects(packageLinuxGuest(payload), { code: "EEXIST" });
    assert.deepEqual(readFileSync(payload + ".tar.gz"), before);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("packaging rejects a symlink root and preserves an existing archive", async () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "lime-guest-package-"));
  try {
    const payload = path.join(temporary, "runtime");
    mkdirSync(payload);
    writeFileSync(path.join(payload, "guest-manifest.json"), "{}");
    writeFileSync(payload + ".tar.gz", "existing artifact");
    await assert.rejects(packageLinuxGuest(payload), { code: "EEXIST" });
    assert.equal(readFileSync(payload + ".tar.gz", "utf8"), "existing artifact");
    const link = path.join(temporary, "linked");
    symlinkSync(payload, link);
    await assert.rejects(packageLinuxGuest(link), /payload directory/u);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
