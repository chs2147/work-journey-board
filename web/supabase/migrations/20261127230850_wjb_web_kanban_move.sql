-- Add the browser's high-level Kanban move to the authenticated sync boundary.
-- Desktop clients continue to send their existing changes arrays.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table wjb_sync.applied add column kanban_request_hash text;

create function wjb_sync.kanban_push(request jsonb) returns jsonb
language plpgsql
set search_path = pg_catalog
as $move$
declare
    params jsonb := request->'params';
    command jsonb := params->'kanbanMove';
    ws uuid := (params->>'workspaceId')::uuid;
    actor uuid := (request->>'userId')::uuid;
    device uuid := (request->>'deviceId')::uuid;
    operation uuid;
    destination text := command->>'to';
    original text;
    original_name text;
    destination_name text;
    digest text;
    item wjb_sync.record;
    child wjb_sync.record;
    space wjb_sync.space;
    applied wjb_sync.applied;
    item_value jsonb;
    child_value jsonb;
    patches jsonb := '[]';
    outcome jsonb;
    happened_at text;
    next_head_seq integer;
    head_seq integer;
    history_id bigint;
    history_key text;
begin
    if not wjb_migration.keys_exact(params, array['workspaceId','opId','kanbanMove'])
       or not wjb_migration.keys_exact(command, array['key','baseRev','to'])
       or coalesce(command->>'key', '') !~ '^[a-f0-9]{64}$'
       or jsonb_typeof(command->'baseRev') is distinct from 'number'
       or coalesce(command->>'baseRev', '') !~ '^(0|[1-9][0-9]{0,17})$'
       or jsonb_typeof(command->'to') is distinct from 'string'
       or length(destination) not between 1 and 64 then
        raise exception 'SYNC_INVALID_CHANGE';
    end if;
    operation := (params->>'opId')::uuid;
    if operation is null then raise exception 'SYNC_INVALID_REQUEST'; end if;

    perform wjb_sync.ensure_space(ws, actor);
    -- Hold the same locks and in the same order as a normal desktop push.
    -- That keeps another device from inserting a child while the move is planned.
    perform 1 from wjb_gateway.workspace x where x.id = ws and x.owner_id = actor for update;
    select * into space from wjb_sync.space x where x.workspace_id = ws and x.owner_id = actor for update;
    if not found then raise exception 'SYNC_NOT_FOUND'; end if;
    if not exists (
        select 1 from wjb_migration.workspace_header x
        where x.job_id = space.job_id and x.value->>'sourceSchema' = '20'
    ) then raise exception 'SYNC_INVALID_CHANGE'; end if;

    digest := encode(sha256(convert_to(params::text, 'UTF8')), 'hex');
    select * into applied from wjb_sync.applied x where x.workspace_id = ws and x.op_id = operation;
    if found then
        if applied.kanban_request_hash is distinct from digest or applied.device_id <> device then
            raise exception 'SYNC_IDEMPOTENCY_MISMATCH';
        end if;
        return applied.result || jsonb_build_object('replayed', true);
    end if;

    select * into item from wjb_sync.record x
    where x.workspace_id = ws and x.table_name = 'entry_item' and x.record_key = command->>'key'
      and x.value->>'depth' = '0';
    if not found or item.rev <> (command->>'baseRev')::bigint then
        return jsonb_build_object('applied', false, 'head', space.seq::text);
    end if;

    original := case
        when item.value->>'flagged' = '0' and item.value->>'flag_done_at' is not null then 'done'
        else coalesce(item.value->>'kanban_section_id', 'todo')
    end;
    if original = destination then
        return jsonb_build_object('applied', true, 'records', '[]'::jsonb, 'head', space.seq::text);
    end if;

    -- Resolve names from the current workspace, including historic names after section removal.
    original_name := case original when 'todo' then 'TODO' when 'done' then 'DONE' end;
    destination_name := case destination when 'todo' then 'TODO' when 'done' then 'DONE' end;
    if original_name is null then
        select x.value->>'name' into original_name from wjb_sync.record x
        where x.workspace_id = ws and x.table_name = 'kanban_section' and x.value->>'id' = original;
    end if;
    if destination_name is null then
        select x.value->>'name' into destination_name from wjb_sync.record x
        where x.workspace_id = ws and x.table_name = 'kanban_section' and x.value->>'id' = destination;
        if destination_name is null then raise exception 'SYNC_INVALID_CHANGE'; end if;
    end if;

    happened_at := to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    item_value := item.value || jsonb_build_object(
        'kanban_section_id', case when destination in ('todo','done') then null else destination end,
        'updated_at', happened_at
    );
    if destination = 'done' then
        item_value := item_value || jsonb_build_object(
            'completion_was_flagged', item.value->'flagged', 'flagged', 0, 'flag_done_at', happened_at
        );
    elsif original = 'done' then
        item_value := item_value || jsonb_build_object(
            'flagged', coalesce(item.value->'completion_was_flagged', '1'::jsonb), 'flag_done_at', null
        );
    end if;
    patches := jsonb_build_array(jsonb_build_object(
        'table', 'entry_item', 'key', item.record_key, 'baseRev', item.rev, 'value', item_value
    ));

    if destination = 'done' or original = 'done' then
        head_seq := (item.value->>'seq')::integer;
        select min((x.value->>'seq')::integer) into next_head_seq from wjb_sync.record x
        where x.workspace_id = ws and x.table_name = 'entry_item' and x.value->>'depth' = '0'
          and x.value->>'date' = item.value->>'date' and x.value->>'category_id' = item.value->>'category_id'
          and (x.value->>'seq')::integer > head_seq;
        -- A tied position at either head makes child ownership ambiguous across devices.
        if exists (
            select 1 from wjb_sync.record x
            where x.workspace_id = ws and x.table_name = 'entry_item'
              and x.value->>'date' = item.value->>'date' and x.value->>'category_id' = item.value->>'category_id'
              and (x.value->>'seq')::integer in (head_seq, next_head_seq)
            group by x.value->>'seq' having count(*) > 1
        ) then return jsonb_build_object('applied', false, 'head', space.seq::text); end if;
        for child in
            select x.* from wjb_sync.record x
            where x.workspace_id = ws and x.table_name = 'entry_item' and x.value->>'depth' = '1'
              and x.value->>'date' = item.value->>'date' and x.value->>'category_id' = item.value->>'category_id'
              and (x.value->>'seq')::integer > head_seq
              and (next_head_seq is null or (x.value->>'seq')::integer < next_head_seq)
            order by (x.value->>'seq')::integer, x.record_key
        loop
            if destination = 'done' then
                if child.value->>'flagged' = '0' and child.value->>'flag_done_at' is not null then continue; end if;
                child_value := child.value || jsonb_build_object(
                    'completion_was_flagged', child.value->'flagged', 'flagged', 0,
                    'flag_done_at', happened_at, 'updated_at', happened_at
                );
            else
                if child.value->>'flagged' is distinct from '0'
                   or (child.value->>'flag_done_at') is distinct from (item.value->>'flag_done_at') then continue; end if;
                child_value := child.value || jsonb_build_object(
                    'flagged', coalesce(child.value->'completion_was_flagged', '1'::jsonb),
                    'flag_done_at', null, 'updated_at', happened_at
                );
            end if;
            patches := patches || jsonb_build_array(jsonb_build_object(
                'table', 'entry_item', 'key', child.record_key, 'baseRev', child.rev, 'value', child_value
            ));
        end loop;
    end if;

    -- Use a safe negative SQLite integer, outside its positive AUTOINCREMENT range.
    -- The key uses the same canonical [table, [primary key]] encoding as the desktop mapper.
    history_id := -1 - ('x' || substr(encode(sha256(convert_to(operation::text, 'UTF8')), 'hex'), 1, 13))::bit(52)::bigint;
    history_key := encode(sha256(convert_to('["item_status_log",[' || history_id::text || ']]', 'UTF8')), 'hex');
    patches := patches || jsonb_build_array(jsonb_build_object(
        'table', 'item_status_log', 'key', history_key, 'baseRev', null, 'value', jsonb_build_object(
            'id', history_id, 'item_id', item.value->>'id', 'from_key', original,
            'from_name', coalesce(original_name, '(지운 섹션)'), 'to_key', destination,
            'to_name', destination_name, 'changed_at', happened_at, 'source', 'kanban', 'batch_id', null
        )
    ));
    -- Delegate validation, quotas, revision writes, sequence and receipt retention to desktop push.
    outcome := public.wjb_v2_workspace_sync(jsonb_set(request, '{params}', jsonb_build_object(
        'workspaceId', ws, 'opId', operation, 'changes', patches
    )));
    if outcome->>'applied' = 'true' then
        update wjb_sync.applied x set kanban_request_hash = digest
        where x.workspace_id = ws and x.op_id = operation;
    end if;
    return outcome;
end
$move$;

revoke all on function wjb_sync.kanban_push(jsonb) from public, anon, authenticated, service_role;

do $install$
declare
    baseline text := pg_get_functiondef('public.wjb_v2_workspace_sync(jsonb)'::regprocedure);
    anchor text := $sql$ IF NOT wjb_migration.keys_exact(p,ARRAY['workspaceId','opId','changes'])$sql$;
begin
    if strpos(baseline, anchor) = 0 or strpos(baseline, 'wjb_sync.kanban_push') > 0 then
        raise exception 'SYNC_KANBAN_BASELINE_MISMATCH';
    end if;
    execute replace(baseline, anchor,
        ' IF p ? ''kanbanMove'' THEN RETURN wjb_sync.kanban_push(p_request); END IF;' || chr(10) || anchor);
end
$install$;

commit;
