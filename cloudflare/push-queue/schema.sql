-- LOCAL DEVELOPMENT ONLY. No remote migration or production binding.
CREATE TABLE IF NOT EXISTS push_plans_v1 (
  owner_id TEXT NOT NULL, id TEXT NOT NULL, revision TEXT NOT NULL,
  payload TEXT NOT NULL, PRIMARY KEY(owner_id, id)
);
CREATE TABLE IF NOT EXISTS push_devices_v1 (
  owner_id TEXT NOT NULL, id TEXT NOT NULL, revision TEXT NOT NULL,
  subscription TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(owner_id, id)
);
CREATE TABLE IF NOT EXISTS push_jobs_v1 (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, plan_id TEXT NOT NULL,
  plan_revision TEXT NOT NULL, device_id TEXT NOT NULL, device_revision TEXT NOT NULL,
  due_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, next_at INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','claimed','sent','expired','failed','gone')),
  attempts INTEGER NOT NULL DEFAULT 0, lease TEXT, lease_until INTEGER,
  UNIQUE(owner_id, plan_id, plan_revision, device_id, device_revision, due_at)
);
CREATE INDEX IF NOT EXISTS push_jobs_due_v1 ON push_jobs_v1(state, next_at);
CREATE INDEX IF NOT EXISTS push_jobs_lease_v1 ON push_jobs_v1(state, lease_until);
CREATE INDEX IF NOT EXISTS push_jobs_plan_v1 ON push_jobs_v1(owner_id, plan_id);
CREATE INDEX IF NOT EXISTS push_jobs_device_v1 ON push_jobs_v1(owner_id, device_id);
