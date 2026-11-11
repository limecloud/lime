#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  normalizeVersion,
  selectNMinusOneVersion,
} from "./lib/windows-squirrel-n-minus-one.mjs";

const candidateVersion = process.argv[2];
const repository = process.env.GITHUB_REPOSITORY;
const requested = process.argv[3]?.trim();
if (!repository) throw new Error("GITHUB_REPOSITORY is required");

const pages = JSON.parse(
  execFileSync(
    "gh",
    [
      "api",
      "--paginate",
      "--slurp",
      `repos/${repository}/releases?per_page=100`,
    ],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  ),
);
const releases = pages
  .flat()
  .filter(
    (release) =>
      !requested || release.tag_name === `v${normalizeVersion(requested)}`,
  );
process.stdout.write(selectNMinusOneVersion({ candidateVersion, releases }));
