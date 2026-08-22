alter table "user" add column "username" text;

create unique index "user_username_unique_idx"
  on "user" (lower("username"))
  where "username" is not null;
