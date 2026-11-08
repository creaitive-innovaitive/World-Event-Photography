-- Run in Supabase SQL Editor after schema.sql and customers.sql. Safe to re-run.
-- Adds: multi-day events, special requests, feedback, proof photos (private storage), and the
-- customer portal. Customers are matched to their record by sign-in email, so the email on the
-- customer must match the one they log in with.

alter table events add column if not exists end_date date;
alter table events add column if not exists proofs_published boolean not null default false;
alter table events drop constraint if exists events_end_after_start;
alter table events add constraint events_end_after_start check (end_date is null or event_date is null or end_date >= event_date);

create table if not exists order_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  order_id uuid not null references orders(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  author text not null default 'customer' check (author in ('customer','admin')),
  day date,                                                   -- null = whole event
  kind text not null default 'other' check (kind in ('shot','timing','people','location','other')),
  body text not null check (length(body) between 1 and 2000),
  status text not null default 'open' check (status in ('open','noted','done'))
);
create index if not exists order_requests_order_idx on order_requests (order_id);

create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  order_id uuid not null references orders(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  comment text check (length(comment) <= 3000),
  public_ok boolean not null default false,                   -- OK to quote on the website
  unique (order_id, customer_id)
);

-- original_path is admin-only (private bucket); customers get preview_path, a watermarked low-res copy
create table if not exists photos (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  event_id uuid not null references events(id) on delete cascade,
  filename text check (length(filename) <= 300),
  original_path text not null,
  preview_path text not null,
  width integer,
  height integer
);
create index if not exists photos_event_idx on photos (event_id);

-- customers' favourites, for choosing prints / the final edit
create table if not exists photo_picks (
  photo_id uuid not null references photos(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (photo_id, customer_id)
);

-- who is signed in, as a customer. security definer so customers never need read access to core tables.
create or replace function wep_my_customer_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from customers where lower(email) = lower(auth.jwt() ->> 'email') limit 1;
$$;
create or replace function wep_my_order_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select order_id from customer_orders where customer_id = wep_my_customer_id();
$$;
create or replace function wep_can_view_proof(path text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from photos p join events e on e.id = p.event_id join orders o on o.event_id = e.id
    where p.preview_path = path and e.proofs_published and o.id in (select wep_my_order_ids()));
$$;

create or replace function wep_can_pick_photo(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from photos p join events e on e.id = p.event_id join orders o on o.event_id = e.id
    where p.id = pid and e.proofs_published and o.id in (select wep_my_order_ids()));
$$;

-- Everything the portal shows, in one call, with only customer-safe columns (no internal notes).
create or replace function portal_data() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'picks', coalesce((select jsonb_agg(photo_id) from photo_picks where customer_id = c.id), '[]'::jsonb),
    'customer', jsonb_build_object('id', c.id, 'name', c.name, 'email', c.email, 'phone', c.phone, 'company', c.company, 'address', c.address, 'marketing_ok', c.marketing_ok),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'order_ref', o.order_ref, 'status', o.status, 'total_pence', o.total_pence,
        'paid_pence', coalesce((select sum(p.amount_pence) from payments p where p.order_id = o.id), 0),
        'event', jsonb_build_object('id', e.id, 'title', e.title, 'event_type', e.event_type, 'event_date', e.event_date, 'end_date', e.end_date,
                 'start_time', e.start_time, 'end_time', e.end_time, 'location', e.location, 'status', e.status, 'proofs_published', e.proofs_published),
        'items', coalesce((select jsonb_agg(jsonb_build_object('description', i.description, 'quantity', i.quantity, 'unit_price_pence', i.unit_price_pence) order by i.description)
                           from order_items i where i.order_id = o.id), '[]'),
        'requests', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'day', r.day, 'kind', r.kind, 'body', r.body, 'status', r.status, 'author', r.author, 'created_at', r.created_at)
                              order by r.day nulls first, r.created_at)
                              from order_requests r where r.order_id = o.id), '[]'),
        'feedback', (select jsonb_build_object('rating', f.rating, 'comment', f.comment, 'public_ok', f.public_ok)
                     from feedback f where f.order_id = o.id and f.customer_id = c.id),
        'photos', case when e.proofs_published then coalesce((
                    select jsonb_agg(jsonb_build_object('id', ph.id, 'preview_path', ph.preview_path, 'width', ph.width, 'height', ph.height) order by ph.created_at)
                    from photos ph where ph.event_id = e.id), '[]') else '[]'::jsonb end
      ) order by e.event_date desc nulls last, o.created_at desc)
      from customer_orders co join orders o on o.id = co.order_id join events e on e.id = o.event_id
      where co.customer_id = c.id), '[]'::jsonb))
  from customers c where c.id = wep_my_customer_id();
$$;

-- customers can edit their own contact details, nothing else on their record
create or replace function portal_update_profile(p_name text, p_phone text, p_address text, p_marketing boolean) returns void
language sql security definer set search_path = public as $$
  update customers set
    name = left(coalesce(nullif(trim(p_name), ''), name), 200),
    phone = nullif(left(trim(coalesce(p_phone, '')), 50), ''),
    address = nullif(left(trim(coalesce(p_address, '')), 500), ''),
    marketing_ok = coalesce(p_marketing, marketing_ok)
  where id = wep_my_customer_id();
$$;

revoke execute on function portal_data(), portal_update_profile(text, text, text, boolean) from public, anon;
grant execute on function portal_data(), portal_update_profile(text, text, text, boolean) to authenticated;

alter table order_requests enable row level security;
alter table feedback enable row level security;
alter table photos enable row level security;
alter table photo_picks enable row level security;

do $$
declare t text;
begin
  foreach t in array array['order_requests','feedback','photos','photo_picks'] loop
    execute format('drop policy if exists "admins all" on %I', t);
    execute format('create policy "admins all" on %I for all to authenticated using (wep_is_admin()) with check (wep_is_admin())', t);
  end loop;
end $$;

-- customers: their own requests (editable only while still open) and their own feedback
drop policy if exists "customer reads own requests" on order_requests;
create policy "customer reads own requests" on order_requests for select to authenticated using (order_id in (select wep_my_order_ids()));
drop policy if exists "customer adds requests" on order_requests;
create policy "customer adds requests" on order_requests for insert to authenticated
  with check (author = 'customer' and status = 'open' and customer_id = wep_my_customer_id() and order_id in (select wep_my_order_ids()));
drop policy if exists "customer edits open requests" on order_requests;
create policy "customer edits open requests" on order_requests for update to authenticated
  using (author = 'customer' and status = 'open' and order_id in (select wep_my_order_ids()))
  with check (author = 'customer' and status = 'open' and customer_id = wep_my_customer_id() and order_id in (select wep_my_order_ids()));
drop policy if exists "customer deletes open requests" on order_requests;
create policy "customer deletes open requests" on order_requests for delete to authenticated
  using (author = 'customer' and status = 'open' and order_id in (select wep_my_order_ids()));

drop policy if exists "customer reads own feedback" on feedback;
create policy "customer reads own feedback" on feedback for select to authenticated using (customer_id = wep_my_customer_id());
drop policy if exists "customer adds feedback" on feedback;
create policy "customer adds feedback" on feedback for insert to authenticated
  with check (customer_id = wep_my_customer_id() and order_id in (select wep_my_order_ids()));
drop policy if exists "customer edits feedback" on feedback;
create policy "customer edits feedback" on feedback for update to authenticated
  using (customer_id = wep_my_customer_id()) with check (customer_id = wep_my_customer_id() and order_id in (select wep_my_order_ids()));

drop policy if exists "customer reads own picks" on photo_picks;
create policy "customer reads own picks" on photo_picks for select to authenticated using (customer_id = wep_my_customer_id());
drop policy if exists "customer adds picks" on photo_picks;
create policy "customer adds picks" on photo_picks for insert to authenticated
  with check (customer_id = wep_my_customer_id() and wep_can_pick_photo(photo_id));
drop policy if exists "customer removes picks" on photo_picks;
create policy "customer removes picks" on photo_picks for delete to authenticated using (customer_id = wep_my_customer_id());

-- storage: originals never leave the admin side; proofs are readable only by the event's customers once published
insert into storage.buckets (id, name, public) values ('proofs', 'proofs', false), ('originals', 'originals', false)
on conflict (id) do nothing;
drop policy if exists "wep admin storage" on storage.objects;
create policy "wep admin storage" on storage.objects for all to authenticated
  using (bucket_id in ('proofs', 'originals') and wep_is_admin()) with check (bucket_id in ('proofs', 'originals') and wep_is_admin());
drop policy if exists "wep customers view proofs" on storage.objects;
create policy "wep customers view proofs" on storage.objects for select to authenticated
  using (bucket_id = 'proofs' and wep_can_view_proof(name));
