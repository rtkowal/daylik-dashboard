CREATE TABLE IF NOT EXISTS decisions (
  brief_id TEXT NOT NULL,
  topic_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  decision TEXT,
  notes TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (brief_id, topic_id, user_name)
);
CREATE INDEX IF NOT EXISTS idx_decisions_brief ON decisions(brief_id);
