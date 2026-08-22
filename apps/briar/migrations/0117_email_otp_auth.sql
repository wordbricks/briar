create table "rateLimit" (
  "id" text primary key not null,
  "key" text not null unique,
  "count" integer not null,
  "lastRequest" integer not null
);

create unique index verification_sign_in_otp_unique_idx
  on verification (identifier)
  where identifier like 'sign-in-otp-%';

create table briar_auth_email_rate_limits (
  identifier_hash text primary key not null check (
    length(identifier_hash) = 64
    and identifier_hash not glob '*[^0-9a-f]*'
  ),
  window_started_at integer not null,
  count integer not null check (count between 1 and 5),
  last_sent_at integer not null,
  updated_at text not null
);

create index briar_auth_email_rate_limits_updated_idx
  on briar_auth_email_rate_limits (updated_at);
