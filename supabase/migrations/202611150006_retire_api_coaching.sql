-- The owner approved deleting API-coaching conversations, exchanges and proposals.
-- Training records, tool permissions/drafts/audit and sync are unaffected.
begin;
drop function if exists public.coach_decide(uuid,boolean,boolean);
drop function if exists public.coach_decide_browser(uuid,boolean,boolean);
do $$ declare item record; begin
 for item in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('coach_begin','coach_finish') loop
  execute 'drop function '||item.signature;
 end loop;
end $$;
drop table public.coach_proposals;
drop table public.coach_turns;
drop table public.coach_usage;
drop table public.coach_conversations;
commit;
