begin;

create role wj_web_app login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
alter role wj_web_app set statement_timeout = '5s';

create schema wj_web;
revoke all on schema wj_web from public, anon, authenticated;
grant usage on schema wj_web to wj_web_app;

create table wj_web.session (
    id text primary key,
    account_id uuid not null references auth.users (id) on delete cascade,
    payload text not null,
    expires_at timestamptz not null,
    generation integer not null default 0,
    lock_owner text,
    lock_until timestamptz,
    check ((lock_owner is null) = (lock_until is null))
);
create index wj_web_session_account on wj_web.session (account_id);
create index wj_web_session_expiration on wj_web.session (expires_at);

create table wj_web.otp_challenge (
    id text primary key,
    payload text not null,
    expires_at timestamptz not null
);
create index wj_web_challenge_expiration on wj_web.otp_challenge (expires_at);

create table wj_web.auth_rate_limit (
    id text primary key,
    hits integer not null check (hits > 0),
    expires_at timestamptz not null
);
create index wj_web_rate_expiration on wj_web.auth_rate_limit (expires_at);

create table wj_web.consent (
    account_id uuid not null references auth.users (id) on delete cascade,
    terms_version text not null,
    accepted_at timestamptz not null default now(),
    primary key (account_id, terms_version)
);
create index wj_web_consent_expiration on wj_web.consent (accepted_at);

revoke all on all tables in schema wj_web from public, anon, authenticated;
grant select, insert, update, delete on wj_web.session to wj_web_app;
grant select, insert, delete on wj_web.otp_challenge to wj_web_app;
grant select, insert, update on wj_web.auth_rate_limit to wj_web_app;
grant select, insert on wj_web.consent to wj_web_app;

alter table wj_web.session enable row level security;
alter table wj_web.otp_challenge enable row level security;
alter table wj_web.auth_rate_limit enable row level security;
alter table wj_web.consent enable row level security;
create policy runtime_session on wj_web.session to wj_web_app using (true) with check (true);
create policy runtime_challenge on wj_web.otp_challenge to wj_web_app using (true) with check (true);
create policy runtime_rate_limit on wj_web.auth_rate_limit to wj_web_app using (true) with check (true);
create policy runtime_consent on wj_web.consent to wj_web_app using (true) with check (true);

create function wj_web.purge_expired() returns void
language sql
set search_path = pg_catalog
as $body$
    delete from wj_web.session where expires_at <= now();
    delete from wj_web.otp_challenge where expires_at <= now();
    delete from wj_web.auth_rate_limit where expires_at <= now();
    delete from wj_web.consent where accepted_at <= now() - interval '365 days';
$body$;

revoke all on function wj_web.purge_expired() from public, anon, authenticated;

-- Standalone Postgres fixtures provide the cleanup function without installing pg_cron.
do $schedule$
begin
    if exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_cron') then
        create extension if not exists pg_cron;
        perform cron.schedule('wj-web-expiration', '*/10 * * * *', 'select wj_web.purge_expired()');
    end if;
end
$schedule$;

commit;
