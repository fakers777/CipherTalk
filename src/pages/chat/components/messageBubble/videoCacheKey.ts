export interface VideoCacheIdentity {
  sessionId: string
  localId: number
  serverId: number
  createTime: number
  sortSeq: number
  videoMd5?: string
}

export function buildVideoCacheKey(identity: VideoCacheIdentity): string {
  const md5 = identity.videoMd5?.trim()
  if (md5 && /^[a-f0-9]{32}$/i.test(md5)) return md5.toLowerCase()

  return [
    'local',
    identity.sessionId,
    identity.localId,
    identity.serverId,
    identity.createTime,
    identity.sortSeq
  ].join(':')
}
