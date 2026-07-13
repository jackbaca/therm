import { Database } from "bun:sqlite"
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { hermesPath } from "../../src/service/hermes-home"
import { resetKanban } from "../../src/service/hermes-kanban"
import { resetWrites } from "../../src/service/kanban-write"

export function schema(db: Database) {
  db.run(`CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY, title TEXT, body TEXT, assignee TEXT,
    status TEXT, priority INTEGER DEFAULT 0, tenant TEXT,
    block_kind TEXT, block_recurrences INTEGER DEFAULT 0,
    created_at INTEGER, started_at INTEGER, completed_at INTEGER,
    result TEXT, last_spawn_error TEXT, worker_pid INTEGER,
    workspace_kind TEXT, workspace_path TEXT,
    skills TEXT, max_runtime_seconds INTEGER
  )`)
  db.run(`CREATE TABLE IF NOT EXISTS task_links (
    parent_id TEXT, child_id TEXT, PRIMARY KEY (parent_id, child_id))`)
  db.run(`CREATE TABLE IF NOT EXISTS task_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT,
    author TEXT, body TEXT, created_at INTEGER)`)
  db.run(`CREATE TABLE IF NOT EXISTS task_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, run_id INTEGER,
    kind TEXT, payload TEXT, created_at INTEGER)`)
  db.run(`CREATE TABLE IF NOT EXISTS task_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, profile TEXT,
    status TEXT, outcome TEXT, started_at INTEGER, ended_at INTEGER,
    summary TEXT, error TEXT, worker_pid INTEGER)`)
  db.run(`CREATE TABLE IF NOT EXISTS task_attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT,
    filename TEXT, stored_path TEXT, content_type TEXT,
    size INTEGER, uploaded_by TEXT, created_at INTEGER)`)
}

export function clear() {
  resetWrites()
  resetKanban()
  delete process.env.HERMES_KANBAN_BOARD
  delete process.env.HERMES_KANBAN_ATTACHMENTS_ROOT
  rmSync(hermesPath("kanban"), { recursive: true, force: true })
  mkdirSync(hermesPath("."), { recursive: true })
  for (const name of readdirSync(hermesPath("."), { withFileTypes: true })) {
    if (!name.name.startsWith("kanban.db")) continue
    rmSync(hermesPath(name.name), { recursive: name.isDirectory(), force: true })
  }
}

export function seed(now: number) {
  clear()
  mkdirSync(hermesPath("profiles/researcher"), { recursive: true })
  mkdirSync(hermesPath("profiles/writer"), { recursive: true })
  mkdirSync(hermesPath("kanban/logs"), { recursive: true })
  writeFileSync(hermesPath("kanban/logs/t2.log"), "boot\nstep 1\nstep 2\n")

  const db = new Database(hermesPath("kanban.db"), { create: true })
  schema(db)
  const ins = db.prepare(
    `INSERT INTO tasks (id, title, body, assignee, status,
       priority, created_at, started_at, completed_at, result, worker_pid)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  ins.run("t1", "research cost", "Compare infra costs", "researcher",
    "ready", 3, now - 3600, null, null, null, null)
  ins.run("t2", "research perf", null, "researcher",
    "running", 3, now - 1800, now - 60, null, null, 4242)
  ins.run("t3", "synthesize", "merge findings", "analyst",
    "todo", 2, now - 900, null, null, null, null)
  ins.run("t4", "draft memo", null, "writer",
    "done", 1, now - 7200, now - 7100, now - 7000, "memo.md written", null)
  ins.run("t5", "need decision", "rate limit keying", "researcher",
    "blocked", 2, now - 600, now - 500, null, null, null)
  ins.run("t0", "one-liner idea", null, null,
    "triage", 0, now - 200, null, null, null, null)
  db.run("INSERT INTO task_links (parent_id, child_id) VALUES ('t1','t3'),('t2','t3')")
  db.run("INSERT INTO task_comments (task_id, author, body, created_at) VALUES (?,?,?,?)",
    ["t1", "kaio", "check AWS reserved pricing too", now - 1000])
  mkdirSync(hermesPath("kanban/attachments/t1"), { recursive: true })
  const blob = hermesPath("kanban/attachments/t1/spec.pdf")
  writeFileSync(blob, "pdf bytes")
  db.run(`INSERT INTO task_attachments
    (task_id, filename, stored_path, content_type, size, uploaded_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ["t1", "spec.pdf", blob, "application/pdf", 9, "kaio", now - 900])
  db.close()

  mkdirSync(hermesPath("kanban/boards/atm10/logs"), { recursive: true })
  writeFileSync(hermesPath("kanban/boards/atm10/board.json"),
    JSON.stringify({ display_name: "ATM10 Server" }))
  writeFileSync(hermesPath("kanban/boards/atm10/logs/m1.log"), "mod boot\n")
  const alt = new Database(hermesPath("kanban/boards/atm10/kanban.db"), { create: true })
  schema(alt)
  alt.run(
    `INSERT INTO tasks (id, title, status, priority, created_at)
     VALUES ('m1', 'upgrade forge', 'ready', 1, ?)`, [now - 100],
  )
  mkdirSync(hermesPath("kanban/boards/atm10/attachments/m1"), { recursive: true })
  const mod = hermesPath("kanban/boards/atm10/attachments/m1/modpack.txt")
  writeFileSync(mod, "modpack")
  alt.run(`INSERT INTO task_attachments
    (task_id, filename, stored_path, content_type, size, uploaded_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ["m1", "modpack.txt", mod, "text/plain", 7, "kaio", now - 50])
  alt.close()

  mkdirSync(hermesPath("kanban/boards/zeta"), { recursive: true })
  resetKanban()
}
