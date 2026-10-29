import { spawnSync } from "node:child_process";

if (!process.env.DOC_DESK_TEST_DATABASE_URL) {
  console.error("Set DOC_DESK_TEST_DATABASE_URL to a local disposable PostgreSQL database before running database tests.");
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ["--test", "tests/database-isolation.test.mjs"],
  { stdio: "inherit" },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
