-- RPYM D1 Database Schema - Users Table
-- Run with: wrangler d1 execute rpym-db --file=./migrations/0002_users.sql

-- Admin users table
CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT DEFAULT 'admin',  -- 'admin' | 'viewer'
    created_at TEXT DEFAULT (datetime('now')),
    last_login TEXT
);

-- Sessions table for secure authentication
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE CASCADE
);

-- Index for session expiry cleanup
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
