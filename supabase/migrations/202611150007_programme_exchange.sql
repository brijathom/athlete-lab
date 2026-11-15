-- Batch programme proposals reuse the existing authenticated tool approval boundary.
-- No history is rewritten. All changes and audit events commit atomically.
begin;
alter table public.athlete_tool_drafts drop constraint athlete_tool_drafts_operation_check;
alter table public.athlete_tool_drafts add constraint athlete_tool_drafts_operation_check check(operation in ('workout','update','log','programme'));
create or replace function public.athlete_tool_stage(actor uuid, request_key text, request_fingerprint text, draft jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare existing public.athlete_tool_drafts; item public.athlete_tool_drafts;
begin
  perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
  if not exists(select 1 from public.athlete_tool_grants where owner_id=actor and enabled and allow_drafts and expires_at>now()) then raise exception 'PERMISSION_REQUIRED'; end if;
  select * into existing from public.athlete_tool_drafts where owner_id=actor and idempotency_key=request_key;
  if found then
    if existing.fingerprint is distinct from request_fingerprint then raise exception 'REQUEST_REUSED'; end if;
    return existing.payload || jsonb_build_object('status',existing.status);
  end if;
  if (select count(*) from public.athlete_tool_drafts where owner_id=actor and created_at>now()-interval '1 day') >= 200 then raise exception 'TOOL_LIMIT'; end if;
  if draft->>'status' is distinct from 'pending' or jsonb_typeof(draft->'changes') is distinct from 'array' or jsonb_array_length(draft->'changes') not between 1 and 182 or (draft->>'expiresAt')::timestamptz<=now() or (draft->>'expiresAt')::timestamptz>now()+interval '25 hours' then raise exception 'INVALID_DRAFT'; end if;
  insert into public.athlete_tool_drafts(owner_id,id,idempotency_key,fingerprint,payload,operation,expires_at)
    values(actor,(draft->>'id')::uuid,request_key,request_fingerprint,draft,draft->>'operation',(draft->>'expiresAt')::timestamptz) returning * into item;
  insert into public.athlete_tool_audit(owner_id,draft_id,event,operation) values(actor,item.id,'staged',item.operation);
  return item.payload;
end; $$;
revoke all on function public.athlete_tool_stage(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.athlete_tool_stage(uuid,text,text,jsonb) to service_role;

create or replace function public.athlete_tool_decide(draft_id uuid, accept boolean, confirmed boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); draft public.athlete_tool_drafts; item jsonb; current_revision bigint; current_payload jsonb; changed_session text;
begin
  if actor is null or public.athlete_tool_client()<>'' then raise exception 'AUTH_REQUIRED'; end if;
  if accept is null or (accept and confirmed is distinct from true) then raise exception 'APPROVAL_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
  select * into draft from public.athlete_tool_drafts where owner_id=actor and id=draft_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if draft.status<>'pending' then return jsonb_build_object('status',draft.status,'alreadyDecided',true); end if;
  if accept then
    if draft.expires_at<=now() then raise exception 'STALE_DRAFT'; end if;
    if not exists(select 1 from public.athlete_tool_grants where owner_id=actor and enabled and allow_drafts and expires_at>now()) then raise exception 'PERMISSION_REQUIRED'; end if;
    for item in select value from jsonb_array_elements(draft.payload->'guards') loop
      select revision,payload into current_revision,current_payload from public.athlete_records where owner_id=actor and kind=split_part(item->>'key',':',1) and id=substr(item->>'key',strpos(item->>'key',':')+1);
      if coalesce(current_revision,0) is distinct from (item->>'revision')::bigint or coalesce(current_payload,'null'::jsonb) is distinct from item->'payload' then raise exception 'STALE_DRAFT'; end if;
    end loop;
    for item in select value from jsonb_array_elements(draft.payload->'changes') loop
      if (draft.operation='programme' and item->>'kind' not in ('session','programme','preferences')) or (draft.operation='log' and item->>'kind' is distinct from 'workout') or (draft.operation not in ('log','programme') and item->>'kind' is distinct from 'session') then raise exception 'INVALID_DRAFT'; end if;
      select revision into current_revision from public.athlete_records where owner_id=actor and kind=item->>'kind' and id=item->>'id';
      if coalesce(current_revision,0) is distinct from (item->>'expected_revision')::bigint then raise exception 'STALE_DRAFT'; end if;
      if item->>'kind'='preferences' and item->>'id'<>'singleton' then raise exception 'INVALID_DRAFT'; end if;
      changed_session:=case when draft.operation='log' then item->'payload'->>'sessionId' else item->>'id' end;
      if (item->>'kind' in ('session','workout')) and exists(select 1 from public.athlete_records where owner_id=actor and ((kind='workout' and payload->>'sessionId'=changed_session) or (kind='match' and payload->>'fixtureId'=changed_session))) then raise exception 'HISTORY_PROTECTED'; end if;
      if draft.operation='log' and (coalesce(current_revision,0)<>0 or (item->'payload'->>'date')::date>current_date) then raise exception 'HISTORY_PROTECTED'; end if;
      if draft.operation<>'log' and item->>'kind'='session' and (item->'payload'->>'date')::date<current_date then raise exception 'STALE_DRAFT'; end if;
    end loop;
    for item in select value from jsonb_array_elements(draft.payload->'changes') loop
      insert into public.athlete_records(owner_id,kind,id,revision,payload) values(actor,item->>'kind',item->>'id',(item->>'expected_revision')::bigint+1,item->'payload')
      on conflict(owner_id,kind,id) do update set revision=excluded.revision,payload=excluded.payload,updated_at=now();
    end loop;
  end if;
  update public.athlete_tool_drafts set status=case when accept then 'approved' else 'rejected' end where owner_id=actor and id=draft_id;
  insert into public.athlete_tool_audit(owner_id,draft_id,event,operation) values(actor,draft_id,case when accept then 'approved' else 'rejected' end,draft.operation);
  return jsonb_build_object('status',case when accept then 'approved' else 'rejected' end,'alreadyDecided',false);
end; $$;
revoke all on function public.athlete_tool_decide(uuid,boolean,boolean) from public,anon;
grant execute on function public.athlete_tool_decide(uuid,boolean,boolean) to authenticated;
commit;
