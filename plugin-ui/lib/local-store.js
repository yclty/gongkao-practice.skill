import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync, renameSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { homedir } from "node:os";

export const SCHEMA_VERSION = 1;
export const digest = (value) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
export const id = (prefix) => `${prefix}_${randomUUID()}`;
export const parse = (row) => row ? JSON.parse(row.json) : null;
export function fail(code, message) { throw Object.assign(new Error(message), { code }); }
export function dataRoot() {
  return resolve(process.env.GONGKAO_DATA_DIR || (process.platform === "win32" ? join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "GongkaoCoach", "data") : join(homedir(), ".local", "share", "gongkao-coach")));
}
export function atomicJson(path, value) {
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
  renameSync(temp, path);
}
export function transaction(db, work) {
  db.exec("BEGIN IMMEDIATE");
  try { const result = work(); db.exec("COMMIT"); return result; }
  catch (error) { db.exec("ROLLBACK"); throw error; }
}

function openDb(path, schema) {
  const db = new DatabaseSync(path, { timeout: 5000 });
  const version = db.prepare("PRAGMA user_version").get().user_version;
  if (version > SCHEMA_VERSION) { db.close(); fail("SCHEMA_NEWER", "个人数据版本高于程序版本，请安装兼容版本"); }
  db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
  if (version < SCHEMA_VERSION) transaction(db, () => { db.exec(schema); db.exec(`PRAGMA user_version=${SCHEMA_VERSION}`); });
  return db;
}

export class LocalStore {
  constructor(root = dataRoot()) {
    this.root = resolve(root);
    mkdirSync(join(this.root, "profiles"), { recursive: true, mode: 0o700 });
    this.registry = openDb(join(this.root, "registry.sqlite"), `
      CREATE TABLE IF NOT EXISTS learners(id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS bindings(id TEXT PRIMARY KEY, learner_id TEXT NOT NULL REFERENCES learners(id), goal_id TEXT NOT NULL);
    `);
    this.databases = new Map();
  }
  profile(learnerId) {
    if (!this.registry.prepare("SELECT id FROM learners WHERE id=?").get(learnerId)) fail("OWNER_MISMATCH", "学习档案不存在");
    if (this.databases.has(learnerId)) return this.databases.get(learnerId);
    const dir = join(this.root, "profiles", learnerId);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const db = openDb(join(dir, "learning.sqlite"), `
      CREATE TABLE IF NOT EXISTS goals(id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, goal_id TEXT NOT NULL REFERENCES goals(id), status TEXT NOT NULL, updated_at TEXT NOT NULL, json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS sessions_goal ON sessions(goal_id,status,updated_at);
      CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY, goal_id TEXT NOT NULL REFERENCES goals(id), session_id TEXT NOT NULL REFERENCES sessions(id), slot INTEGER NOT NULL, question_id TEXT NOT NULL, attempted_at TEXT NOT NULL, correct INTEGER NOT NULL, json TEXT NOT NULL, UNIQUE(session_id,slot));
      CREATE INDEX IF NOT EXISTS attempts_goal ON attempts(goal_id,attempted_at);
      CREATE TABLE IF NOT EXISTS requests(key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY, goal_id TEXT NOT NULL REFERENCES goals(id), json TEXT NOT NULL);
    `);
    this.databases.set(learnerId, db);
    return db;
  }
  list() {
    return this.registry.prepare("SELECT * FROM learners ORDER BY created_at").all().map((learner) => ({ ...learner, goals: this.profile(learner.id).prepare("SELECT id,json FROM goals").all().map((row) => ({ id: row.id, goal: JSON.parse(row.json).goal })) }));
  }
  createLearner(name) {
    if (typeof name !== "string" || !name.trim() || name.length > 80) fail("INVALID_INPUT", "请填写 1～80 字的档案名称");
    const learnerId = id("learner");
    this.registry.prepare("INSERT INTO learners VALUES(?,?,?)").run(learnerId, name.trim(), new Date().toISOString());
    this.profile(learnerId);
    return learnerId;
  }
  bind(learnerId, goalId) {
    const db = this.profile(learnerId);
    if (!db.prepare("SELECT id FROM goals WHERE id=?").get(goalId)) fail("OWNER_MISMATCH", "目标不属于所选档案");
    const bindingId = id("binding");
    this.registry.prepare("INSERT INTO bindings VALUES(?,?,?)").run(bindingId, learnerId, goalId);
    return { binding_id: bindingId, learner_id: learnerId, goal_id: goalId };
  }
  context(bindingId) {
    const binding = this.registry.prepare("SELECT * FROM bindings WHERE id=?").get(bindingId ?? "");
    if (!binding) fail("BINDING_REQUIRED", "请在本地网页选择或创建自己的学习档案，再使用返回的 binding_id");
    const db = this.profile(binding.learner_id);
    const state = parse(db.prepare("SELECT json FROM goals WHERE id=?").get(binding.goal_id));
    if (!state) fail("OWNER_MISMATCH", "绑定目标已失效，请重新选择");
    return { ...binding, db, state };
  }
  putState(db, goalId, state) { db.prepare("UPDATE goals SET json=? WHERE id=?").run(JSON.stringify(state), goalId); }
  getSession(context, sessionId) {
    const session = parse(context.db.prepare("SELECT json FROM sessions WHERE id=? AND goal_id=?").get(sessionId ?? "", context.goal_id));
    if (!session) fail("OWNER_MISMATCH", "训练不存在或不属于当前备考目标");
    return session;
  }
  putSession(db, session) {
    db.prepare("INSERT INTO sessions VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at,json=excluded.json").run(session.session_id, session.goal_id, session.status, session.updated_at, JSON.stringify(session));
  }
  write(bindingId, operation, input, work) {
    const context = this.context(bindingId);
    const key = input.idempotency_key;
    if (typeof key !== "string" || !key || key.length > 200) fail("INVALID_INPUT", "写请求需要 idempotency_key");
    const fingerprint = digest({ operation, input });
    return transaction(context.db, () => {
      const old = context.db.prepare("SELECT * FROM requests WHERE key=?").get(`${context.goal_id}:${key}`);
      if (old) { if (old.fingerprint !== fingerprint) fail("REVISION_CONFLICT", "同一请求键不能提交不同内容"); return JSON.parse(old.json); }
      context.state = parse(context.db.prepare("SELECT json FROM goals WHERE id=?").get(context.goal_id));
      const result = work(context);
      context.db.prepare("INSERT INTO requests VALUES(?,?,?)").run(`${context.goal_id}:${key}`, fingerprint, JSON.stringify(result));
      return result;
    });
  }
  backup(learnerId) {
    const db = this.profile(learnerId);
    const learner = this.registry.prepare("SELECT name FROM learners WHERE id=?").get(learnerId);
    const content = transaction(db, () => Object.fromEntries(["goals", "sessions", "attempts", "notes"].map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()])));
    const payload = { format: "gongkao-personal-backup", schema_version: SCHEMA_VERSION, created_at: new Date().toISOString(), name: learner.name, content };
    return { ...payload, checksum: digest(payload) };
  }
  autoBackup(learnerId, buildBackup = () => this.backup(learnerId)) {
    const dir = join(this.root, "profiles", learnerId, "backups");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, `${new Date().toISOString().slice(0,10)}.json`);
    if (!existsSync(path)) {
      const backup=buildBackup();atomicJson(path,backup);
      const monday=new Date();monday.setUTCDate(monday.getUTCDate()-((monday.getUTCDay()+6)%7));
      const weekly=join(dir,`weekly-${monday.toISOString().slice(0,10)}.json`);
      if(!existsSync(weekly))atomicJson(weekly,backup);
      for(const [pattern,keep] of [[/^\d{4}-\d{2}-\d{2}\.json$/,7],[/^weekly-\d{4}-\d{2}-\d{2}\.json$/,4]]) {
        const names=readdirSync(dir).filter((name)=>pattern.test(name)).sort().reverse();
        for(const name of names.slice(keep)) unlinkSync(join(dir,name));
      }
    }
  }
  restore(backup) {
    const { checksum, ...payload } = backup ?? {};
    if (payload.format !== "gongkao-personal-backup" || payload.schema_version !== SCHEMA_VERSION || digest(payload) !== checksum) fail("BACKUP_INVALID", "备份格式、版本或校验值错误，未修改现有档案");
    const content = payload.content;
    if (!["goals", "sessions", "attempts", "notes"].every((key) => Array.isArray(content?.[key]))) fail("BACKUP_INVALID", "备份表缺失");
    for (const row of content.goals) if (!parse(row)?.project_state_id || !row.id) fail("BACKUP_INVALID", "备份目标无效");
    const learnerId = this.createLearner(`${String(payload.name).slice(0,75)}（恢复）`);
    const db = this.profile(learnerId);
    try {
      transaction(db, () => {
        for (const row of content.goals) db.prepare("INSERT INTO goals VALUES(?,?)").run(row.id, row.json);
        for (const row of content.sessions) {const session=parse(row);session.learner_id=learnerId;db.prepare("INSERT INTO sessions VALUES(?,?,?,?,?)").run(row.id,row.goal_id,row.status,row.updated_at,JSON.stringify(session));}
        for (const row of content.attempts) db.prepare("INSERT INTO attempts VALUES(?,?,?,?,?,?,?,?)").run(row.id,row.goal_id,row.session_id,row.slot,row.question_id,row.attempted_at,row.correct,row.json);
        for (const row of content.notes) db.prepare("INSERT INTO notes VALUES(?,?,?)").run(row.id,row.goal_id,row.json);
      });
    } catch (error) { this.registry.prepare("DELETE FROM learners WHERE id=?").run(learnerId); throw error; }
    return { learner_id: learnerId, goals: content.goals.map((row) => row.id) };
  }
  close() { for (const db of this.databases.values()) db.close(); this.registry.close(); }
}
