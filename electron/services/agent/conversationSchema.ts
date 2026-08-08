import type Database from 'better-sqlite3'

interface LegacyMessageRow {
  id: number
  conversation_id: number
  role?: string
  content?: string
  blocks_json?: string
  ui_message_json?: string
  created_at: number
}

function legacyParts(row: LegacyMessageRow): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = []
  const blocksJson = String(row.blocks_json || '').trim()
  if (blocksJson) {
    try {
      const blocks = JSON.parse(blocksJson)
      if (Array.isArray(blocks)) {
        for (const block of blocks) {
          if (!block || typeof block !== 'object') continue
          const value = block as { type?: unknown; text?: unknown }
          const text = typeof value.text === 'string' ? value.text : ''
          if (!text) continue
          if (value.type === 'thinking') parts.push({ type: 'reasoning', text })
          if (value.type === 'text') parts.push({ type: 'text', text })
        }
      }
    } catch {
      // Fall back to the legacy text column.
    }
  }

  const content = String(row.content || '')
  if (content && !parts.some((part) => part.type === 'text')) {
    parts.push({ type: 'text', text: content })
  }
  return parts
}

function toLegacyUiMessageJson(row: LegacyMessageRow): string {
  const existing = String(row.ui_message_json || '').trim()
  if (existing) {
    try {
      const parsed = JSON.parse(existing)
      if (parsed && typeof parsed === 'object') return existing
    } catch {
      // Fall back to the legacy text column.
    }
  }
  const role = row.role === 'user' || row.role === 'assistant' || row.role === 'system'
    ? row.role
    : 'assistant'
  return JSON.stringify({
    id: `legacy-${row.id}`,
    role,
    parts: legacyParts(row),
  })
}

export function ensureAgentConversationSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL,
      scope_kind TEXT NOT NULL,
      session_id TEXT,
      display_name TEXT,
      title TEXT NOT NULL,
      model_provider TEXT NOT NULL DEFAULT '',
      model_id TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'app',
      external_id TEXT,
      memory_context_isolated INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      ui_message_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(conversation_id) REFERENCES agent_conversations(id) ON DELETE CASCADE
    );

    DROP TABLE IF EXISTS agent_raw_responses;

    -- 聊天摘要缓存：同一会话+时间范围只保留最新一份，重新生成即覆盖
    CREATE TABLE IF NOT EXISTS chat_summaries (
      account_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      range_key TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (account_id, session_id, range_key)
    );
  `)

  // CREATE TABLE IF NOT EXISTS does not add new columns to an existing database.
  const names = new Set((db.prepare('PRAGMA table_info(agent_conversations)').all() as Array<{ name: string }>)
    .map((column) => column.name))
  if (!names.has('account_id')) {
    db.exec("ALTER TABLE agent_conversations ADD COLUMN account_id TEXT NOT NULL DEFAULT 'default'")
  }
  db.exec("UPDATE agent_conversations SET account_id = 'default' WHERE account_id IS NULL OR trim(account_id) = ''")
  if (!names.has('scope_kind')) {
    db.exec("ALTER TABLE agent_conversations ADD COLUMN scope_kind TEXT NOT NULL DEFAULT 'global'")
  }
  if (!names.has('session_id')) {
    db.exec('ALTER TABLE agent_conversations ADD COLUMN session_id TEXT')
  }
  if (!names.has('display_name')) {
    db.exec('ALTER TABLE agent_conversations ADD COLUMN display_name TEXT')
  }
  if (!names.has('model_provider')) {
    db.exec("ALTER TABLE agent_conversations ADD COLUMN model_provider TEXT NOT NULL DEFAULT ''")
  }
  if (!names.has('model_id')) {
    db.exec("ALTER TABLE agent_conversations ADD COLUMN model_id TEXT NOT NULL DEFAULT ''")
  }
  if (!names.has('source')) {
    db.exec("ALTER TABLE agent_conversations ADD COLUMN source TEXT NOT NULL DEFAULT 'app'")
  }
  if (!names.has('external_id')) {
    db.exec('ALTER TABLE agent_conversations ADD COLUMN external_id TEXT')
  }
  if (!names.has('memory_context_isolated')) {
    db.exec('ALTER TABLE agent_conversations ADD COLUMN memory_context_isolated INTEGER NOT NULL DEFAULT 0')
  }

  const messageNames = new Set((db.prepare('PRAGMA table_info(agent_messages)').all() as Array<{ name: string }>)
    .map((column) => column.name))
  if (messageNames.has('content')) {
    const uiMessageColumn = messageNames.has('ui_message_json') ? 'ui_message_json' : "'' AS ui_message_json"
    const blocksColumn = messageNames.has('blocks_json') ? 'blocks_json' : "'' AS blocks_json"
    const legacyRows = db.prepare(`
      SELECT id, conversation_id, role, content, ${blocksColumn}, ${uiMessageColumn}, created_at
      FROM agent_messages
      ORDER BY id ASC
    `).all() as LegacyMessageRow[]

    db.transaction((rows: LegacyMessageRow[]) => {
      db.exec(`
        ALTER TABLE agent_messages RENAME TO agent_messages_legacy;
        CREATE TABLE agent_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          conversation_id INTEGER NOT NULL,
          role TEXT NOT NULL,
          ui_message_json TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          FOREIGN KEY(conversation_id) REFERENCES agent_conversations(id) ON DELETE CASCADE
        );
      `)
      const insertMessage = db.prepare(`
        INSERT INTO agent_messages (id, conversation_id, role, ui_message_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      for (const row of rows) {
        insertMessage.run(
          row.id,
          row.conversation_id,
          String(row.role || 'assistant'),
          toLegacyUiMessageJson(row),
          Number(row.created_at || Date.now()),
        )
      }
      db.exec('DROP TABLE agent_messages_legacy')
    })(legacyRows)
  } else if (!messageNames.has('ui_message_json')) {
    db.exec("ALTER TABLE agent_messages ADD COLUMN ui_message_json TEXT NOT NULL DEFAULT ''")
  }

  // Indexes must be created after all legacy columns exist.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_agent_conv_account_scope
      ON agent_conversations(account_id, scope_kind, session_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_conv_source
      ON agent_conversations(account_id, source, external_id);
    CREATE INDEX IF NOT EXISTS idx_agent_msg_conv
      ON agent_messages(conversation_id, created_at ASC, id ASC);
  `)

  db.exec(`
    UPDATE agent_conversations
    SET scope_kind = 'persona',
        session_id = substr(external_id, instr(external_id, ':') + 1)
    WHERE source = 'wechat-persona'
      AND scope_kind = 'global'
      AND external_id LIKE '%:%'
      AND session_id IS NULL
  `)
}
