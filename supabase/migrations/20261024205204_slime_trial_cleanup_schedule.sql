-- Managed Supabase supports pg_cron. The lightweight local PostgreSQL fixture
-- does not ship this extension; its cleanup function is exercised directly.
do $migration$
begin
  if not exists(select 1 from pg_available_extensions where name='pg_cron') then
    return;
  end if;
  if not exists(select 1 from pg_extension where extname='pg_cron') then
    execute 'create extension pg_cron with schema pg_catalog';
  end if;
  perform cron.schedule(
    'slime-trial-anonymous-retention-v1',
    '*/5 * * * *',
    'select slime_trial_private.cleanup_requests();'
  );
end;
$migration$;
