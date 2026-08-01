CREATE TABLE IF NOT EXISTS alert_config_targets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alert_config_id INTEGER NOT NULL REFERENCES alert_configs(id) ON DELETE CASCADE,
    channel_type TEXT NOT NULL CHECK(channel_type <> ''),
    channel_target TEXT NOT NULL,
    UNIQUE(alert_config_id, channel_type, channel_target)
);

ALTER TABLE alerts_fired ADD COLUMN channel_type TEXT;
ALTER TABLE alerts_fired ADD COLUMN channel_target TEXT;
