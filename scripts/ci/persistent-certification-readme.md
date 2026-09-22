# Persistent certification database

The Railway Testing PostgreSQL database is separate from production. Existing deterministic CI continues to use disposable local PostgreSQL. Never use a production database URL for a persistent campaign.
