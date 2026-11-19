export async function refreshRanking(db: D1Database, scheduledTime: number): Promise<void> {
  const time = Math.floor(scheduledTime / 1000);
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO rank_entries(generated_at,position,story_id)
      SELECT ?, row_number() OVER (ORDER BY score DESC, created_at DESC, id DESC), id FROM (
        SELECT id, created_at, (1 + vote_count) / pow(2 + (? - created_at) / 3600.0, 1.5) AS score
        FROM stories WHERE state = 'visible' AND created_at BETWEEN ? - 604800 AND ?
        ORDER BY score DESC, created_at DESC, id DESC LIMIT 300
      ) WHERE NOT EXISTS (SELECT 1 FROM rank_generations WHERE generated_at = ?)
      `).bind(time, time, time, time, time),
    db.prepare('INSERT OR IGNORE INTO rank_generations VALUES (?)').bind(time),
    db.prepare('DELETE FROM rank_generations WHERE generated_at < ? - 3600').bind(time),
    db.prepare('DELETE FROM login_challenges WHERE digest IN (SELECT digest FROM login_challenges WHERE expires_at <= ? LIMIT 100)').bind(time),
    db.prepare('DELETE FROM sessions WHERE digest IN (SELECT digest FROM sessions WHERE expires_at <= ? LIMIT 100)').bind(time),
  ]);
}
