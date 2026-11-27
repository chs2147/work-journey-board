\set ON_ERROR_STOP on
-- Run in a new disposable Postgres database named wj_kanban_test.
do $$begin
  if current_database() <> 'wj_kanban_test' then raise exception 'DISPOSABLE_KANBAN_DB_REQUIRED'; end if;
end$$;

create role anon;
create role authenticated;
create role service_role;
create schema wjb_gateway;
create schema wjb_migration;
create schema wjb_sync;
create table wjb_gateway.workspace (id uuid primary key, owner_id uuid);
create table wjb_gateway.device (id uuid primary key, user_id uuid, session_id uuid, revoked boolean default false);
create table wjb_migration.workspace_header (job_id uuid primary key, value jsonb);
create table wjb_sync.space (workspace_id uuid primary key, owner_id uuid, job_id uuid, tables text[], seq bigint default 0);
create table wjb_sync.record (
  workspace_id uuid, table_name text, record_key text, value jsonb, rev bigint, seq bigint,
  device_id uuid, updated_at timestamptz, primary key(workspace_id,table_name,record_key)
);
create table wjb_sync.applied (
  workspace_id uuid, op_id uuid, device_id uuid, request_hash text, result jsonb,
  created_at timestamptz default now(), primary key(workspace_id,op_id)
);
create function wjb_migration.keys_exact(v jsonb, expected text[]) returns boolean language sql as $$
  select coalesce(jsonb_typeof(v) = 'object' and
    (select array_agg(k order by k) from jsonb_object_keys(v) k) =
    (select array_agg(k order by k) from unnest(expected) k),false);
$$;
create function public.wjb_v2_session_active(actor uuid, session uuid) returns boolean language sql as $$
  select exists(select 1 from wjb_gateway.device where user_id=actor and session_id=session and not revoked);
$$;
create function public.wjb_v2_workspace_sync(p_request jsonb) returns jsonb language sql as $$ select '{}'::jsonb $$;
create function wjb_sync.refs_ready(uuid, jsonb) returns boolean language sql as $$ select false $$;
create function wjb_sync.ensure_space(ws uuid, actor uuid) returns wjb_sync.space language plpgsql as $$
declare result wjb_sync.space;
begin
  select * into result from wjb_sync.space where workspace_id=ws and owner_id=actor;
  if not found then raise exception 'SYNC_NOT_FOUND'; end if;
  return result;
end$$;

\ir ../../../poc/v2-migration/postgres/022-workspace-sync-retention.sql
\ir ../migrations/20261127230850_wjb_web_kanban_move.sql

insert into wjb_gateway.workspace values ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001');
insert into wjb_gateway.device values
  ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',false),
  ('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000002',false);
insert into wjb_sync.space values (
  '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',array['entry_item','kanban_section','item_status_log'],0
);
insert into wjb_migration.workspace_header values ('50000000-0000-4000-8000-000000000001','{"sourceSchema":20}');
insert into wjb_sync.record (workspace_id,table_name,record_key,value,rev,seq)
select '10000000-0000-4000-8000-000000000001','entry_item',repeat(mark,64),
       jsonb_build_object('id',mark,'depth',depth,'seq',position,'category_id','category-1','date','2026-11-27',
          'flagged',flagged,'flag_done_at',done_at,'completion_was_flagged',0,'text','fixture'),0,0
from (values ('a',0,1,1,null),('b',1,2,1,null),('c',1,3,0,'2026-11-01T00:00:00.000Z'),
             ('d',0,4,0,null),('e',1,5,0,null)) input(mark,depth,position,flagged,done_at);
insert into wjb_sync.record (workspace_id,table_name,record_key,value,rev,seq) values (
  '10000000-0000-4000-8000-000000000001','kanban_section',repeat('f',64),'{"id":"monitoring","name":"모니터링"}',0,0
);

create function public.fixture_move_args(op uuid, revision bigint, destination text, caller integer default 1) returns jsonb
language sql as $$
select jsonb_build_object('action','push','userId','20000000-0000-4000-8000-00000000000'||caller,
  'sessionId','40000000-0000-4000-8000-00000000000'||caller,'deviceId','30000000-0000-4000-8000-00000000000'||caller,
  'params',jsonb_build_object('workspaceId','10000000-0000-4000-8000-000000000001','opId',op,
    'kanbanMove',jsonb_build_object('key',repeat('a',64),'baseRev',revision,'to',destination)))
$$;

do $test$
declare
  op1 uuid := '60000000-0000-4000-8000-000000000001';
  op2 uuid := '60000000-0000-4000-8000-000000000002';
  op3 uuid := '60000000-0000-4000-8000-000000000003';
  moved jsonb;
  desktop_push jsonb;
  head jsonb;
  child jsonb;
  history record;
begin
  assert not has_function_privilege('authenticated','public.wjb_v2_workspace_sync(jsonb)','EXECUTE');
  assert not has_function_privilege('service_role','wjb_sync.kanban_push(jsonb)','EXECUTE');
  assert (public.wjb_v2_workspace_sync(public.fixture_move_args(op1,0,'monitoring'))->>'applied')::boolean;
  assert (select value->>'kanban_section_id' from wjb_sync.record where record_key=repeat('a',64)) = 'monitoring';
  assert (public.wjb_v2_workspace_sync(public.fixture_move_args(op1,0,'monitoring'))->>'replayed')::boolean;
  assert not (public.wjb_v2_workspace_sync(public.fixture_move_args(op2,0,'done'))->>'applied')::boolean;
  update wjb_sync.record set value = jsonb_set(value, '{seq}', '4') where record_key=repeat('b',64);
  assert not (public.wjb_v2_workspace_sync(public.fixture_move_args(op2,1,'done'))->>'applied')::boolean;
  assert (select rev from wjb_sync.record where record_key=repeat('b',64)) = 0;
  update wjb_sync.record set value = jsonb_set(value, '{seq}', '2') where record_key=repeat('b',64);
  moved := public.wjb_v2_workspace_sync(public.fixture_move_args(op2,1,'done'));
  assert (moved->>'applied')::boolean and jsonb_array_length(moved->'records') = 3;
  select value into head from wjb_sync.record where record_key=repeat('a',64);
  select value into child from wjb_sync.record where record_key=repeat('b',64);
  assert head->>'flagged' = '0' and head->>'kanban_section_id' is null;
  assert child->>'flagged' = '0' and child->>'flag_done_at' = head->>'flag_done_at';
  assert (select value->>'flag_done_at' from wjb_sync.record where record_key=repeat('c',64)) = '2026-11-01T00:00:00.000Z';
  assert (select rev from wjb_sync.record where record_key=repeat('e',64)) = 0;
  assert (public.wjb_v2_workspace_sync(public.fixture_move_args(op3,2,'todo'))->>'applied')::boolean;
  assert (select value->>'flagged' from wjb_sync.record where record_key=repeat('b',64)) = '1';
  assert (select value->>'flag_done_at' from wjb_sync.record where record_key=repeat('c',64)) = '2026-11-01T00:00:00.000Z';
  assert (select count(*) from wjb_sync.record where table_name='item_status_log') = 3;
  for history in select record_key,value from wjb_sync.record where table_name='item_status_log' loop
    assert (history.value->>'id')::bigint between -4503599627370496 and -1;
    assert history.record_key = encode(sha256(convert_to('["item_status_log",['||(history.value->>'id')||']]', 'UTF8')), 'hex');
  end loop;
  begin
    perform public.wjb_v2_workspace_sync(public.fixture_move_args(op3,3,'done'));
    raise exception 'BAD_REPLAY_ALLOWED';
  exception when raise_exception then
    assert sqlerrm = 'SYNC_IDEMPOTENCY_MISMATCH';
  end;
  begin
    perform public.wjb_v2_workspace_sync(public.fixture_move_args(gen_random_uuid(),3,'done',2));
    raise exception 'FOREIGN_SPACE_ALLOWED';
  exception when raise_exception then
    assert sqlerrm = 'SYNC_NOT_FOUND';
  end;
  select jsonb_set(public.fixture_move_args(gen_random_uuid(),3,'done'), '{params}', jsonb_build_object(
    'workspaceId', workspace_id, 'opId', gen_random_uuid(), 'changes', jsonb_build_array(jsonb_build_object(
      'table', table_name, 'key', record_key, 'baseRev', rev, 'value', jsonb_set(value, '{text}', '"desktop edit"')
    ))
  )) into desktop_push from wjb_sync.record where record_key=repeat('a',64);
  assert (public.wjb_v2_workspace_sync(desktop_push)->>'applied')::boolean;
  assert (select value->>'text' from wjb_sync.record where record_key=repeat('a',64)) = 'desktop edit';
  raise notice 'Kanban moves, hierarchy, status log, revisions, replay and account isolation passed';
end;
$test$;

set role service_role;
do $$begin
  assert (public.wjb_v2_workspace_sync(public.fixture_move_args(
    '60000000-0000-4000-8000-000000000003',2,'todo'
  ))->>'replayed')::boolean;
end$$;
reset role;

select jsonb_build_object('key', record_key, 'value', value)
from wjb_sync.record where table_name = 'item_status_log' order by seq;
