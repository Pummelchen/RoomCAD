-- RoomCAD database structure.
--
-- STRUCTURE ONLY, deliberately. This file used to carry a full dump of two
-- saved rooms — real designs, with real ids and real save timestamps — in a
-- repository that is public, even though the live site itself sits behind a
-- password. Anyone could read the project's work without ever logging in.
--
-- Restore the structure from here and the content from a server-side backup of
-- rooms.db:
--
--   sqlite3 /var/roomcad/rooms.db < rooms.db.sql
--
-- There is deliberately no DROP TABLE: this restores into an empty file, which
-- is what rebuilding a lost VPS means. Run against an existing database it
-- stops on the first CREATE TABLE rather than overwriting live data.
--
-- Keep this in step with init_db() in server.py, which is what actually creates
-- the schema at boot. This file is documentation and a rebuild aid, not a
-- migration path.
PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE rooms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            version INTEGER NOT NULL,
            json TEXT NOT NULL,
            saved_at INTEGER NOT NULL,
            client_id TEXT,
            UNIQUE(name, version)
        );
CREATE TABLE browser_sessions (
            token_hash TEXT PRIMARY KEY,
            last_room_name TEXT,
            last_room_version INTEGER,
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL
        );
CREATE INDEX idx_rooms_name ON rooms(name);
CREATE INDEX idx_browser_sessions_expiry ON browser_sessions(expires_at);
COMMIT;
