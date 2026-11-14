const EXPECTED_RELEASE_MATRIX = new Map([
  [
    "macOS-arm64",
    {
      arch: "arm64",
      feed: "darwin-arm64",
      forge_targets: "dmg,zip",
      host_platform: "darwin",
      platform: "macos-15",
      target: "aarch64-apple-darwin",
    },
  ],
  [
    "macOS-x64",
    {
      arch: "x64",
      feed: "darwin-x64",
      forge_targets: "dmg,zip",
      host_platform: "darwin",
      platform: "macos-15-intel",
      target: "x86_64-apple-darwin",
    },
  ],
  [
    "Windows-x64",
    {
      arch: "x64",
      feed: "win32-x64",
      forge_targets: "squirrel",
      host_platform: "win32",
      platform: "windows-2022",
      target: "x86_64-pc-windows-msvc",
    },
  ],
]);

export function validateReleaseMatrix(buildJob) {
  const matrix = buildJob?.strategy?.matrix?.include;
  if (!Array.isArray(matrix)) {
    throw new Error("release build job must define strategy.matrix.include");
  }
  for (const [name, fields] of EXPECTED_RELEASE_MATRIX) {
    const row = matrix.find((item) => item?.name === name);
    if (!row) {
      throw new Error(`release build matrix missing ${name}`);
    }
    for (const [key, value] of Object.entries(fields)) {
      if (row[key] !== value) {
        throw new Error(
          `release build matrix ${name}.${key} expected ${value}, got ${row[key]}`,
        );
      }
    }
  }
  if (matrix.length !== EXPECTED_RELEASE_MATRIX.size) {
    throw new Error(
      "release build matrix must contain only supported macOS and Windows targets",
    );
  }
}

export function validateCliReleaseMatrix(workflow) {
  const jobs = workflow?.jobs ?? {};
  const matrix = jobs.publish_cli_assets?.strategy?.matrix?.include;
  const expected = [
    [
      "macos-latest",
      "aarch64-apple-darwin",
      "lime-darwin-arm64",
      "darwin-arm64",
    ],
    ["macos-15-intel", "x86_64-apple-darwin", "lime-darwin-x64", "darwin-x64"],
    ["windows-2022", "x86_64-pc-windows-msvc", "lime-win32-x64", "win32-x64"],
  ];
  if (
    !Array.isArray(matrix) ||
    matrix.length !== expected.length ||
    expected.some(
      (fields) =>
        !matrix.some((row) =>
          ["platform", "target", "package", "npm_tag"].every(
            (key, index) => row?.[key] === fields[index],
          ),
        ),
    )
  ) {
    throw new Error(
      "CLI release matrix must contain only supported macOS and Windows targets",
    );
  }
  if (
    /(?:unknown-linux|lime-(?:npm-|guest-)?linux-|linux-guest-release\.mjs)/iu.test(
      JSON.stringify(jobs),
    )
  ) {
    throw new Error("release workflow must not publish Linux artifacts");
  }
  const dependencies = (job) =>
    Array.isArray(job?.needs) ? job.needs : [job?.needs];
  if (
    !dependencies(jobs.publish_release_assets).includes("publish_cli_assets") ||
    !dependencies(jobs.publish_cli_assets).includes("prepare_release") ||
    dependencies(jobs.publish_cli_assets).includes("publish_release_assets") ||
    !dependencies(jobs.publish_cli_npm).includes("publish_release_assets")
  ) {
    throw new Error(
      "CLI platform assets must be prepared before the release is published",
    );
  }
}
