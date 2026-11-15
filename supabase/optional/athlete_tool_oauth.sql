-- OPTIONAL: only after remote-client eligibility, HTTPS and OAuth setup are verified.
-- Applying this file does NOT enable OAuth, install an Auth hook, allow a client,
-- or activate remote MCP. Configure each explicitly as documented.
create table public.athlete_tool_oauth_clients (
  client_id uuid primary key,
  resource text not null check(resource like 'https://%/functions/v1/athlete-tools/mcp')
);
alter table public.athlete_tool_oauth_clients enable row level security;
alter table public.athlete_tool_oauth_clients force row level security;
revoke all on public.athlete_tool_oauth_clients from public,anon,authenticated;
grant select on public.athlete_tool_oauth_clients to supabase_auth_admin;
create function public.athlete_tool_access_token_hook(event jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare claims jsonb:=event->'claims'; audience text;
begin
  select resource into audience from public.athlete_tool_oauth_clients where client_id::text=claims->>'client_id';
  if audience is not null then
    claims:=jsonb_set(claims,'{aud}',jsonb_build_array('authenticated',audience));
    return jsonb_set(event,'{claims}',claims);
  end if;
  return event;
end; $$;
revoke all on function public.athlete_tool_access_token_hook(jsonb) from public,anon,authenticated;
grant execute on function public.athlete_tool_access_token_hook(jsonb) to supabase_auth_admin;
