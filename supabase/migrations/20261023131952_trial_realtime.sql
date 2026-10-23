-- Supabase creates this publication when Realtime is available. The reduced
-- local fixture need not have it. Publish only public aggregates, never slime_trial_ballots
-- or slime_trial_private submission/identity records; preserve all existing membership.
do $migration$
begin
  if exists (
    select 1 from pg_catalog.pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'slime_trial_aggregate_snapshots'
  ) then
    alter publication supabase_realtime add table public.slime_trial_aggregate_snapshots;
  end if;
end;
$migration$;
