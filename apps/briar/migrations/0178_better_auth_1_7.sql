-- Better Auth 1.7 keys accounts by (issuer, accountId). Rebuild the SQLite
-- table so issuer is required while preserving every provider account ID.
create table "account_better_auth_1_7" (
  "id" text primary key not null,
  "issuer" text not null,
  "accountId" text not null,
  "providerId" text not null,
  "userId" text not null references "user" ("id") on delete cascade,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" text,
  "refreshTokenExpiresAt" text,
  "scope" text,
  "password" text,
  "createdAt" text not null,
  "updatedAt" text not null
);

insert into "account_better_auth_1_7" (
  "id", "issuer", "accountId", "providerId", "userId",
  "accessToken", "refreshToken", "idToken", "accessTokenExpiresAt",
  "refreshTokenExpiresAt", "scope", "password", "createdAt", "updatedAt"
)
select
  "id",
  case "providerId"
    when 'credential' then 'local:credential'
    when 'google' then 'https://accounts.google.com'
  end,
  case "providerId"
    when 'credential' then "userId"
    else "accountId"
  end,
  "providerId", "userId", "accessToken", "refreshToken", "idToken",
  "accessTokenExpiresAt", "refreshTokenExpiresAt", "scope", "password",
  "createdAt", "updatedAt"
from "account";

drop table "account";
alter table "account_better_auth_1_7" rename to "account";

create index "account_userId_idx" on "account" ("userId");
create unique index "account_issuer_accountId_uidx"
  on "account" ("issuer", "accountId");

-- 1.7 requires both device-code lookup values to be unique. Keep one pending
-- authorization if legacy data contains a duplicate, then enforce the rule.
delete from "deviceCode"
where "id" not in (
  select min("id") from "deviceCode" group by "deviceCode"
);
delete from "deviceCode"
where "id" not in (
  select min("id") from "deviceCode" group by "userCode"
);

drop index "deviceCode_deviceCode_idx";
drop index "deviceCode_userCode_idx";
create unique index "deviceCode_deviceCode_uidx"
  on "deviceCode" ("deviceCode");
create unique index "deviceCode_userCode_uidx"
  on "deviceCode" ("userCode");
