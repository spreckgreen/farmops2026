-- 1. Enums
create type public.app_role as enum ('viewer', 'editor', 'admin');
create type public.approval_status as enum ('pending', 'approved', 'rejected');

-- 2. profiles table
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  status public.approval_status not null default 'pending',
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;

create trigger profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- 3. user_roles table
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

-- 4. has_role (security definer to avoid recursive RLS)
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  )
$$;

-- 5. RLS on profiles
create policy "Users read own profile"
  on public.profiles for select to authenticated
  using (id = auth.uid());

create policy "Admins read all profiles"
  on public.profiles for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

create policy "Users insert own profile"
  on public.profiles for insert to authenticated
  with check (id = auth.uid());

create policy "Admins update any profile"
  on public.profiles for update to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- 6. RLS on user_roles
create policy "Users read own roles"
  on public.user_roles for select to authenticated
  using (user_id = auth.uid());

create policy "Admins read all roles"
  on public.user_roles for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- writes to user_roles only via service_role (server functions verify admin first).

-- 7. Seed existing user as approved admin
insert into public.profiles (id, email, status, reviewed_at)
select id, email, 'approved', now() from auth.users
on conflict (id) do update
  set status = 'approved', reviewed_at = excluded.reviewed_at;

insert into public.user_roles (user_id, role)
select id, 'admin' from auth.users
where email = 'rpremo@live.com'
on conflict (user_id, role) do nothing;

-- Also give existing user editor + viewer so role checks pass anywhere
insert into public.user_roles (user_id, role)
select id, 'editor' from auth.users where email = 'rpremo@live.com'
on conflict do nothing;
insert into public.user_roles (user_id, role)
select id, 'viewer' from auth.users where email = 'rpremo@live.com'
on conflict do nothing;