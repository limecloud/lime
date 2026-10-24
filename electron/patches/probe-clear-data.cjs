const { app, session } = require("electron");
const { mkdirSync } = require("node:fs");
const { isAbsolute } = require("node:path");

const profilePath = process.argv[2];
if (!profilePath || !isAbsolute(profilePath)) {
  throw new Error(
    "Pass a new absolute directory for the isolated probe profile",
  );
}
// An existing directory is deliberately rejected, including any personal profile.
mkdirSync(profilePath);
app.setPath("userData", profilePath);
app.setPath("sessionData", profilePath);

app.whenReady().then(
  () => {
    const target = session.fromPartition("browser-data-binding-probe");
    const available = typeof target.clearDataSince === "function";
    process.stdout.write(
      `${JSON.stringify({
        status: available ? "binding-present" : "unsupported",
        electron: process.versions.electron,
        chromium: process.versions.chrome,
        persistent: target.isPersistent(),
        nativeMethod: "Session.clearDataSince",
        available,
        deletionExecuted: false,
        nativeRegressionExecuted: false,
      })}\n`,
    );
    app.exit(available ? 0 : 2);
  },
  (error) => {
    process.stderr.write(`${String(error)}\n`);
    app.exit(1);
  },
);
