// Starts a throwaway PostgreSQL on loopback, applies every migration, runs the
// given command with DATABASE_URL / DOC_DESK_TEST_DATABASE_URL pointing at it,
// then stops the server and deletes its data directory.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const command = process.argv.slice(2);
if (command.length === 0) {
  console.error("Usage: node scripts/with-test-db.mjs <command> [args...]");
  process.exit(2);
}

const port = Number(process.env.DOC_DESK_TEST_DB_PORT ?? 54329);
const user = "docdesk_test";
const password = "docdesk_test_pw";
const database = "docdesk_test";
const dataDir = mkdtempSync(join(tmpdir(), "docdesk-pg-"));

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user,
  password,
  port,
  persistent: false,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: () => {},
  onError: () => {},
});

let exitCode = 1;
try {
  await pg.initialise();
  await pg.start();
  await pg.createDatabase(database);

  const url = `postgresql://${user}:${password}@127.0.0.1:${port}/${database}`;
  const env = {
    ...process.env,
    DATABASE_URL: url,
    MIGRATION_DATABASE_URL: url,
    DOC_DESK_TEST_DATABASE_URL: url,
    DOC_DESK_MODE: "test",
  };
  const prismaCli = join("node_modules", "prisma", "build", "index.js");

  const migrate = spawnSync(process.execPath, [prismaCli, "migrate", "deploy"], { stdio: "inherit", env });
  if (migrate.status !== 0) throw new Error("Migrations failed on the disposable test database.");

  const run = spawnSync(command[0], command.slice(1), { stdio: "inherit", env });
  exitCode = run.status ?? 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
} finally {
  try { await pg.stop(); } catch { /* already stopped */ }
  rmSync(dataDir, { recursive: true, force: true });
}
process.exit(exitCode);
