-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.

create table if not exists admins (email text primary key);
insert into admins (email) values ('fourheed@outlook.com'), ('gbyatt@gmail.com')
on conflict do nothing;

create table if not exists enquiries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null check (length(name) between 1 and 200),
  email text not null check (length(email) between 3 and 320),
  type text check (length(type) <= 100),
  event_date date,
  location text check (length(location) <= 300),
  message text check (length(message) <= 5000),
  status text not null default 'new' check (status in ('new','confirmed','declined'))
);

create table if not exists blocked_dates (
  event_date date primary key,
  note text,
  created_at timestamptz not null default now()
);

-- security definer so the admins table itself stays unreadable from the browser
create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where email = lower(auth.jwt() ->> 'email'));
$$;

alter table admins enable row level security;
alter table enquiries enable row level security;
alter table blocked_dates enable row level security;

-- public site: submit an enquiry (insert only, cannot read any back) and see blocked dates
create policy "anyone can submit enquiry" on enquiries for insert to anon, authenticated
  with check (status = 'new');
create policy "anyone can read blocked dates" on blocked_dates for select to anon, authenticated using (true);

-- admins only
create policy "admins read enquiries" on enquiries for select to authenticated using (is_admin());
create policy "admins update enquiries" on enquiries for update to authenticated using (is_admin()) with check (is_admin());
create policy "admins delete enquiries" on enquiries for delete to authenticated using (is_admin());
create policy "admins insert blocked" on blocked_dates for insert to authenticated with check (is_admin());
create policy "admins update blocked" on blocked_dates for update to authenticated using (is_admin()) with check (is_admin());
create policy "admins delete blocked" on blocked_dates for delete to authenticated using (is_admin());
