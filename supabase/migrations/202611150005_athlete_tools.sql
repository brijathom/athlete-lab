-- Separate tool permissions, immutable drafts and content-free audit events.
-- No existing training records are rewritten. OAuth clients cannot bypass tools
-- by calling the general sync RPC or reading the underlying personal-data tables.
BEGIN;
create function public.athlete_tool_client() returns text language sql stable set search_path='' as $$
  select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'client_id','')
$$;
create table public.athlete_tool_grants (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false, allow_drafts boolean not null default false,
  sharing jsonb not null, expires_at timestamptz not null, updated_at timestamptz not null default now()
);
create table public.athlete_tool_drafts (
  owner_id uuid not null references auth.users(id) on delete cascade, id uuid not null,
  idempotency_key text not null check(length(idempotency_key) between 8 and 100),
  fingerprint text not null check(length(fingerprint)=64), payload jsonb not null,
  operation text not null check(operation in ('workout','update','log')),
  status text not null default 'pending' check(status in ('pending','approved','rejected')),
  expires_at timestamptz not null, created_at timestamptz not null default now(),
  primary key(owner_id,id), unique(owner_id,idempotency_key)
);
create table public.athlete_tool_audit (
  owner_id uuid not null references auth.users(id) on delete cascade, draft_id uuid not null,
  event text not null check(event in ('staged','approved','rejected')), operation text not null,
  created_at timestamptz not null default now(), primary key(owner_id,draft_id,event)
);
alter table public.athlete_tool_grants enable row level security;
alter table public.athlete_tool_grants force row level security;
alter table public.athlete_tool_drafts enable row level security;
alter table public.athlete_tool_drafts force row level security;
alter table public.athlete_tool_audit enable row level security;
alter table public.athlete_tool_audit force row level security;
create policy own_tool_grant on public.athlete_tool_grants for select to authenticated using(owner_id=auth.uid() and public.athlete_tool_client()='');
create policy own_tool_drafts on public.athlete_tool_drafts for select to authenticated using(owner_id=auth.uid() and public.athlete_tool_client()='');
create policy own_tool_audit on public.athlete_tool_audit for select to authenticated using(owner_id=auth.uid() and public.athlete_tool_client()='');
revoke all on public.athlete_tool_grants,public.athlete_tool_drafts,public.athlete_tool_audit from anon,authenticated;
grant select on public.athlete_tool_grants,public.athlete_tool_drafts,public.athlete_tool_audit to authenticated;
grant all on public.athlete_tool_grants,public.athlete_tool_drafts,public.athlete_tool_audit to service_role;

-- OAuth tool tokens must not gain raw recovery/history access or general writes.
create policy tool_oauth_records_guard on public.athlete_records as restrictive for all to authenticated using(public.athlete_tool_client()='') with check(public.athlete_tool_client()='');
create policy tool_oauth_chat_guard on public.coach_conversations as restrictive for all to authenticated using(public.athlete_tool_client()='') with check(public.athlete_tool_client()='');
create policy tool_oauth_turn_guard on public.coach_turns as restrictive for all to authenticated using(public.athlete_tool_client()='') with check(public.athlete_tool_client()='');
create policy tool_oauth_proposal_guard on public.coach_proposals as restrictive for all to authenticated using(public.athlete_tool_client()='') with check(public.athlete_tool_client()='');
alter function public.athlete_sync(jsonb) rename to athlete_sync_browser;
revoke all on function public.athlete_sync_browser(jsonb) from public,anon,authenticated;
create function public.athlete_sync(changes jsonb default '[]'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or public.athlete_tool_client()<>'' then raise exception 'AUTH_REQUIRED'; end if;
  return public.athlete_sync_browser(changes);
end; $$;
revoke all on function public.athlete_sync(jsonb) from public,anon;
grant execute on function public.athlete_sync(jsonb) to authenticated;
alter function public.coach_decide(uuid,boolean,boolean) rename to coach_decide_browser;
revoke all on function public.coach_decide_browser(uuid,boolean,boolean) from public,anon,authenticated;
create function public.coach_decide(proposal uuid,accept boolean,confirmed boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or public.athlete_tool_client()<>'' then raise exception 'AUTH_REQUIRED'; end if;
  return public.coach_decide_browser(proposal,accept,confirmed);
end; $$;
revoke all on function public.coach_decide(uuid,boolean,boolean) from public,anon;
grant execute on function public.coach_decide(uuid,boolean,boolean) to authenticated;

create function public.athlete_tool_permissions(enabled boolean, allow_drafts boolean, sharing jsonb, expires_at timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
  if actor is null or public.athlete_tool_client()<>'' then raise exception 'AUTH_REQUIRED'; end if;
  if enabled is null or allow_drafts is null or sharing is null or jsonb_typeof(sharing)<>'object' or expires_at is null or (enabled and (expires_at<=now() or expires_at>now()+interval '24 hours')) then raise exception 'INVALID_PERMISSION'; end if;
  insert into public.athlete_tool_grants(owner_id,enabled,allow_drafts,sharing,expires_at) values(actor,enabled,allow_drafts,sharing,expires_at)
  on conflict(owner_id) do update set enabled=excluded.enabled,allow_drafts=excluded.allow_drafts,sharing=excluded.sharing,expires_at=excluded.expires_at,updated_at=now();
end; $$;
revoke all on function public.athlete_tool_permissions(boolean,boolean,jsonb,timestamptz) from public,anon;
grant execute on function public.athlete_tool_permissions(boolean,boolean,jsonb,timestamptz) to authenticated;

-- Narrow server-only boundary for OAuth. The Edge verifies the JWT, client allowlist
-- and audience first, then supplies the verified subject. No arbitrary SQL or owner
-- identifier is exposed in a tool. Browser reads still use the user's RLS client.
create function public.athlete_tool_snapshot(actor uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.athlete_tool_grants where owner_id=actor and enabled and expires_at>now()) then raise exception 'PERMISSION_REQUIRED'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('kind',kind,'id',id,'revision',revision,'payload',payload)) from public.athlete_records where owner_id=actor),'[]'::jsonb);
end; $$;
revoke all on function public.athlete_tool_snapshot(uuid) from public,anon,authenticated;
grant execute on function public.athlete_tool_snapshot(uuid) to service_role;

create function public.athlete_tool_stage(actor uuid, request_key text, request_fingerprint text, draft jsonb)
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
  if draft->>'status' is distinct from 'pending' or jsonb_typeof(draft->'changes') is distinct from 'array' or jsonb_array_length(draft->'changes')<>1 or (draft->>'expiresAt')::timestamptz<=now() or (draft->>'expiresAt')::timestamptz>now()+interval '25 hours' then raise exception 'INVALID_DRAFT'; end if;
  insert into public.athlete_tool_drafts(owner_id,id,idempotency_key,fingerprint,payload,operation,expires_at)
    values(actor,(draft->>'id')::uuid,request_key,request_fingerprint,draft,draft->>'operation',(draft->>'expiresAt')::timestamptz) returning * into item;
  insert into public.athlete_tool_audit(owner_id,draft_id,event,operation) values(actor,item.id,'staged',item.operation);
  return item.payload;
end; $$;
revoke all on function public.athlete_tool_stage(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.athlete_tool_stage(uuid,text,text,jsonb) to service_role;

create function public.athlete_tool_decide(draft_id uuid, accept boolean, confirmed boolean default false)
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
      if (draft.operation='log' and item->>'kind' is distinct from 'workout') or (draft.operation<>'log' and item->>'kind' is distinct from 'session') then raise exception 'INVALID_DRAFT'; end if;
      select revision into current_revision from public.athlete_records where owner_id=actor and kind=item->>'kind' and id=item->>'id';
      if coalesce(current_revision,0) is distinct from (item->>'expected_revision')::bigint then raise exception 'STALE_DRAFT'; end if;
      changed_session:=case when draft.operation='log' then item->'payload'->>'sessionId' else item->>'id' end;
      if exists(select 1 from public.athlete_records where owner_id=actor and kind='workout' and payload->>'sessionId'=changed_session) then raise exception 'HISTORY_PROTECTED'; end if;
      if draft.operation='log' and (coalesce(current_revision,0)<>0 or (item->'payload'->>'date')::date>current_date) then raise exception 'HISTORY_PROTECTED'; end if;
      if draft.operation<>'log' and (item->'payload'->>'date')::date<current_date then raise exception 'STALE_DRAFT'; end if;
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
COMMIT;
