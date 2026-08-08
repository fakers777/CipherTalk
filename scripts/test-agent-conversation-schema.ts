import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { ensureAgentConversationSchema } from '../electron/services/agent/conversationSchema.ts'

function columnNames(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
    .map((column) => column.name)
}

function testLegacySchema(): void {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(`
  CREATE TABLE agent_conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE agent_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    blocks_json TEXT,
    created_at INTEGER NOT NULL
  );

  INSERT INTO agent_conversations (
    title, created_at, updated_at
  ) VALUES ('历史对话', 1, 1);

  INSERT INTO agent_messages (
    conversation_id, role, content, blocks_json, created_at
  ) VALUES
    (1, 'user', '旧版消息', NULL, 1),
    (1, 'assistant', '旧版回复', '[{"type":"thinking","text":"旧版思考"},{"type":"text","text":"旧版回复"}]', 2);
  `)

  ensureAgentConversationSchema(db)
  ensureAgentConversationSchema(db)

  const columns = columnNames(db, 'agent_conversations')
  for (const name of [
    'account_id',
    'scope_kind',
    'session_id',
    'display_name',
    'model_provider',
    'model_id',
    'source',
    'external_id',
    'memory_context_isolated',
  ]) {
    assert.ok(columns.includes(name), `missing migrated column: ${name}`)
  }
  const legacyRow = db.prepare('SELECT account_id AS accountId, source FROM agent_conversations WHERE title = ?')
    .get('历史对话') as { accountId: string; source: string }
  assert.deepEqual(legacyRow, { accountId: 'default', source: 'app' })

  const legacyMessages = db.prepare('SELECT id, ui_message_json AS json FROM agent_messages ORDER BY id')
    .all() as Array<{ id: number; json: string }>
  assert.deepEqual(legacyMessages.map((row) => JSON.parse(row.json)), [
    {
      id: 'legacy-1',
      role: 'user',
      parts: [{ type: 'text', text: '旧版消息' }],
    },
    {
      id: 'legacy-2',
      role: 'assistant',
      parts: [
        { type: 'reasoning', text: '旧版思考' },
        { type: 'text', text: '旧版回复' },
      ],
    },
  ])

  assert.doesNotThrow(() => {
    db.prepare(`
    INSERT INTO agent_conversations (
      account_id, scope_kind, title, model_provider, model_id,
      source, memory_context_isolated, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('default', 'global', '旧库迁移测试', '', '', 'app', 0, 1, 1)
  })
  assert.doesNotThrow(() => {
    db.prepare(`
    INSERT INTO agent_messages (conversation_id, role, ui_message_json, created_at)
    VALUES (?, ?, ?, ?)
    `).run(2, 'user', JSON.stringify({ id: 'new-1', role: 'user', parts: [] }), 2)
  })

  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>
  assert.ok(indexes.some((index) => index.name === 'idx_agent_conv_account_scope'))
  assert.ok(indexes.some((index) => index.name === 'idx_agent_conv_source'))
  assert.equal(db.pragma('foreign_key_check').length, 0)
  db.close()
}

function testCurrentSchemaRemainsIntact(): void {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  ensureAgentConversationSchema(db)
  const json = JSON.stringify({ id: 'current-1', role: 'user', parts: [{ type: 'text', text: '当前消息' }] })
  db.prepare(`
    INSERT INTO agent_conversations (
      account_id, scope_kind, title, model_provider, model_id,
      source, memory_context_isolated, created_at, updated_at
    ) VALUES ('account-1', 'global', '当前对话', '', '', 'app', 0, 1, 1)
  `).run()
  db.prepare(`
    INSERT INTO agent_messages (conversation_id, role, ui_message_json, created_at)
    VALUES (1, 'user', ?, 1)
  `).run(json)

  ensureAgentConversationSchema(db)

  const row = db.prepare('SELECT account_id AS accountId FROM agent_conversations WHERE id = 1')
    .get() as { accountId: string }
  const message = db.prepare('SELECT ui_message_json AS json FROM agent_messages WHERE id = 1')
    .get() as { json: string }
  assert.equal(row.accountId, 'account-1')
  assert.equal(message.json, json)
  assert.equal(db.pragma('foreign_key_check').length, 0)
  db.close()
}

function testIntermediateConversationSchema(): void {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE agent_conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope_kind TEXT NOT NULL,
      session_id TEXT,
      display_name TEXT,
      title TEXT NOT NULL,
      model_provider TEXT NOT NULL DEFAULT '',
      model_id TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE agent_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      ui_message_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    INSERT INTO agent_conversations (
      scope_kind, title, model_provider, model_id, created_at, updated_at
    ) VALUES ('global', '中间版本对话', '', '', 1, 1);
  `)

  ensureAgentConversationSchema(db)
  const row = db.prepare(`
    SELECT account_id AS accountId, source, memory_context_isolated AS isolated
    FROM agent_conversations WHERE id = 1
  `).get() as { accountId: string; source: string; isolated: number }
  assert.deepEqual(row, { accountId: 'default', source: 'app', isolated: 0 })
  db.close()
}

testLegacySchema()
testCurrentSchemaRemainsIntact()
testIntermediateConversationSchema()
console.log('agent conversation schema migration tests passed')
