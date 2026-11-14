-- Stage 3B.1: no training-write permissions are added by this migration.
create table public.coach_conversations (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null, title text not null check (length(title) between 1 and 100),
  created_at timestamptz not null default now(), primary key(owner_id,id)
);
create table public.coach_turns (
  owner_id uuid not null, request_id uuid not null, conversation_id uuid not null,
  question text not null check(length(question) between 1 and 1000), sharing jsonb not null,
  reply jsonb, state text not null default 'running' check(state in ('running','completed','failed')),
  model text not null, input_tokens integer not null default 0, output_tokens integer not null default 0,
  error_code text, created_at timestamptz not null default now(), primary key(owner_id,request_id),
  foreign key(owner_id,conversation_id) references public.coach_conversations(owner_id,id) on delete cascade
);
create table public.coach_usage (
  owner_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null, reserved_tokens integer not null check(reserved_tokens between 1 and 100000),
  created_at timestamptz not null default now(), primary key(owner_id,request_id)
);
create index coach_usage_time on public.coach_usage(created_at);
create index coach_turns_conversation on public.coach_turns(owner_id,conversation_id,created_at);
alter table public.coach_conversations enable row level security;
alter table public.coach_conversations force row level security;
alter table public.coach_turns enable row level security;
alter table public.coach_turns force row level security;
alter table public.coach_usage enable row level security;
alter table public.coach_usage force row level security;
create policy read_own_conversations on public.coach_conversations for select to authenticated using ((select auth.uid()) = owner_id);
create policy delete_own_conversations on public.coach_conversations for delete to authenticated using ((select auth.uid()) = owner_id);
create policy read_own_turns on public.coach_turns for select to authenticated using ((select auth.uid()) = owner_id);
create policy read_own_usage on public.coach_usage for select to authenticated using ((select auth.uid()) = owner_id);
revoke all on public.coach_conversations, public.coach_turns, public.coach_usage from anon, authenticated;
grant select, delete on public.coach_conversations to authenticated;
grant select on public.coach_turns, public.coach_usage to authenticated;
grant all on public.coach_conversations, public.coach_turns, public.coach_usage to service_role;

-- Trusted Edge Function only. The actor comes from verified getUser(), never request JSON.
create function public.coach_begin(actor uuid, request uuid, conversation uuid, create_conversation boolean,
  question_text text, share_options jsonb, model_name text, reservation integer, limits jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare existing public.coach_turns; result public.coach_turns; day_start timestamptz := date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
begin
  perform pg_advisory_xact_lock(hashtextextended('coach-global',0));
  select * into existing from public.coach_turns where owner_id=actor and request_id=request;
  if found then
    if existing.conversation_id <> conversation or existing.question <> question_text or existing.sharing <> share_options then raise exception 'REQUEST_REUSED'; end if;
    return jsonb_build_object('turn',to_jsonb(existing),'fresh',false);
  end if;
  if exists(select 1 from public.coach_usage where owner_id=actor and request_id=request) then raise exception 'REQUEST_REUSED'; end if;
  if actor is null or length(btrim(question_text)) not between 1 and 1000 or jsonb_typeof(share_options) <> 'object' or reservation not between 1 and 100000 then raise exception 'INVALID_REQUEST'; end if;
  delete from public.coach_usage where created_at < now()-interval '7 days';
  if (select count(*) from public.coach_usage where owner_id=actor and created_at > now()-interval '1 hour') >= (limits->>'hourly')::integer
    or (select count(*) from public.coach_usage where owner_id=actor and created_at >= day_start) >= (limits->>'daily')::integer
    or (select coalesce(sum(reserved_tokens),0) from public.coach_usage where owner_id=actor and created_at >= day_start)+reservation > (limits->>'tokens')::integer
    or (select count(*) from public.coach_usage where created_at >= day_start) >= (limits->>'globalDaily')::integer
    or (select coalesce(sum(reserved_tokens),0) from public.coach_usage where created_at >= day_start)+reservation > (limits->>'globalTokens')::integer then raise exception 'USAGE_LIMIT'; end if;
  if create_conversation then
    insert into public.coach_conversations(owner_id,id,title) values(actor,conversation,left(question_text,100));
  elsif not exists(select 1 from public.coach_conversations where owner_id=actor and id=conversation) then raise exception 'NOT_FOUND'; end if;
  if (select count(*) from public.coach_turns where owner_id=actor and conversation_id=conversation) >= 100 then raise exception 'CONVERSATION_FULL'; end if;
  if exists(select 1 from public.coach_turns where owner_id=actor and conversation_id=conversation and state='running' and created_at > now()-interval '2 minutes') then raise exception 'REQUEST_RUNNING'; end if;
  insert into public.coach_usage(owner_id,request_id,reserved_tokens) values(actor,request,reservation);
  insert into public.coach_turns(owner_id,request_id,conversation_id,question,sharing,model)
    values(actor,request,conversation,question_text,share_options,model_name) returning * into result;
  return jsonb_build_object('turn',to_jsonb(result),'fresh',true);
end;
$$;
create function public.coach_finish(actor uuid, request uuid, answer jsonb, input_count integer, output_count integer, failure text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.coach_turns set reply=answer, state=case when failure is null then 'completed' else 'failed' end,
    input_tokens=greatest(0,input_count), output_tokens=greatest(0,output_count), error_code=failure
    where owner_id=actor and request_id=request and state='running';
  if not found then raise exception 'REQUEST_UNAVAILABLE'; end if;
end;
$$;
revoke all on function public.coach_begin(uuid,uuid,uuid,boolean,text,jsonb,text,integer,jsonb) from public, anon, authenticated;
revoke all on function public.coach_finish(uuid,uuid,jsonb,integer,integer,text) from public, anon, authenticated;
grant execute on function public.coach_begin(uuid,uuid,uuid,boolean,text,jsonb,text,integer,jsonb) to service_role;
grant execute on function public.coach_finish(uuid,uuid,jsonb,integer,integer,text) to service_role;
