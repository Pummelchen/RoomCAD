CREATE TABLE rooms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            version INTEGER NOT NULL,
            json TEXT NOT NULL,
            saved_at INTEGER NOT NULL,
            client_id TEXT,
            UNIQUE(name, version)
        );
CREATE TABLE sqlite_sequence(name,seq);
CREATE INDEX idx_rooms_name ON rooms(name);
