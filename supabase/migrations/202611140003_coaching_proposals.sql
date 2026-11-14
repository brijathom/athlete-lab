-- Stage 3B.2: proposals are immutable server-created drafts. Only explicit decisions
-- can change future, uncompleted sessions; historical workout rows are never written.
create table public.coach_proposals (
  owner_id uuid not null, id uuid not null, request_id uuid not null, conversation_id uuid not null,
  payload jsonb not null, status text not null default 'pending' check(status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(), decided_at timestamptz,
  primary key(owner_id,id), foreign key(owner_id,request_id) references public.coach_turns(owner_id,request_id) on delete cascade
);
alter table public.coach_proposals enable row level security;
alter table public.coach_proposals force row level security;
create policy read_own_proposals on public.coach_proposals for select to authenticated using ((select auth.uid())=owner_id);
revoke all on public.coach_proposals from anon,authenticated;
grant select on public.coach_proposals to authenticated;
grant all on public.coach_proposals to service_role;

drop function public.coach_finish(uuid,uuid,jsonb,integer,integer,text);
create function public.coach_finish(actor uuid, request uuid, answer jsonb, input_count integer, output_count integer,
  failure text default null, proposal_list jsonb default '[]'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare item jsonb; conversation uuid;
begin
  if jsonb_typeof(proposal_list)<>'array' or jsonb_array_length(proposal_list)>1 then raise exception 'INVALID_PROPOSAL'; end if;
  update public.coach_turns set reply=answer, state=case when failure is null then 'completed' else 'failed' end,
    input_tokens=greatest(0,input_count), output_tokens=greatest(0,output_count), error_code=failure
    where owner_id=actor and request_id=request and state='running' returning conversation_id into conversation;
  if not found then raise exception 'REQUEST_UNAVAILABLE'; end if;
  for item in select value from jsonb_array_elements(proposal_list) loop
    if failure is not null or item->>'version'<>'1' or item->>'status'<>'pending' or jsonb_typeof(item->'changes')<>'array' or jsonb_array_length(item->'changes') not between 1 and 8 then raise exception 'INVALID_PROPOSAL'; end if;
    insert into public.coach_proposals(owner_id,id,request_id,conversation_id,payload) values(actor,(item->>'id')::uuid,request,conversation,item);
  end loop;
end;
$$;
revoke all on function public.coach_finish(uuid,uuid,jsonb,integer,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.coach_finish(uuid,uuid,jsonb,integer,integer,text,jsonb) to service_role;

create function public.coach_decide(proposal uuid, accept boolean, confirmed boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); draft public.coach_proposals; change jsonb; rev bigint; current_payload jsonb; after_value jsonb;
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  -- Same account lock as athlete_sync: CAS, completion guards and writes are atomic
  -- with concurrent devices' training edits and workout completions.
  perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
  select * into draft from public.coach_proposals where owner_id=actor and id=proposal for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if accept is null then raise exception 'APPROVAL_REQUIRED'; end if;
  if draft.status<>'pending' then return jsonb_build_object('status',draft.status,'alreadyDecided',true); end if;
  if not accept then
    update public.coach_proposals set status='rejected',decided_at=now() where owner_id=actor and id=proposal;
    return jsonb_build_object('status','rejected','alreadyDecided',false);
  end if;
  if confirmed is distinct from true then raise exception 'APPROVAL_REQUIRED'; end if;
  if (draft.payload->>'expiresAt')::timestamptz <= now() then raise exception 'STALE_PROPOSAL'; end if;
  select revision into rev from public.athlete_records where owner_id=actor and kind='programme' and id=draft.payload->>'programmeId' and payload is not null;
  if rev is distinct from (draft.payload->>'programmeRevision')::bigint then raise exception 'STALE_PROPOSAL'; end if;
  select revision,payload into rev,current_payload from public.athlete_records where owner_id=actor and kind='preferences' and id='singleton';
  if rev is distinct from (draft.payload->>'preferencesRevision')::bigint or current_payload->>'activeProgrammeId' is distinct from draft.payload->>'programmeId' then raise exception 'STALE_PROPOSAL'; end if;
  for change in select value from jsonb_array_elements(draft.payload->'changes') loop
    select revision,payload into rev,current_payload from public.athlete_records where owner_id=actor and kind='session' and id=change->>'id';
    if coalesce(rev,0)<>(change->>'expectedRevision')::bigint or coalesce(current_payload,'null'::jsonb)<>change->'before' then raise exception 'STALE_PROPOSAL'; end if;
    if exists(select 1 from public.athlete_records where owner_id=actor and kind='workout' and payload->>'sessionId'=change->>'id') then raise exception 'HISTORY_PROTECTED'; end if;
    after_value:=nullif(change->'after','null'::jsonb);
    if after_value is not null and (after_value->>'id' is distinct from change->>'id' or after_value->>'programmeId' is distinct from draft.payload->>'programmeId') then raise exception 'INVALID_PROPOSAL'; end if;
  end loop;
  for change in select value from jsonb_array_elements(draft.payload->'changes') loop
    insert into public.athlete_records(owner_id,kind,id,revision,payload)
      values(actor,'session',change->>'id',(change->>'expectedRevision')::bigint+1,nullif(change->'after','null'::jsonb))
      on conflict(owner_id,kind,id) do update set revision=excluded.revision,payload=excluded.payload,updated_at=now();
  end loop;
  update public.coach_proposals set status='approved',decided_at=now() where owner_id=actor and id=proposal;
  return jsonb_build_object('status','approved','alreadyDecided',false);
end;
$$;
revoke all on function public.coach_decide(uuid,boolean,boolean) from public,anon;
grant execute on function public.coach_decide(uuid,boolean,boolean) to authenticated;
