-- Mirrors the three priced packages on the public site. Safe to re-run.
insert into services (name, description, price_pence, active) values
  ('Event', 'Up to 2 hours. Parties, leaving dos, birthdays and small corporate events. 50+ edited images, online gallery, 24h preview.', 15000, true),
  ('Wedding', 'Full-day coverage from preparation to first dance, with UK travel included. 400+ edited images, second-location option, print-ready files.', 90000, true),
  ('Sport & Commercial', 'Motorsport, brand events and editorial. Fast turnaround for press and sponsors. Same-day selects, licensing included.', 35000, true)
on conflict (name) do update set description = excluded.description, price_pence = excluded.price_pence;
notify pgrst, 'reload schema';
