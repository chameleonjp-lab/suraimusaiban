-- Immutable server scoring. All arithmetic is integral; no client scores accepted.
create function slime_trial_private.score_ballot(p_answers jsonb) returns jsonb
language plpgsql immutable set search_path = pg_catalog as $$
declare total integer := 0; axes jsonb := '{}'; i integer; h integer; k integer; v text; axis integer;
begin
  for i in 1..10 loop
    h := (p_answers->>('H'||lpad(i::text,2,'0')))::integer;
    k := (p_answers->>('K'||lpad(i::text,2,'0')))::integer;
    total := total + h + k;
    axis := case when i=4 then 50-5*(h+k) when i=10 then 50+5*(h+k) else 50+5*(k-h) end;
    axes := axes || jsonb_build_object(i::text,axis);
  end loop;
  v := case when total < -80 then 'N5' when total < -60 then 'N4' when total < -40 then 'N3' when total < -20 then 'N2' when total < 0 then 'N1' when total = 0 then 'Z' when total <=20 then 'P1' when total<=40 then 'P2' when total<=60 then 'P3' when total<=80 then 'P4' else 'P5' end;
  return jsonb_build_object('total',total,'axes',axes,'verdict',v);
end $$;
revoke all on function slime_trial_private.score_ballot(jsonb) from public, anon, authenticated;

-- postgres is the migration owner and intentionally owns this slime_trial_private definer.
-- It bypasses RLS on the five protected tables; authenticated has no direct DML.
-- No user-set role, metadata, participant id, score or aggregate is trusted.
create function slime_trial_private.apply_ballot(p_version text,p_answers jsonb,p_request_id uuid,p_expected_revision bigint) returns jsonb
language plpgsql security definer set search_path = pg_catalog as $$
declare
  uid uuid := auth.uid(); aggregate_row public.slime_trial_aggregate_snapshots%rowtype; previous public.slime_trial_ballots%rowtype;
  request_row slime_trial_private.submissions%rowtype; entry jsonb; normalized jsonb := '{}'; key text; n numeric;
  v_hash text; inserted_rows integer; current_revision bigint; ballot_revision bigint; state jsonb; result jsonb; old_result jsonb;
  old_answers jsonb; stamp timestamptz; stamp_text text; v_operations timestamptz[]; increment integer; direction integer; old_or_new integer; axis text; verdict text;
begin
  if uid is null then raise exception using message='UNAUTHENTICATED', errcode='P0001'; end if;
  -- One lock order for all submissions, including first votes and idempotent retries.
  select * into aggregate_row from public.slime_trial_aggregate_snapshots where version=p_version for update;
  if not found then raise exception using message='VERSION_CHANGED', errcode='P0001'; end if;
  perform 1 from public.slime_trial_content_versions where id=p_version and active for share;
  if not found then raise exception using message='VERSION_CHANGED', errcode='P0001'; end if;
  select * into previous from public.slime_trial_ballots where participant_id=uid and version=p_version for update;
  select * into request_row from slime_trial_private.submissions where participant_id=uid and version=p_version and request_id=p_request_id;
  if p_request_id is null or p_expected_revision is null or p_expected_revision<0 or p_answers is null or jsonb_typeof(p_answers)<>'array' then
    raise exception using message='INVALID_ANSWERS',errcode='P0001';
  end if;
  if jsonb_array_length(p_answers)<>20 then raise exception using message='INVALID_ANSWERS',errcode='P0001'; end if;
  for entry in select value from jsonb_array_elements(p_answers) loop
    if jsonb_typeof(entry)<>'object' then raise exception using message='INVALID_ANSWERS',errcode='P0001'; end if;
    if (select count(*) from jsonb_object_keys(entry))<>2 or not (entry ? 'caseId' and entry ? 'score') or jsonb_typeof(entry->'caseId')<>'string' or jsonb_typeof(entry->'score')<>'number' then raise exception using message='INVALID_ANSWERS',errcode='P0001'; end if;
    key := entry->>'caseId';
    if key !~ '^[HK](0[1-9]|10)$' or normalized ? key then raise exception using message='INVALID_ANSWERS',errcode='P0001'; end if;
    n := (entry->>'score')::numeric;
    if n <> trunc(n) or n=0 or n < -5 or n > 5 then raise exception using message='INVALID_ANSWERS',errcode='P0001'; end if;
    normalized := normalized || jsonb_build_object(key,n::integer);
  end loop;
  v_hash := encode(sha256(convert_to(normalized::text,'UTF8')),'hex');
  current_revision := coalesce(previous.revision,0);
  if request_row.request_id is not null then
    if request_row.payload_hash<>v_hash then raise exception using message='REQUEST_ID_REUSED',errcode='P0001'; end if;
    if current_revision<>request_row.ballot_revision then raise exception using message='STALE_REVISION',errcode='P0001'; end if;
    return jsonb_build_object('ballot',jsonb_build_object('version',p_version,'answers',previous.answers,'revision',previous.revision::text),'snapshot',aggregate_row.payload);
  end if;
  if current_revision<>p_expected_revision then raise exception using message='STALE_REVISION',errcode='P0001'; end if;
  stamp := clock_timestamp();
  -- Serialize limits across content versions too; failed transactions consume none.
  insert into slime_trial_private.submit_limits(participant_id,window_started_at,attempts,operations)
    values(uid,stamp,1,array[stamp]) on conflict (participant_id) do nothing;
  get diagnostics inserted_rows = row_count;
  perform 1 from slime_trial_private.submit_limits where participant_id=uid for update;
  select array_agg(t order by t) into v_operations from slime_trial_private.submit_limits l cross join unnest(l.operations) t
    where l.participant_id=uid and t>stamp-interval '60 seconds';
  if inserted_rows=0 then
    if coalesce(cardinality(v_operations),0)>=10 then raise exception using message='RATE_LIMITED',errcode='P0001'; end if;
    v_operations := coalesce(v_operations,array[]::timestamptz[]) || stamp;
  end if;
  update slime_trial_private.submit_limits set operations=v_operations, attempts=cardinality(v_operations),window_started_at=v_operations[1] where participant_id=uid;
  ballot_revision := current_revision;
  if previous.answers is distinct from normalized then
    ballot_revision := current_revision+1;
    old_answers := previous.answers; result := slime_trial_private.score_ballot(normalized);
    old_result := case when old_answers is null then null else slime_trial_private.score_ballot(old_answers) end;
    state := aggregate_row.payload;
    increment := case when old_answers is null then 1 else 0 end;
    state := jsonb_set(state,'{count}',to_jsonb(((state->>'count')::bigint+increment)::text));
    state := jsonb_set(state,'{scoreSum}',to_jsonb(((state->>'scoreSum')::bigint+(result->>'total')::integer-coalesce((old_result->>'total')::integer,0))::text));
    for old_or_new in 0..1 loop
      direction := case when old_or_new=0 then -1 else 1 end;
      if old_or_new=0 and old_answers is null then continue; end if;
      entry := case when old_or_new=0 then old_answers else normalized end;
      for key in select jsonb_object_keys(entry) loop
        axis := entry->>key;
        state := jsonb_set(state,array['caseCounts',key,axis],to_jsonb(((state#>>array['caseCounts',key,axis])::bigint+direction)::text));
      end loop;
      entry := case when old_or_new=0 then old_result else result end;
      for axis in select jsonb_object_keys(entry->'axes') loop
        state := jsonb_set(state,array['axisSums',axis],to_jsonb(((state#>>array['axisSums',axis])::bigint+direction*(entry#>>array['axes',axis])::integer)::text));
      end loop;
      verdict := entry->>'verdict';
      state := jsonb_set(state,array['verdictCounts',verdict],to_jsonb(((state#>>array['verdictCounts',verdict])::bigint+direction)::text));
    end loop;
    stamp_text := to_char(stamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    state := state || jsonb_build_object('revision',(aggregate_row.revision+1)::text,'updatedAt',stamp_text);
    insert into public.slime_trial_ballots(participant_id,version,answers,revision,updated_at) values(uid,p_version,normalized,ballot_revision,stamp)
      on conflict (participant_id,version) do update set answers=excluded.answers,revision=excluded.revision,updated_at=excluded.updated_at;
    update public.slime_trial_aggregate_snapshots set payload=state,revision=aggregate_row.revision+1,updated_at=stamp where version=p_version;
  else state := aggregate_row.payload;
  end if;
  insert into slime_trial_private.submissions(participant_id,version,request_id,payload_hash,ballot_revision,created_at)
    values(uid,p_version,p_request_id,v_hash,ballot_revision,stamp);
  return jsonb_build_object('ballot',jsonb_build_object('version',p_version,'answers',normalized,'revision',ballot_revision::text),'snapshot',state);
end $$;
alter function slime_trial_private.apply_ballot(text,jsonb,uuid,bigint) owner to postgres;
revoke all on function slime_trial_private.apply_ballot(text,jsonb,uuid,bigint) from public,anon,authenticated;
grant usage on schema slime_trial_private to authenticated;
grant execute on function slime_trial_private.apply_ballot(text,jsonb,uuid,bigint) to authenticated;

create function public.slime_trial_submit_ballot(p_version text,p_answers jsonb,p_request_id uuid,p_expected_revision bigint) returns jsonb
language sql security invoker set search_path = pg_catalog as $$
  select slime_trial_private.apply_ballot(p_version,p_answers,p_request_id,p_expected_revision);
$$;
revoke all on function public.slime_trial_submit_ballot(text,jsonb,uuid,bigint) from public,anon,authenticated;
grant execute on function public.slime_trial_submit_ballot(text,jsonb,uuid,bigint) to authenticated;
