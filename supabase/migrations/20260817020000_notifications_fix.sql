-- D4EXAM notifications - matches NotificationsPage + src/lib/notify.ts

drop function if exists public.insert_notification(uuid, text, text, text, uuid, text, text, text);
drop function if exists public.insert_notification(uuid, text, text, text, text, uuid);
drop function if exists public.mark_all_notifications_read();
drop function if exists public.notifications_add_to_realtime();
drop table if exists public.notifications cascade;

create table public.notifications (
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

create index notifications_recipient_created_at_idx
  on public.notifications (recipient_user_id, created_at desc);

create index notifications_recipient_unread_idx
  on public.notifications (recipient_user_id)
  where read_at is null;

alter table public.notifications enable row level security;

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

create policy notifications_insert_self
  on public.notifications for insert to authenticated
  with check (recipient_user_id = auth.uid());

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
as '
declare
  new_id uuid;
  v_url text;
begin
  if _recipient is null then
    raise exception ''recipient is required'';
  end if;
  if _title is null or length(trim(_title)) = 0 then
    raise exception ''title is required'';
  end if;

  v_url := nullif(trim(coalesce(_link, '''')), '''');

  insert into public.notifications (
    recipient_user_id, school_id, title, message, type, link, action_url, entity_type, entity_id
  ) values (
    _recipient,
    _school_id,
    trim(_title),
    coalesce(_message, ''''),
    coalesce(nullif(trim(_type), ''''), ''info''),
    v_url,
    v_url,
    nullif(trim(coalesce(_entity_type, '''')), ''''),
    nullif(trim(coalesce(_entity_id, '''')), '''')
  )
  returning id into new_id;

  return new_id;
end;
';

revoke all on function public.insert_notification(uuid, text, text, text, uuid, text, text, text) from public;
grant execute on function public.insert_notification(uuid, text, text, text, uuid, text, text, text) to authenticated;
grant execute on function public.insert_notification(uuid, text, text, text, uuid, text, text, text) to service_role;

create or replace function public.notifications_add_to_realtime()
returns void
language plpgsql
security definer
set search_path = public
as '
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = ''supabase_realtime''
      and schemaname = ''public''
      and tablename = ''notifications''
  ) then
    execute ''alter publication supabase_realtime add table public.notifications'';
  end if;
end;
';

select public.notifications_add_to_realtime();
