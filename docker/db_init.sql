-- Blog Material You — database schema
-- Creates the blogyou database and required tables.

CREATE DATABASE IF NOT EXISTS blogyou
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE blogyou;

CREATE TABLE IF NOT EXISTS comments (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nick        VARCHAR(100)  NOT NULL,
    mail        VARCHAR(255)  NOT NULL,
    comment     TEXT          NOT NULL,
    link        VARCHAR(500)  NOT NULL DEFAULT '',
    ua          TEXT          NOT NULL DEFAULT '',
    pid         BIGINT UNSIGNED DEFAULT NULL,
    rid         BIGINT UNSIGNED DEFAULT NULL,
    at          VARCHAR(100)  DEFAULT NULL,
    url         VARCHAR(500)  NOT NULL,
    create_time INT UNSIGNED  NOT NULL,
    avatar      VARCHAR(500)  NOT NULL DEFAULT '',
    INDEX idx_url (url(191)),
    INDEX idx_create_time (create_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS talks (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    content     TEXT       NOT NULL,
    create_time INT UNSIGNED NOT NULL,
    INDEX idx_time (create_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create application user (replaces --skip-grant-tables)
DROP USER IF EXISTS 'blogyou'@'localhost';
CREATE USER 'blogyou'@'localhost' IDENTIFIED BY 'blog-db-pass-2025';
GRANT SELECT, INSERT, UPDATE, DELETE ON blogyou.* TO 'blogyou'@'localhost';
FLUSH PRIVILEGES;

-- ===== Tables migrated from file storage =====

-- Posts (was blog/posts/*.md)
CREATE TABLE IF NOT EXISTS posts (
    slug          VARCHAR(200) PRIMARY KEY,
    title         TEXT NOT NULL,
    content       LONGTEXT NOT NULL DEFAULT '',
    `date`        VARCHAR(20) NOT NULL DEFAULT '',
    tags          TEXT NOT NULL DEFAULT '[]',
    categories    TEXT NOT NULL DEFAULT '[]',
    cover         TEXT,
    archived      INT UNSIGNED NOT NULL DEFAULT 0,
    title_en      TEXT,
    content_en    LONGTEXT,
    tags_en       TEXT NOT NULL DEFAULT '[]',
    categories_en TEXT NOT NULL DEFAULT '[]',
    created_at    INT UNSIGNED NOT NULL,
    updated_at    INT UNSIGNED NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Pages (was blog/pages/*.md + *.en.json)
CREATE TABLE IF NOT EXISTS pages (
    slug        VARCHAR(100) PRIMARY KEY,
    title       TEXT NOT NULL,
    content     LONGTEXT NOT NULL DEFAULT '',
    title_en    TEXT,
    content_en  LONGTEXT,
    updated_at  INT UNSIGNED NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Friends (was blog/friends/*.md)
CREATE TABLE IF NOT EXISTS friends (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    title       VARCHAR(200) NOT NULL,
    descr       TEXT,
    title_en    VARCHAR(200),
    descr_en    TEXT,
    avatar      VARCHAR(500) DEFAULT '',
    url         VARCHAR(500) NOT NULL DEFAULT '#',
    sort_order  INT DEFAULT 0,
    created_at  INT UNSIGNED NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===== Old tables (migrated from JSON files) =====

-- Key-value config store (replaces admin.json, totp.json, imghost.json)
CREATE TABLE IF NOT EXISTS config (
    `key`       VARCHAR(100) PRIMARY KEY,
    `value`     TEXT NOT NULL,
    updated_at  INT UNSIGNED NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Email permissions (replaces auth/emails.json)
CREATE TABLE IF NOT EXISTS emails (
    email       VARCHAR(255) PRIMARY KEY,
    permissions TEXT NOT NULL DEFAULT '[]',
    created_at  INT UNSIGNED NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Pending registrations (replaces auth/pending.json)
CREATE TABLE IF NOT EXISTS pending_registrations (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    email       VARCHAR(255) NOT NULL,
    `name`      VARCHAR(100) NOT NULL DEFAULT '',
    created_at  INT UNSIGNED NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Calendar events (replaces calendar/events.json)
CREATE TABLE IF NOT EXISTS calendar_events (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    title       VARCHAR(255) NOT NULL DEFAULT '',
    `date`      VARCHAR(20) NOT NULL,
    description TEXT,
    color       VARCHAR(20) DEFAULT '',
    created_at  INT UNSIGNED NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Page English content (replaces pages/*.en.json)
CREATE TABLE IF NOT EXISTS page_content (
    slug        VARCHAR(100) PRIMARY KEY,
    content_en  TEXT,
    updated_at  INT UNSIGNED NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
