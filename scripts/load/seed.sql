-- SPDX-License-Identifier: Apache-2.0
-- Synthetic households for scripts/load-test.sh. No real people: names are "Load N",
-- addresses end in @example.invalid and numbers are in the fictional 555-01xx range.
-- Phone n gets the device token pp_d_load_<n>; the load generator derives the same tokens.
-- Usage: psql -v phones=500 -f seed.sql
\set ON_ERROR_STOP on
begin;

create temporary table load_seed on commit drop as
  select n, gen_random_uuid() as household_id, gen_random_uuid() as user_id, gen_random_uuid() as phone_id
  from generate_series(1, :phones) n;

insert into households (id, name) select household_id, 'Load ' || n from load_seed;
insert into users (id, email) select user_id, 'load-' || n || '@example.invalid' from load_seed;
insert into household_members (household_id, user_id, role) select household_id, user_id, 'owner' from load_seed;

-- Paired child phones in strong mode. Every third phone shares its position every few minutes.
insert into phones (id, household_id, name, profile, dns_client_id, device_token_hash,
                    paired_at, last_seen_at, location_enabled, location_mode, location_always_until)
  select phone_id, household_id, 'Load phone ' || n, 'child', 'load' || n,
         encode(sha256(convert_to('pp_d_load_' || n, 'UTF8')), 'hex'),
         now() - interval '30 days', now() - interval '2 minutes',
         n % 3 = 0, case when n % 3 = 0 then 'always' else 'off' end,
         case when n % 3 = 0 then now() + interval '7 days' end
  from load_seed;

-- 120 installed apps per phone, half allowed: about what a used phone reports.
insert into phone_apps (phone_id, package_name, label, installed, allowed)
  select phone_id, 'org.example.app' || i, 'App ' || i, true, i % 2 = 0
  from load_seed, generate_series(1, 120) i;

-- Ten contacts per phone, the first one the parent.
insert into contacts (phone_id, name, number, sos_parent, contact_group)
  select phone_id, 'Contact ' || i, '+1202555010' || (i - 1), i = 1, case when i = 1 then 'family' else 'others' end
  from load_seed, generate_series(1, 10) i;

-- School time on weekdays and a bedtime every night.
insert into schedules (phone_id, kind, days, start_minute, end_minute)
  select phone_id, 'school', '{1,2,3,4,5}'::smallint[], 480, 840 from load_seed
  union all
  select phone_id, 'bedtime', '{1,2,3,4,5,6,7}'::smallint[], 1260, 420 from load_seed;

commit;
analyze;
