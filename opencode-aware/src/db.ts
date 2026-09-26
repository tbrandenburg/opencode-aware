import { execFileSync } from "child_process"
import { Database } from "bun:sqlite"

export type SessionDatabaseInfo = {
  db_path: string
  schema: string
  session_id: string
  project_id: string
  directory: string
}

export type CommandRunner = (command: string, args: string[]) => string

const runCommand: CommandRunner = (command, args) =>
  execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })

export function resolveDbPath(run: CommandRunner = runCommand): string {
  const dbPath = run("opencode", ["debug", "paths", "db"]).trim()
  if (!dbPath) throw new Error("OpenCode returned an empty database path")
  return dbPath
}

export function getSessionDatabaseInfo(
  sessionID: string,
  dbPath: string,
): SessionDatabaseInfo {
  const db = new Database(dbPath, { readonly: true })
  try {
    const rows = db
      .query<{ name: string; sql: string }, []>(
        "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE '__drizzle%' ORDER BY name",
      )
      .all()
    const schema = rows.map((row) => row.sql).join("\n\n")
    const tableNames = new Set(rows.map((row) => row.name))
    for (const table of ["session_v2", "session_message"]) {
      if (!tableNames.has(table)) throw new Error(`Unsupported OpenCode database schema: missing ${table} table`)
    }

    const columns = db.query<{ name: string }, []>("PRAGMA table_info(session_v2)").all()
    const columnNames = new Set(columns.map((column) => column.name))
    for (const column of ["id", "project_id", "directory"]) {
      if (!columnNames.has(column)) {
        throw new Error(`Unsupported OpenCode database schema: session_v2.${column} is missing`)
      }
    }

    const row = db
      .query<{ project_id: string; directory: string }, [string]>(
        "SELECT project_id, directory FROM session_v2 WHERE id = ? LIMIT 1",
      )
      .get(sessionID)

    return {
      db_path: dbPath,
      schema,
      session_id: sessionID,
      project_id: row?.project_id ?? "",
      directory: row?.directory ?? "",
    }
  } finally {
    db.close()
  }
}
