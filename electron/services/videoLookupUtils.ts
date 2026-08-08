export function selectUniqueVideoCandidate<T>(rows: T[]): T | undefined {
  return rows.length === 1 ? rows[0] : undefined
}
