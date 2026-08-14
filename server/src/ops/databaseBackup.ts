import Database from "better-sqlite3";
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const REQUIRED_TABLES = [
  "chat_requests",
  "brief_requests",
  "invites",
  "kv",
  "messages",
  "password_resets",
  "records",
  "sessions",
  "sync_changes",
  "users",
] as const;

export interface DatabaseVerification {
  integrity: "ok";
  tables: string[];
  counts: Record<(typeof REQUIRED_TABLES)[number], number>;
}

function integrityResult(database: Database.Database): string[] {
  return (
    database.prepare("PRAGMA integrity_check").all() as {
      integrity_check: string;
    }[]
  ).map((row) => row.integrity_check);
}

export function inspectDatabase(databasePath: string): DatabaseVerification {
  const database = new Database(databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    const integrity = integrityResult(database);
    if (integrity.length !== 1 || integrity[0] !== "ok") {
      throw new Error(`integrity_check failed: ${integrity.join("; ")}`);
    }

    const tables = (
      database
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all() as { name: string }[]
    ).map((row) => row.name);
    const missing = REQUIRED_TABLES.filter((table) => !tables.includes(table));
    if (missing.length > 0) {
      throw new Error(`required tables missing: ${missing.join(", ")}`);
    }

    const counts = Object.fromEntries(
      REQUIRED_TABLES.map((table) => {
        const row = database
          .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
          .get() as { count: number };
        return [table, row.count];
      }),
    ) as DatabaseVerification["counts"];
    return { integrity: "ok", tables, counts };
  } finally {
    database.close();
  }
}

export async function createOnlineBackup(
  sourcePath: string,
  outputPath: string,
): Promise<DatabaseVerification> {
  const source = resolve(sourcePath);
  const output = resolve(outputPath);
  if (source === output) throw new Error("backup output must differ from source");
  if (!existsSync(source)) throw new Error(`source database not found: ${source}`);
  if (existsSync(output)) throw new Error(`refusing to overwrite: ${output}`);

  mkdirSync(dirname(output), { recursive: true });
  const database = new Database(source, { readonly: true, fileMustExist: true });
  try {
    await database.backup(output);
  } catch (error) {
    rmSync(output, { force: true });
    throw error;
  } finally {
    database.close();
  }

  try {
    // The source uses WAL in production. Normalize the closed snapshot to a
    // single-file journal mode so the downloaded artifact never depends on a
    // sibling -wal file.
    const snapshot = new Database(output, { fileMustExist: true });
    try {
      snapshot.pragma("wal_checkpoint(TRUNCATE)");
      snapshot.pragma("journal_mode = DELETE");
    } finally {
      snapshot.close();
    }
    return inspectDatabase(output);
  } catch (error) {
    rmSync(output, { force: true });
    throw error;
  }
}

export function verifyRestoreCandidate(
  candidatePath: string,
): DatabaseVerification {
  const candidate = resolve(candidatePath);
  if (!existsSync(candidate)) {
    throw new Error(`restore candidate not found: ${candidate}`);
  }

  const workspace = mkdtempSync(join(tmpdir(), "babyone-restore-check-"));
  const disposableCopy = join(workspace, basename(candidate));
  try {
    // A supported backup is a self-contained SQLite file. Copying that closed
    // artifact is safe; unlike copying a live WAL-mode production main file.
    copyFileSync(candidate, disposableCopy);
    return inspectDatabase(disposableCopy);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

function argumentValue(args: string[], flag: string): string {
  const index = args.indexOf(flag);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value) throw new Error(`missing required ${flag}`);
  return value;
}

async function main(args: string[]): Promise<void> {
  const [command, ...options] = args;
  let report: DatabaseVerification;
  if (command === "backup") {
    const source = argumentValue(options, "--source");
    const output = argumentValue(options, "--output");
    report = await createOnlineBackup(source, output);
    console.log(`Created verified SQLite backup: ${resolve(output)}`);
  } else if (command === "verify-restore") {
    const candidate = argumentValue(options, "--file");
    report = verifyRestoreCandidate(candidate);
    console.log(`Verified disposable restore copy of: ${resolve(candidate)}`);
  } else {
    throw new Error(
      "usage: databaseBackup.js backup --source <db> --output <db> | verify-restore --file <db>",
    );
  }
  console.log(JSON.stringify(report, null, 2));
}

const isCli =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isCli) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
