create extension if not exists "pgcrypto";

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  arch_type text not null check (arch_type in ('flat','normal','high','unknown')),
  usage text not null check (usage in ('road','trail','treadmill','casual','racing')),
  weekly_mileage int not null check (weekly_mileage >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  image_url text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.shoes (
  id uuid primary key default gen_random_uuid(),
  brand text not null,
  model text not null,
  terrain text not null check (terrain in ('road','trail','treadmill','casual','racing','mixed')),
  stability text not null check (stability in ('neutral','stable','motion_control')),
  cushion text not null check (cushion in ('low','medium','high')),
  drop_mm int,
  weight_g int,
  updated_at timestamptz not null default now(),
  unique (brand, model)
);

create table if not exists public.recommendations (
  scan_id uuid primary key references public.scans(id) on delete cascade,
  ranked jsonb not null,
  avoid jsonb not null,
  fallback_needed boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_scans_user_id on public.scans(user_id);
create index if not exists idx_shoes_brand_model on public.shoes(brand, model);
