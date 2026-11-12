/** Cloud installation must not outpace publication of its exact-version runtime. */
export function validateCloudGuestRelease(workflow) {
  const jobs = workflow?.jobs ?? {};
  const dependencies = (job) =>
    Array.isArray(job?.needs) ? job.needs : [job?.needs];
  if (
    !dependencies(jobs.publish_release_assets).includes("publish_cli_assets") ||
    !dependencies(jobs.publish_cli_assets).includes("prepare_release") ||
    dependencies(jobs.publish_cli_assets).includes("publish_release_assets") ||
    !dependencies(jobs.publish_cli_npm).includes("publish_release_assets")
  )
    throw new Error(
      "Cloud guest assets must be prepared before the release is published",
    );
  const steps = jobs.publish_cli_assets?.steps ?? [];
  const pack = steps.find(
    (step) =>
      step.name === "Package Linux cloud guest from the same release runtime",
  );
  const upload = steps.find(
    (step) => step.name === "Upload Linux cloud guest to GitHub Release",
  );
  const linuxOnly = "matrix.target == 'x86_64-unknown-linux-gnu'";
  if (
    pack?.if !== linuxOnly ||
    upload?.if !== linuxOnly ||
    !pack.run?.includes("scripts/app-server/linux-guest-release.mjs") ||
    !pack.run?.includes('/${{ matrix.target }}/release"') ||
    !upload.run?.includes('lime-guest-linux-x64-$VERSION.tar.gz"') ||
    !upload.run?.includes('lime-guest-linux-x64-$VERSION.tar.gz.json"') ||
    upload.run?.includes("--clobber")
  )
    throw new Error(
      "Cloud guest release must reuse the Linux runtime and preserve versioned assets",
    );
}
