-- Run once in Supabase SQL Editor, after schema.sql. Safe to re-run.
-- Money is stored in pence.

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null check (length(name) between 1 and 200),
  email text check (length(email) <= 320),
  phone text check (length(phone) <= 50),
  company text check (length(company) <= 200),
  address text check (length(address) <= 500),
  source text check (length(source) <= 100),          -- website, referral, repeat...
  marketing_ok boolean not null default false,
  notes text check (length(notes) <= 5000),
  enquiry_id uuid references enquiries(id) on delete set null
);
create unique index if not exists customers_email_key on customers (lower(email)) where email is not null and email <> '';

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  title text not null check (length(title) between 1 and 200),
  event_type text check (length(event_type) <= 100),
  event_date date,
  start_time time,
  end_time time,
  location text check (length(location) <= 300),
  status text not null default 'scheduled' check (status in ('scheduled','shot','delivered','cancelled')),
  notes text check (length(notes) <= 5000)
);

create table if not exists services (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(name) between 1 and 200),
  description text check (length(description) <= 2000),
  price_pence integer not null default 0 check (price_pence >= 0),
  active boolean not null default true
);

create sequence if not exists order_ref_seq;
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  order_ref text not null unique default 'WEP-' || lpad(nextval('order_ref_seq')::text, 4, '0'),
  event_id uuid references events(id) on delete restrict,
  service_id uuid references services(id) on delete set null,
  status text not null default 'quote' check (status in ('quote','booked','completed','cancelled')),
  total_pence integer not null default 0 check (total_pence >= 0),
  notes text check (length(notes) <= 5000)
);

-- what was ordered; the order total is the sum of these
create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  service_id uuid references services(id) on delete set null,
  description text not null check (length(description) between 1 and 300),
  quantity integer not null default 1 check (quantity > 0),
  unit_price_pence integer not null default 0 check (unit_price_pence >= 0)
);
create index if not exists order_items_order_idx on order_items (order_id);

-- every order belongs to one event (not valid = applies to new/changed rows, old test rows are left alone)
alter table orders drop constraint if exists orders_event_id_fkey;
alter table orders add constraint orders_event_id_fkey foreign key (event_id) references events(id) on delete restrict;
alter table orders drop constraint if exists orders_event_required;
alter table orders add constraint orders_event_required check (event_id is not null) not valid;

-- enquiries get a 'converted' status once turned into customer + event + order
alter table enquiries drop constraint if exists enquiries_status_check;
alter table enquiries add constraint enquiries_status_check check (status in ('new','confirmed','declined','converted'));

-- many customers per order (couple, company + contact) and many orders per customer
create table if not exists customer_orders (
  customer_id uuid not null references customers(id) on delete cascade,
  order_id uuid not null references orders(id) on delete cascade,
  role text not null default 'primary' check (role in ('primary','additional')),
  primary key (customer_id, order_id)
);
create index if not exists customer_orders_order_idx on customer_orders (order_id);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  order_id uuid not null references orders(id) on delete cascade,
  amount_pence integer not null check (amount_pence <> 0),   -- negative = refund
  method text check (length(method) <= 50),
  paid_on date not null default current_date,
  note text check (length(note) <= 500)
);
create index if not exists payments_order_idx on payments (order_id);

do $$
declare t text;
begin
  foreach t in array array['customers','events','services','orders','order_items','customer_orders','payments'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "admins all" on %I', t);
    execute format('create policy "admins all" on %I for all to authenticated using (wep_is_admin()) with check (wep_is_admin())', t);
  end loop;
end $$;
