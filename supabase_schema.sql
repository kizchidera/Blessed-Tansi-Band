-- Blessed Tansi Band Group: run this once in the Supabase SQL Editor.
-- After creating your first account, promote it manually from the SQL Editor:
-- UPDATE public.profiles SET role = 'superadmin', status = 'approved'
-- WHERE id = 'YOUR_AUTH_USER_UUID';

create extension if not exists pgcrypto;

create type public.app_role as enum ('superadmin', 'admin', 'user');
create type public.member_status as enum ('pending', 'approved', 'suspended');
create type public.payment_status as enum ('pending', 'verified', 'rejected');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  phone text,
  avatar_path text,
  member_id text not null unique default (
    'BTB-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
  ),
  role public.app_role not null default 'user',
  status public.member_status not null default 'pending',
  can_upload_minutes boolean not null default false,
  can_verify_payments boolean not null default false,
  can_view_financials boolean not null default false,
  can_post_announcements boolean not null default false,
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  description text not null default '',
  proof_path text,
  status public.payment_status not null default 'pending',
  paid_at timestamptz not null default now(),
  verified_by uuid references public.profiles (id),
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.minutes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  meeting_date date not null,
  file_path text not null,
  uploaded_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  urgent boolean not null default false,
  posted_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.site_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id)
);

insert into public.site_settings (key, value) values
  ('hero_title', '"Blessed Tansi Band Group"'::jsonb),
  ('hero_subtitle', '"Together in music, service, and community."'::jsonb),
  ('logo_path', 'null'::jsonb)
on conflict (key) do nothing;

create or replace function public.is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'superadmin' and status = 'approved'
  );
$$;

create or replace function public.is_approved_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'approved'
  );
$$;

create or replace function public.has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select status = 'approved' and (
      role = 'superadmin'
      or (
        role = 'admin'
        and case p_permission
          when 'can_upload_minutes' then can_upload_minutes
          when 'can_verify_payments' then can_verify_payments
          when 'can_view_financials' then can_view_financials
          when 'can_post_announcements' then can_post_announcements
          else false
        end
      )
    )
    from public.profiles
    where id = auth.uid()
  ), false);
$$;

revoke all on function public.is_superadmin() from public, anon;
revoke all on function public.is_approved_member() from public, anon;
revoke all on function public.has_permission(text) from public, anon;
grant execute on function public.is_superadmin() to authenticated;
grant execute on function public.is_approved_member() to authenticated;
grant execute on function public.has_permission(text) to authenticated;

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.create_profile_for_new_user();

create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.is_superadmin() then
    if new.role is distinct from old.role
      or new.status is distinct from old.status
      or new.can_upload_minutes is distinct from old.can_upload_minutes
      or new.can_verify_payments is distinct from old.can_verify_payments
      or new.can_view_financials is distinct from old.can_view_financials
      or new.can_post_announcements is distinct from old.can_post_announcements
      or new.member_id is distinct from old.member_id
      or new.joined_at is distinct from old.joined_at then
      raise exception 'Only a superadmin can change member access or permissions';
    end if;
  end if;
  new.updated_at = now();
  return new;
end;
$$;

create trigger protect_profile_privileges_before_update
  before update on public.profiles
  for each row execute procedure public.protect_profile_privileges();

create or replace function public.protect_payment_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.has_permission('can_verify_payments') then
    if new.user_id is distinct from old.user_id
      or new.status is distinct from old.status
      or new.verified_by is distinct from old.verified_by
      or new.verified_at is distinct from old.verified_at
      or new.paid_at is distinct from old.paid_at then
      raise exception 'Only an authorized treasurer can verify payments';
    end if;
  elsif auth.uid() is not null and not public.is_superadmin() then
    if new.user_id is distinct from old.user_id
      or new.amount is distinct from old.amount
      or new.description is distinct from old.description
      or new.proof_path is distinct from old.proof_path
      or new.paid_at is distinct from old.paid_at
      or new.created_at is distinct from old.created_at
      or new.status not in ('verified', 'rejected')
      or new.verified_by is distinct from auth.uid()
      or new.verified_at is null then
      raise exception 'Treasurers may only verify or reject submitted payments';
    end if;
  end if;
  return new;
end;
$$;

create trigger protect_payment_fields_before_update
  before update on public.payments
  for each row execute procedure public.protect_payment_fields();

create or replace function public.import_historical_payment(
  p_user_id uuid,
  p_amount numeric,
  p_description text,
  p_paid_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_payment_id uuid;
begin
  if not public.is_superadmin() then
    raise exception 'Only a superadmin can import historical payments';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = p_user_id and status = 'approved'
  ) then
    raise exception 'The member does not exist or is not approved';
  end if;

  insert into public.payments (
    user_id, amount, description, paid_at, status, verified_by, verified_at
  )
  values (
    p_user_id, p_amount, coalesce(p_description, ''), p_paid_at,
    'verified', auth.uid(), now()
  )
  returning id into new_payment_id;
  return new_payment_id;
end;
$$;

alter table public.profiles enable row level security;
alter table public.payments enable row level security;
alter table public.minutes enable row level security;
alter table public.announcements enable row level security;
alter table public.site_settings enable row level security;

create policy "Profiles are visible to their owner, approved members, and admins"
  on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or (status = 'approved' and public.is_approved_member())
    or public.is_superadmin()
  );

create policy "Members can update their own contact details"
  on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_superadmin())
  with check (id = auth.uid() or public.is_superadmin());

create policy "Members can read their payments and finance executives can read all"
  on public.payments for select to authenticated
  using (
    (user_id = auth.uid() and public.is_approved_member())
    or public.has_permission('can_verify_payments')
    or public.has_permission('can_view_financials')
  );

create policy "Approved members can submit their own payments"
  on public.payments for insert to authenticated
  with check (
    user_id = auth.uid()
    and status = 'pending'
    and verified_by is null
    and verified_at is null
    and public.is_approved_member()
  );

create policy "Authorized treasurers can verify payments"
  on public.payments for update to authenticated
  using (public.has_permission('can_verify_payments'))
  with check (public.has_permission('can_verify_payments'));

create policy "Approved members can read minutes"
  on public.minutes for select to authenticated
  using (public.is_approved_member());

create policy "Authorized secretaries can manage minutes"
  on public.minutes for all to authenticated
  using (public.has_permission('can_upload_minutes'))
  with check (public.has_permission('can_upload_minutes'));

create policy "Approved members can read announcements"
  on public.announcements for select to authenticated
  using (public.is_approved_member());

create policy "Authorized executives can post announcements"
  on public.announcements for insert to authenticated
  with check (
    public.has_permission('can_post_announcements')
    and posted_by = auth.uid()
  );

create policy "Superadmins can manage announcements"
  on public.announcements for update to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

create policy "Site settings are publicly readable"
  on public.site_settings for select to anon, authenticated
  using (true);

create policy "Superadmins can manage site settings"
  on public.site_settings for all to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

create or replace view public.financial_summary
with (security_invoker = true)
as
  select user_id, sum(amount) as total_verified
  from public.payments
  where status = 'verified'
  group by user_id;

grant select, update on public.profiles to authenticated;
grant select, insert, update on public.payments to authenticated;
grant select, insert, update, delete on public.minutes to authenticated;
grant select, insert, update on public.announcements to authenticated;
grant select on public.site_settings to anon, authenticated;
grant insert, update, delete on public.site_settings to authenticated;
grant select on public.financial_summary to authenticated;
revoke all on function public.import_historical_payment(uuid, numeric, text, timestamptz) from public, anon;
grant execute on function public.import_historical_payment(uuid, numeric, text, timestamptz) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('payment-receipts', 'payment-receipts', false, 10485760, array['image/jpeg','image/png','image/webp','application/pdf']),
  ('meeting-minutes', 'meeting-minutes', false, 20971520, array['application/pdf']),
  ('member-avatars', 'member-avatars', true, 5242880, array['image/jpeg','image/png','image/webp']),
  ('site-branding', 'site-branding', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Members can upload receipts to their own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'payment-receipts'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_approved_member()
  );

create policy "Owners and treasurers can read receipts"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'payment-receipts'
    and (
      ((storage.foldername(name))[1] = auth.uid()::text and public.is_approved_member())
      or public.has_permission('can_verify_payments')
    )
  );

create policy "Members can remove their own receipts"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'payment-receipts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Approved members can read meeting minutes"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'meeting-minutes'
    and public.is_approved_member()
  );

create policy "Authorized secretaries can upload meeting minutes"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'meeting-minutes'
    and public.has_permission('can_upload_minutes')
  );

create policy "Authorized secretaries can update or delete meeting minutes"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'meeting-minutes'
    and public.has_permission('can_upload_minutes')
  )
  with check (
    bucket_id = 'meeting-minutes'
    and public.has_permission('can_upload_minutes')
  );

create policy "Authorized secretaries can delete meeting minutes"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'meeting-minutes'
    and public.has_permission('can_upload_minutes')
  );

create policy "Authenticated users can upload their own avatar"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'member-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_approved_member()
  );

create policy "Users can replace their own avatar"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'member-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'member-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Superadmins can upload site branding"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'site-branding'
    and public.is_superadmin()
  );

create policy "Superadmins can update site branding"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'site-branding'
    and public.is_superadmin()
  )
  with check (
    bucket_id = 'site-branding'
    and public.is_superadmin()
  );

create policy "Superadmins can delete site branding"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'site-branding'
    and public.is_superadmin()
  );
