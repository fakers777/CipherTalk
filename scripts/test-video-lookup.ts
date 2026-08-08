import assert from 'node:assert/strict'
import { buildVideoCacheKey } from '../src/pages/chat/components/messageBubble/videoCacheKey.ts'
import { selectUniqueVideoCandidate } from '../electron/services/videoLookupUtils.ts'

const base = {
  sessionId: 'alice',
  localId: 42,
  serverId: 100,
  createTime: 1700000000,
  sortSeq: 200
}

assert.equal(
  buildVideoCacheKey({ ...base, videoMd5: 'ABCDEF0123456789ABCDEF0123456789' }),
  'abcdef0123456789abcdef0123456789',
  'valid MD5 keys should be normalized'
)
assert.notEqual(
  buildVideoCacheKey(base),
  buildVideoCacheKey({ ...base, sessionId: 'bob' }),
  'no-MD5 keys must be isolated by session'
)
assert.notEqual(
  buildVideoCacheKey(base),
  buildVideoCacheKey({ ...base, localId: 43 }),
  'no-MD5 keys must be isolated by message identity'
)
assert.equal(selectUniqueVideoCandidate([{ fileName: 'only.mp4' }])?.fileName, 'only.mp4')
assert.equal(selectUniqueVideoCandidate([{ fileName: 'a.mp4' }, { fileName: 'b.mp4' }]), undefined)

console.log('video lookup tests passed')
