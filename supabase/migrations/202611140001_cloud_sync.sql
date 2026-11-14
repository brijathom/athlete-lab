-- Cloud schema 1. Each row is one domain entity; embedded exercise prescriptions,
-- skill results and historical snapshots remain intact inside their owning record.
create table public.athlete_records (
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('programme','session','workout','recovery','testDefinition','testResult','match','matchMetric','profile','preferences','scoringRules')),
  id text not null check (length(id) between 1 and 200),
  revision bigint not null check (revision > 0),
  payload jsonb,
  updated_at timestamptz not null default now(),
  primary key (owner_id, kind, id),
  check (payload is null or jsonb_typeof(payload) = 'object'),
  check (kind not in ('profile','preferences','scoringRules') or id = 'singleton'),
  check (payload is null or kind in ('profile','preferences','scoringRules') or (payload ? 'id' and payload->>'id' = id))
);
alter table public.athlete_records enable row level security;
alter table public.athlete_records force row level security;
create policy own_records on public.athlete_records for all to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
-- Clients can read their own rows; writes must go through the revision-checked RPC.
revoke all on public.athlete_records from anon, authenticated;
grant select on public.athlete_records to authenticated;

create function public.athlete_sync(changes jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid(); change jsonb; current_revision bigint; result jsonb; clash boolean := false;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if changes is null or jsonb_typeof(changes) <> 'array' or jsonb_array_length(changes) > 100000 or octet_length(changes::text) > 26214400 then
    raise exception 'Invalid or oversized sync request';
  end if;
  -- One consistent account snapshot per exchange, including multi-record updates/deletes.
  perform pg_advisory_xact_lock(hashtextextended(actor::text, 0));
  if (select count(*) from jsonb_array_elements(changes)) <>
     (select count(distinct (v->>'kind', v->>'id')) from jsonb_array_elements(changes) v) then
    raise exception 'Duplicate record in sync request';
  end if;
  for change in select value from jsonb_array_elements(changes) loop
    if jsonb_typeof(change) <> 'object' or not (change ?& array['kind','id','expected_revision','payload'])
      or change - array['kind','id','expected_revision','payload'] <> '{}'::jsonb
      or change->>'kind' not in ('programme','session','workout','recovery','testDefinition','testResult','match','matchMetric','profile','preferences','scoringRules')
      or jsonb_typeof(change->'kind') <> 'string' or jsonb_typeof(change->'id') <> 'string'
      or length(change->>'id') not between 1 and 200
      or jsonb_typeof(change->'expected_revision') <> 'number'
      or (change->>'expected_revision') !~ '^[0-9]+$'
      or (change->>'expected_revision')::numeric > 9007199254740990
      or jsonb_typeof(change->'payload') not in ('object','null') then
      raise exception 'Invalid sync record';
    end if;
    select revision into current_revision from public.athlete_records
      where owner_id = actor and kind = change->>'kind' and id = change->>'id';
    if coalesce(current_revision, 0) <> (change->>'expected_revision')::bigint then clash := true; end if;
  end loop;
  if not clash then
    for change in select value from jsonb_array_elements(changes) loop
      insert into public.athlete_records(owner_id, kind, id, revision, payload)
      values (actor, change->>'kind', change->>'id', (change->>'expected_revision')::bigint + 1, nullif(change->'payload', 'null'::jsonb))
      on conflict (owner_id, kind, id) do update
        set revision = excluded.revision, payload = excluded.payload, updated_at = now();
    end loop;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'id', id, 'revision', revision, 'payload', payload) order by kind, id), '[]'::jsonb)
    into result from public.athlete_records where owner_id = actor;
  return jsonb_build_object('schemaVersion', 1, 'applied', not clash, 'records', result);
end;
$$;
revoke all on function public.athlete_sync(jsonb) from public, anon;
grant execute on function public.athlete_sync(jsonb) to authenticated;
-- Tombstones are deliberately never garbage-collected: stale devices cannot recreate
-- deleted records at revision zero. A deliberate restoration must acknowledge their revision.
