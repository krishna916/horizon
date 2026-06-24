-- Allow nullable first_name and last_name on users table.
-- Names are collected during registration in a future story (profile management).
-- Registration (M0-001) only collects email and password.
ALTER TABLE users ALTER COLUMN first_name DROP NOT NULL;
ALTER TABLE users ALTER COLUMN last_name DROP NOT NULL;
