// 自检：chat_summaries 建表 / 读写 / 覆盖 / 主键隔离
const Database = require('better-sqlite3')
const assert = require('assert')
const { existsSync, unlinkSync } = require('fs')

const DB = 'C:/Users/30402/AppData/Local/Temp/smoke-chat-summary.db'
for (const f of [DB, DB + '-wal', DB + '-shm']) if (existsSync(f)) unlinkSync(f)

const db = new Database(DB)
db.exec(`
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

const save = (accountId, sessionId, rangeKey, displayName, content, now) => db.prepare(`
  INSERT INTO chat_summaries (account_id, session_id, range_key, display_name, content, created_at, updated_at)
  VALUES (@accountId, @sessionId, @rangeKey, @displayName, @content, @now, @now)
  ON CONFLICT(account_id, session_id, range_key) DO UPDATE SET
    display_name = excluded.display_name,
    content = excluded.content,
    updated_at = excluded.updated_at
`).run({ accountId, sessionId, rangeKey, displayName, content, now })

const get = (accountId, sessionId, rangeKey) => db.prepare(`
  SELECT display_name AS displayName, content, created_at AS createdAt, updated_at AS updatedAt
  FROM chat_summaries WHERE account_id = ? AND session_id = ? AND range_key = ?
`).get(accountId, sessionId, rangeKey)

// 1. 空库读不到
assert.strictEqual(get('acc1', 'wxid_a', '今天'), undefined, '空库应读不到')

// 2. 写入后读得到
save('acc1', 'wxid_a', '今天', '张三', '摘要 v1', 1000)
assert.strictEqual(get('acc1', 'wxid_a', '今天').content, '摘要 v1')

// 3. 覆盖：内容更新、created_at 保留、updated_at 前进
save('acc1', 'wxid_a', '今天', '张三', '摘要 v2', 2000)
const after = get('acc1', 'wxid_a', '今天')
assert.strictEqual(after.content, '摘要 v2', '重新生成应覆盖')
assert.strictEqual(after.createdAt, 1000, '首次生成时间应保留')
assert.strictEqual(after.updatedAt, 2000, '更新时间应前进')
assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM chat_summaries').get().c, 1, '覆盖不应产生新行')

// 4. 不同 range / 不同会话 / 不同账号互不干扰
save('acc1', 'wxid_a', '本周', '张三', '本周摘要', 3000)
save('acc1', 'wxid_b', '今天', '李四', '李四摘要', 3000)
save('acc2', 'wxid_a', '今天', '张三', '另一账号摘要', 3000)
assert.strictEqual(get('acc1', 'wxid_a', '今天').content, '摘要 v2', 'range 不应串')
assert.strictEqual(get('acc1', 'wxid_b', '今天').content, '李四摘要', '会话不应串')
assert.strictEqual(get('acc2', 'wxid_a', '今天').content, '另一账号摘要', '账号不应串')
assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM chat_summaries').get().c, 4)

db.close()
for (const f of [DB, DB + '-wal', DB + '-shm']) if (existsSync(f)) unlinkSync(f)
console.log('OK: chat_summaries 建表/读写/覆盖/隔离 全部通过')
