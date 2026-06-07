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
