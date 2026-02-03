insert into public.users (arch_type, usage, weekly_mileage)
values ('flat', 'trail', 20)
returning id;
