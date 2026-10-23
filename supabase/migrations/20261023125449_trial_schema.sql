-- Local-first schema. Only public aggregate data is visible without Auth.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema public to anon, authenticated;

create table public.content_versions (
  id text primary key,
  definition jsonb not null check (jsonb_typeof(definition) = 'object'),
  active boolean not null default false
);
create unique index one_active_content_version on public.content_versions (active) where active;
create table public.ballots (
  participant_id uuid not null,
  version text not null references public.content_versions(id),
  answers jsonb not null check (jsonb_typeof(answers) = 'object'),
  revision bigint not null check (revision > 0),
  updated_at timestamptz not null default now(),
  primary key (participant_id, version)
);
create index ballots_version_idx on public.ballots(version);
create table public.aggregate_snapshots (
  version text primary key references public.content_versions(id),
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now(),
  payload jsonb not null check (jsonb_typeof(payload) = 'object')
);
create table private.submissions (
  participant_id uuid not null,
  version text not null references public.content_versions(id),
  request_id uuid not null,
  payload_hash text not null,
  ballot_revision bigint not null check (ballot_revision > 0),
  created_at timestamptz not null default clock_timestamp(),
  primary key (participant_id, version, request_id)
);
create index submissions_version_idx on private.submissions(version);
-- One row per identity, shared across content versions. Keep a rolling 60s window.
create table private.submit_limits (
  participant_id uuid primary key,
  window_started_at timestamptz not null,
  attempts integer not null check (attempts between 1 and 10),
  operations timestamptz[] not null
);

alter table public.content_versions enable row level security;
alter table public.ballots enable row level security;
alter table public.aggregate_snapshots enable row level security;
alter table private.submissions enable row level security;
alter table private.submit_limits enable row level security;
revoke all on public.content_versions, public.ballots, public.aggregate_snapshots from public, anon, authenticated;
revoke all on private.submissions, private.submit_limits from public, anon, authenticated;
grant select on public.content_versions, public.aggregate_snapshots to anon, authenticated;
grant select on public.ballots to authenticated;
create policy content_public_read on public.content_versions for select to anon, authenticated using (true);
create policy aggregates_public_read on public.aggregate_snapshots for select to anon, authenticated using (true);
create policy ballots_owner_read on public.ballots for select to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = participant_id);

create function private.empty_snapshot(p_version text) returns jsonb
language plpgsql stable set search_path = pg_catalog as $$
declare cases jsonb := '{}'; axes jsonb := '{}'; verdicts jsonb := '{}'; counts jsonb := '{}'; i integer; s integer; label text;
begin
  foreach s in array array[-5,-4,-3,-2,-1,1,2,3,4,5] loop counts := counts || jsonb_build_object(s::text,'0'); end loop;
  for i in 1..10 loop
    cases := cases || jsonb_build_object('H'||lpad(i::text,2,'0'),counts,'K'||lpad(i::text,2,'0'),counts);
    axes := axes || jsonb_build_object(i::text,'0');
  end loop;
  foreach label in array array['N5','N4','N3','N2','N1','Z','P1','P2','P3','P4','P5'] loop verdicts := verdicts || jsonb_build_object(label,'0'); end loop;
  return jsonb_build_object('version',p_version,'revision','0','updatedAt',to_char(current_timestamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'count','0','scoreSum','0','caseCounts',cases,'axisSums',axes,'verdictCounts',verdicts);
end $$;
revoke all on function private.empty_snapshot(text) from public, anon, authenticated;

insert into public.content_versions(id,definition,active)
select 'v1', jsonb_build_object(
  'caseIds',(select jsonb_agg(prefix || lpad(i::text,2,'0') order by prefix,i) from generate_series(1,10) i cross join (values ('H'),('K')) p(prefix)),
  'scores',jsonb_build_array(-5,-4,-3,-2,-1,1,2,3,4,5),
  'axisFormula','default=50+5*(K-H);4=50-5*(H+K);10=50+5*(H+K)',
  'verdictBounds',jsonb_build_array(-80,-60,-40,-20,0,20,40,60,80),
  'scoringVersion','v1'),true;
insert into public.aggregate_snapshots(version,payload) values ('v1',private.empty_snapshot('v1'));
