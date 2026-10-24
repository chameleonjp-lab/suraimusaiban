-- Anonymous responses contribute only to totals. Preserve every previously
-- published aggregate, and remove this game's individual answer/history rows.
-- No shared Auth, ranking objects, or shared private-schema grants are changed.
drop function public.slime_trial_submit_ballot(text,jsonb,uuid,bigint);
drop function slime_trial_private.apply_ballot(text,jsonb,uuid,bigint);
drop table public.slime_trial_ballots;
drop table slime_trial_private.submissions;
drop table slime_trial_private.submit_limits;

revoke all on schema slime_trial_private from public,anon,authenticated;
grant usage on schema slime_trial_private to service_role;
grant usage on schema public to service_role;

create table slime_trial_private.aggregate_totals (
  version text primary key references public.slime_trial_content_versions(id),
  revision bigint not null check (revision >= 0),
  updated_at timestamptz not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  pending_count integer not null default 0 check (pending_count between 0 and 9)
);
insert into slime_trial_private.aggregate_totals(version,revision,updated_at,payload)
  select version,revision,updated_at,payload from public.slime_trial_aggregate_snapshots;

-- These two columns are intentionally the entire receipt: no answer, hash,
-- version, network-key, participant, or result columns. Acceptance timestamps
-- can temporarily correlate receipts with the private rate-limit metadata.
create table slime_trial_private.request_receipts (
  request_id uuid primary key,
  created_at timestamptz not null default clock_timestamp()
);
create index slime_trial_request_receipts_created_at_idx
  on slime_trial_private.request_receipts(created_at);

-- Network keys are rotating, purpose-separated HMACs supplied by trusted Edge.
-- A global rolling window shares this table. Its acceptance timestamps can be
-- correlated with receipt timestamps while both sets of metadata are retained.
create table slime_trial_private.request_limits (
  limit_key text primary key check (limit_key = 'global' or limit_key ~ '^[0-9a-f]{64}$'),
  operations timestamptz[] not null check (cardinality(operations) between 1 and 120),
  updated_at timestamptz not null default clock_timestamp()
);
create index slime_trial_request_limits_updated_at_idx
  on slime_trial_private.request_limits(updated_at);

alter table slime_trial_private.aggregate_totals enable row level security;
alter table slime_trial_private.request_receipts enable row level security;
alter table slime_trial_private.request_limits enable row level security;
revoke all on slime_trial_private.aggregate_totals,
  slime_trial_private.request_receipts,slime_trial_private.request_limits
  from public,anon,authenticated;
-- Retain the public read policies and Realtime publication. Direct writes stay
-- forbidden; even snapshot timestamps/revisions change only on a full batch.
revoke all on public.slime_trial_aggregate_snapshots from public,anon,authenticated;
grant select on public.slime_trial_aggregate_snapshots to anon,authenticated;

create function slime_trial_private.collect_response(
  p_version text,p_answers jsonb,p_request_id uuid,p_source_key text,
  p_previous_source_key text default null,p_next_source_key text default null
) returns jsonb
-- A stalled transaction cannot make public-gateway requests queue indefinitely.
language plpgsql security definer set search_path = pg_catalog set lock_timeout = '3s' as $$
declare
  aggregate_row slime_trial_private.aggregate_totals%rowtype;
  public_snapshot jsonb;
  normalized jsonb := '{}';
  entry jsonb;
  key text;
  axis text;
  verdict text;
  n numeric;
  result jsonb;
  state jsonb;
  stamp timestamptz;
  stamp_text text;
  network_operations timestamptz[];
  previous_network_operations timestamptz[];
  next_network_operations timestamptz[];
  global_operations timestamptz[];
begin
  if p_request_id is null or p_source_key is null or p_source_key !~ '^[0-9a-f]{64}$'
    or (p_previous_source_key is not null and
      (p_previous_source_key !~ '^[0-9a-f]{64}$' or p_previous_source_key=p_source_key))
    or (p_next_source_key is not null and
      (p_next_source_key !~ '^[0-9a-f]{64}$' or p_next_source_key=p_source_key
        or p_next_source_key=p_previous_source_key)) then
    raise exception using message='INVALID_REQUEST',errcode='P0001';
  end if;
  if p_answers is null or jsonb_typeof(p_answers)<>'array' then
    raise exception using message='INVALID_ANSWERS',errcode='P0001';
  end if;
  if jsonb_array_length(p_answers)<>20 then
    raise exception using message='INVALID_ANSWERS',errcode='P0001';
  end if;
  for entry in select value from jsonb_array_elements(p_answers) loop
    if jsonb_typeof(entry)<>'object' then
      raise exception using message='INVALID_ANSWERS',errcode='P0001';
    end if;
    if (select count(*) from jsonb_object_keys(entry))<>2
      or not (entry ? 'caseId' and entry ? 'score')
      or jsonb_typeof(entry->'caseId')<>'string'
      or jsonb_typeof(entry->'score')<>'number' then
      raise exception using message='INVALID_ANSWERS',errcode='P0001';
    end if;
    key := entry->>'caseId';
    if key !~ '^[HK](0[1-9]|10)$' or normalized ? key then
      raise exception using message='INVALID_ANSWERS',errcode='P0001';
    end if;
    n := (entry->>'score')::numeric;
    if n<>trunc(n) or n=0 or n < -5 or n > 5 then
      raise exception using message='INVALID_ANSWERS',errcode='P0001';
    end if;
    normalized := normalized || jsonb_build_object(key,n::integer);
  end loop;

  -- One game-specific transaction lock orders all versions, receipts, rate
  -- windows, totals and cleanup. It also serializes first-time identical UUIDs.
  -- Nothing is locked or modified in another game's schema.
  perform pg_advisory_xact_lock(1936483693,42);
  stamp := clock_timestamp();
  perform 1 from public.slime_trial_content_versions where id=p_version and active for share;
  if not found then raise exception using message='VERSION_CHANGED',errcode='P0001'; end if;
  select * into aggregate_row from slime_trial_private.aggregate_totals where version=p_version for update;
  if not found then raise exception using message='VERSION_CHANGED',errcode='P0001'; end if;
  select payload into public_snapshot from public.slime_trial_aggregate_snapshots where version=p_version;
  if not found then raise exception using message='VERSION_CHANGED',errcode='P0001'; end if;

  -- Idempotency is UUID-only: no answers are stored for comparison. Temporary
  -- timing correlation with network counters remains possible. Replays consume
  -- no accepted quota.
  if exists (select 1 from slime_trial_private.request_receipts
    where request_id=p_request_id and created_at>stamp-interval '24 hours') then
    return jsonb_build_object('accepted',true,'duplicate',true,'snapshot',public_snapshot);
  end if;

  select coalesce(array_agg(t order by t),array[]::timestamptz[])
    into network_operations
    from slime_trial_private.request_limits l cross join unnest(l.operations) t
    where l.limit_key=p_source_key and t>stamp-interval '600 seconds';
  -- Hourly key rotation must not reset the rolling ten-minute network quota.
  -- Count adjacent epochs in both directions: an older Edge request can arrive
  -- after newer-hour requests. Append only to the current epoch's timestamps;
  -- copying prior operations forward would count them repeatedly.
  select coalesce(array_agg(t order by t),array[]::timestamptz[])
    into previous_network_operations
    from slime_trial_private.request_limits l cross join unnest(l.operations) t
    where l.limit_key=p_previous_source_key and t>stamp-interval '600 seconds';
  select coalesce(array_agg(t order by t),array[]::timestamptz[])
    into next_network_operations
    from slime_trial_private.request_limits l cross join unnest(l.operations) t
    where l.limit_key=p_next_source_key and t>stamp-interval '600 seconds';
  select coalesce(array_agg(t order by t),array[]::timestamptz[])
    into global_operations
    from slime_trial_private.request_limits l cross join unnest(l.operations) t
    where l.limit_key='global' and t>stamp-interval '60 seconds';
  if cardinality(network_operations)+cardinality(previous_network_operations)
      +cardinality(next_network_operations)>=30
    or cardinality(global_operations)>=120 then
    raise exception using message='RATE_LIMITED',errcode='P0001';
  end if;

  result := slime_trial_private.score_ballot(normalized);
  state := aggregate_row.payload;
  state := jsonb_set(state,'{count}',to_jsonb(((state->>'count')::bigint+1)::text));
  state := jsonb_set(state,'{scoreSum}',to_jsonb(((state->>'scoreSum')::bigint+(result->>'total')::integer)::text));
  for key in select jsonb_object_keys(normalized) loop
    axis := normalized->>key;
    state := jsonb_set(state,array['caseCounts',key,axis],to_jsonb(((state#>>array['caseCounts',key,axis])::bigint+1)::text));
  end loop;
  for axis in select jsonb_object_keys(result->'axes') loop
    state := jsonb_set(state,array['axisSums',axis],to_jsonb(((state#>>array['axisSums',axis])::bigint+(result#>>array['axes',axis])::integer)::text));
  end loop;
  verdict := result->>'verdict';
  state := jsonb_set(state,array['verdictCounts',verdict],to_jsonb(((state#>>array['verdictCounts',verdict])::bigint+1)::text));
  stamp_text := to_char(stamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  state := state || jsonb_build_object('revision',(aggregate_row.revision+1)::text,'updatedAt',stamp_text);

  update slime_trial_private.aggregate_totals
    set payload=state,revision=aggregate_row.revision+1,updated_at=stamp,
      pending_count=(aggregate_row.pending_count+1)%10
    where version=p_version;
  if aggregate_row.pending_count=9 then
    update public.slime_trial_aggregate_snapshots
      set payload=state,revision=aggregate_row.revision+1,updated_at=stamp where version=p_version;
    public_snapshot := state;
  end if;
  -- Expired UUIDs may be reused even if the scheduled cleanup has not run yet.
  delete from slime_trial_private.request_receipts where request_id=p_request_id;
  insert into slime_trial_private.request_receipts(request_id,created_at) values(p_request_id,stamp);
  insert into slime_trial_private.request_limits(limit_key,operations,updated_at)
    values(p_source_key,network_operations || stamp,stamp),('global',global_operations || stamp,stamp)
    on conflict (limit_key) do update set operations=excluded.operations,updated_at=excluded.updated_at;
  return jsonb_build_object('accepted',true,'duplicate',false,'snapshot',public_snapshot);
end $$;
alter function slime_trial_private.collect_response(text,jsonb,uuid,text,text,text) owner to postgres;
revoke all on function slime_trial_private.collect_response(text,jsonb,uuid,text,text,text) from public,anon,authenticated;
grant execute on function slime_trial_private.collect_response(text,jsonb,uuid,text,text,text) to service_role;

create function public.slime_trial_collect_response(
  p_version text,p_answers jsonb,p_request_id uuid,p_source_key text,
  p_previous_source_key text default null,p_next_source_key text default null
) returns jsonb
language sql security invoker set search_path = pg_catalog as $$
  select slime_trial_private.collect_response(p_version,p_answers,p_request_id,p_source_key,p_previous_source_key,p_next_source_key);
$$;
revoke all on function public.slime_trial_collect_response(text,jsonb,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.slime_trial_collect_response(text,jsonb,uuid,text,text,text) to service_role;

-- The hosted scheduler may call this as postgres. It does not require changing
-- shared extension state or other games' scheduled jobs during this migration.
create function slime_trial_private.cleanup_requests() returns void
language plpgsql security definer set search_path = pg_catalog as $$
declare stamp timestamptz;
begin
  perform pg_advisory_xact_lock(1936483693,42);
  stamp := clock_timestamp();
  delete from slime_trial_private.request_receipts where created_at<=stamp-interval '24 hours';
  delete from slime_trial_private.request_limits where updated_at<stamp-interval '1 hour';
end $$;
alter function slime_trial_private.cleanup_requests() owner to postgres;
revoke all on function slime_trial_private.cleanup_requests() from public,anon,authenticated;
grant execute on function slime_trial_private.cleanup_requests() to service_role;
create function public.slime_trial_cleanup_requests() returns void
language sql security invoker set search_path = pg_catalog as $$
  select slime_trial_private.cleanup_requests();
$$;
revoke all on function public.slime_trial_cleanup_requests() from public,anon,authenticated;
grant execute on function public.slime_trial_cleanup_requests() to service_role;

comment on table slime_trial_private.aggregate_totals is 'Exact accumulated response totals only; unpublished until ten new anonymous responses. No individual answers or identity.';
comment on table slime_trial_private.request_receipts is 'Random request UUID and acceptance time only. UUID deduplication expires after 24 hours; no answers or source columns. Timestamps can temporarily correlate with private rate-limit metadata.';
comment on table slime_trial_private.request_limits is 'Short-lived rotating HMAC/global rolling accepted timestamps; no raw IP or request UUID column. Timestamps can temporarily correlate with receipts. Stale rows removed after one hour.';
comment on table public.slime_trial_aggregate_snapshots is 'Public response aggregates, published only after each ten new responses. No individual answers, participant identity or partial-batch metadata.';
