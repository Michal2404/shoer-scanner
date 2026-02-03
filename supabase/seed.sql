insert into public.shoes (brand, model, terrain, stability, cushion, drop_mm, weight_g)
values
  ('Nike', 'Pegasus 40', 'road', 'neutral', 'medium', 10, 285),
  ('Brooks', 'Ghost 15', 'road', 'neutral', 'medium', 12, 286),
  ('Hoka', 'Clifton 9', 'road', 'neutral', 'high', 5, 248),
  ('Brooks', 'Cascadia 17', 'trail', 'stable', 'medium', 8, 300)
on conflict (brand, model) do nothing;
