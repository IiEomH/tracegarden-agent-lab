import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

export class Store {
  constructor(directory) {
    mkdirSync(directory, { recursive: true });
    const keyFile = join(directory, 'vault.key');
    try { this.key = readFileSync(keyFile); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.key = randomBytes(32);
      writeFileSync(keyFile, this.key, { flag: 'wx', mode: 0o600 });
    }
    this.db = new DatabaseSync(join(directory, 'workspace.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, project_id TEXT, data TEXT NOT NULL, PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS secrets (id TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  }
  list(kind, projectId) {
    const rows = projectId
      ? this.db.prepare('SELECT data FROM records WHERE kind=? AND project_id=? ORDER BY rowid').all(kind, projectId)
      : this.db.prepare('SELECT data FROM records WHERE kind=? ORDER BY rowid').all(kind);
    return rows.map(row => JSON.parse(row.data));
  }
  get(kind, id) {
    const row = this.db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get(kind, id);
    return row ? JSON.parse(row.data) : null;
  }
  put(kind, value) {
    this.db.prepare('INSERT INTO records(kind,id,project_id,data) VALUES (?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET project_id=excluded.project_id,data=excluded.data')
      .run(kind, value.id, value.projectId ?? null, JSON.stringify(value));
    return value;
  }
  delete(kind, id) { this.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind, id); }
  hasSecret(id) { return Boolean(this.db.prepare('SELECT id FROM secrets WHERE id=?').get(id)); }
  setSecret(id, value) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const payload = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
    this.db.prepare('INSERT INTO secrets(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(id, payload);
  }
  getSecret(id) {
    const row = this.db.prepare('SELECT value FROM secrets WHERE id=?').get(id);
    if (!row) return '';
    const payload = Buffer.from(row.value, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, payload.subarray(0, 12));
    decipher.setAuthTag(payload.subarray(12, 28));
    return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString('utf8');
  }
  deleteSecret(id) { this.db.prepare('DELETE FROM secrets WHERE id=?').run(id); }
  close() { this.db.close(); }
}
