CREATE TABLE rooms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            version INTEGER NOT NULL,
            json TEXT NOT NULL,
            saved_at INTEGER NOT NULL,
            client_id TEXT,
            UNIQUE(name, version)
        );
CREATE INDEX idx_rooms_name ON rooms(name);
CREATE TABLE browser_sessions (
            token_hash TEXT PRIMARY KEY,
            last_room_name TEXT,
            last_room_version INTEGER,
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL
        );
CREATE INDEX idx_browser_sessions_expiry ON browser_sessions(expires_at);
