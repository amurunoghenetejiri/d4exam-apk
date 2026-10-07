-- D4EXAM: ensure notifications work for all roles (select own, cross-role insert via RPC + policy)

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  school_id uuid null references public.schools(id) on delete set null,
  title text not null,
  message text not null default '',
  type text not null default 'info',
  link text null,
  action_url text null,
  entity_type text null,
  entity_id text null,
  read_at timestamptz null,
  created_at timestamptz not null default now()
);

alter table public.notifications add column if not exists link text;
alter table public.notifications add column if not exists action_url text;
alter table public.notifications add column if not exists entity_type text;
alter table public.notifications add column if not exists message text;
alter table public.notifications add column if not exists type text default 'info';
alter table public.notifications add column if not exists read_at timestamptz;
alter table public.notifications add column if not exists school_id uuid;
alter table public.notifications add column if not exists entity_id text;

create index if not exists notifications_recipient_created_at_idx
  on public.notifications (recipient_user_id, created_at desc);

create index if not exists notifications_recipient_unread_idx
  on public.notifications (recipient_user_id)
  where read_at is null;

alter table public.notifications enable row level security;
alter table public.notifications replica identity full;

drop policy if exists notifications_select_own on public.notifications;
drop policy if exists notifications_update_own on public.notifications;
drop policy if exists notifications_delete_own on public.notifications;
drop policy if exists notifications_insert_self on public.notifications;
drop policy if exists notifications_authenticated_insert on public.notifications;
drop policy if exists "notifications_authenticated_insert" on public.notifications;
drop policy if exists "notifications_own_delete" on public.notifications;
drop policy if exists "notifications_own_select" on public.notifications;
drop policy if exists "notifications_own_update" on public.notifications;

create policy notifications_select_own
  on public.notifications for select to authenticated
  using (recipient_user_id = auth.uid());

create policy notifications_update_own
  on public.notifications for update to authenticated
  using (recipient_user_id = auth.uid())
  with check (recipient_user_id = auth.uid());

create policy notifications_delete_own
  on public.notifications for delete to authenticated
  using (recipient_user_id = auth.uid());

-- Allow authenticated users to insert a notification for any recipient
create policy notifications_authenticated_insert
  on public.notifications for insert to authenticated
  with check (
    recipient_user_id is not null
    and auth.uid() is not null
  );

drop function if exists public.insert_notification(uuid, text, text, text, uuid, text, text, text);
drop function if exists public.insert_notification(uuid, text, text, text, uuid, text, text, uuid);
drop function if exists public.insert_notification(uuid, text, text, text, text, uuid);

create or replace function public.insert_notification(
  _recipient uuid,
  _title text,
  _message text default '',
  _type text default 'info',
  _school_id uuid default null,
  _link text default null,
  _entity_type text default null,
  _entity_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  new_id uuid;
  v_url text;
begin
  if _recipient is null then
    raise exception 'recipient required';
  end if;

  v_url := nullif(trim(coalesce(_link, '')), '');

  insert into public.notifications (
    recipient_user_id, school_id, title, message, type, link, action_url, entity_type, entity_id
  ) values (
    _recipient,
    _school_id,
    coalesce(nullif(trim(_title), ''), 'Notification'),
    coalesce(_message, ''),
    coalesce(nullif(trim(_type), ''), 'info'),
    v_url,
    v_url,
    nullif(trim(coalesce(_entity_type, '')), ''),
    nullif(trim(coalesce(_entity_id, '')), '')
  )
  returning id into new_id;

  return new_id;
end;
$fn$;

revoke all on function public.insert_notification(uuid, text, text, text, uuid, text, text, text) from public;
grant execute on function public.insert_notification(uuid, text, text, text, uuid, text, text, text) to authenticated;
grant execute on function public.insert_notification(uuid, text, text, text, uuid, text, text, text) to service_role;

do $pub$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    execute 'alter publication supabase_realtime add table public.notifications';
  end if;
end;
$pub$;
