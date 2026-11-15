-- Expand coaching messages without changing stored conversations or training records.
BEGIN;
ALTER TABLE public.coach_turns DROP CONSTRAINT coach_turns_question_check;
ALTER TABLE public.coach_turns ADD CONSTRAINT coach_turns_question_check CHECK (length(question) BETWEEN 1 AND 8000);

create or replace function public.coach_begin(actor uuid, request uuid, conversation uuid, create_conversation boolean,
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
  if actor is null or length(btrim(question_text)) not between 1 and 8000 or jsonb_typeof(share_options) <> 'object' or reservation not between 1 and 100000 then raise exception 'INVALID_REQUEST'; end if;
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

COMMIT;
