import process from "node:process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

it("keeps retired renderer credential owners out of production", () => {
  const root = process.cwd();
  for (const retired of [
    "src/lib/oemCloudSession.ts",
    "src/lib/api/oemCloudRuntime.ts",
    "public/oem-runtime-config.js",
  ])
    expect(existsSync(join(root, retired)), retired).toBe(false);
  const violations: string[] = [];
  const scan = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "test") scan(file);
      } else if (
        /\.[jt]sx?$/.test(entry.name) &&
        !/test|spec/i.test(entry.name)
      ) {
        const source = readFileSync(file, "utf8");
        if (
          /oemCloudSession|lime:oem-cloud-session:v1|__LIME_OEM_CLOUD__|__LIME_SESSION_TOKEN__|__LIME_BOOTSTRAP__|VITE_OEM_SESSION_TOKEN|runtime\.sessionToken/.test(
            source,
          )
        ) {
          violations.push(file);
        }
      }
    }
  };
  scan(join(root, "src"));
  expect(readFileSync(join(root, "index.html"), "utf8")).not.toContain(
    "oem-runtime-config",
  );
  expect(violations).toEqual([]);
});
