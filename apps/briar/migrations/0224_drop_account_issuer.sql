-- BR-7477: better-auth 1.7.3+ no longer writes the `account.issuer` column,
-- and the official 1.7 upgrade guide instructs dropping it together with the
-- (issuer, accountId) unique index. Existing rows keep no meaningful issuer
-- data: 1.7.0-1.7.2 wrote the provider issuer URL, which 1.7.3+ never reads.
-- This is a schema-only change; it rewrites no account rows.
drop index if exists "account_issuer_accountId_uidx";
alter table "account" drop column "issuer";
