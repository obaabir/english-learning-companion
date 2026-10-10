-- English World: database for the community section.
-- Run ONCE in Supabase → SQL Editor → New query → paste all → Run.
-- Safe to run again: existing posts are kept.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Safety helpers
-- ---------------------------------------------------------------------------

-- Rejects phone numbers, emails, social media handles and links (checked on the server too).
create or replace function public.ew_guard_text(t text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if t is null then
    return;
  end if;
  if t ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' then
    raise exception 'EW_PERSONAL: Please remove the email address. Personal details are not allowed.';
  end if;
  if t ~ '([0-9০-৯][ ().-]*){10,}' then
    raise exception 'EW_PERSONAL: Please remove the phone number. Personal details are not allowed.';
  end if;
  if t ~* '(^|[^a-z0-9_])@[a-z0-9_.]{3,}' or t ~* '(instagram\.com|facebook\.com|fb\.com|fb\.me|tiktok\.com|t\.me|wa\.me|snapchat\.com|twitter\.com|x\.com/)' then
    raise exception 'EW_PERSONAL: Please remove social media handles or links. Personal details are not allowed.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.ew_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 30),
  avatar text not null default '🙂' check (char_length(avatar) between 1 and 16),
  level text not null check (level in ('Beginner', 'Intermediate', 'IELTS')),
  goal text not null default '' check (char_length(goal) <= 120),
  created_at timestamptz not null default now()
);

create table if not exists public.ew_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.ew_profiles (id) on delete cascade,
  kind text not null check (kind in ('post', 'question', 'story', 'win')),
  text text not null check (char_length(btrim(text)) between 1 and 500),
  image text check (image is null or (image like 'data:image/jpeg;base64,%' and char_length(image) <= 1400000)),
  has_image boolean generated always as (image is not null) stored,
  bg text check (bg is null or bg ~ '^#[0-9a-fA-F]{6}$'),
  tags text[] not null default '{}',
  correct_me boolean not null default false,
  challenge_day date,
  ai_answer jsonb,
  solved_comment_id uuid,
  circle_code text,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);
create index if not exists ew_posts_created_idx on public.ew_posts (created_at desc);
create index if not exists ew_posts_challenge_idx on public.ew_posts (challenge_day);
create index if not exists ew_posts_author_idx on public.ew_posts (author_id);

create table if not exists public.ew_reactions (
  post_id uuid not null references public.ew_posts (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.ew_profiles (id) on delete cascade,
  type text not null check (type in ('learned', 'brave', 'clear')),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id, type)
);

create table if not exists public.ew_fixes (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.ew_posts (id) on delete cascade,
  author_id uuid not null references public.ew_profiles (id) on delete cascade,
  text text not null check (char_length(btrim(text)) between 1 and 500),
  note text not null default '' check (char_length(note) <= 200),
  helpful boolean not null default false,
  helpful_at timestamptz,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists ew_fixes_post_idx on public.ew_fixes (post_id);

create table if not exists public.ew_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.ew_posts (id) on delete cascade,
  parent_id uuid references public.ew_comments (id) on delete cascade,
  author_id uuid not null references public.ew_profiles (id) on delete cascade,
  text text not null check (char_length(btrim(text)) between 1 and 500),
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists ew_comments_post_idx on public.ew_comments (post_id);

create table if not exists public.ew_reports (
  target_type text not null check (target_type in ('post', 'comment', 'fix', 'profile')),
  target_id uuid not null,
  reporter_id uuid not null default auth.uid() references public.ew_profiles (id) on delete cascade,
  reason text not null check (reason in ('bullying', 'inappropriate', 'personal_info', 'spam')),
  created_at timestamptz not null default now(),
  primary key (target_type, target_id, reporter_id, reason)
);

create table if not exists public.ew_mod (
  id int primary key default 1 check (id = 1),
  passcode_hash text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Triggers: personal-info guard, one level of replies, rate limits, 3 reports → hidden
-- ---------------------------------------------------------------------------

create or replace function public.ew_check_row()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  recent int;
begin
  perform public.ew_guard_text(new.text);
  if tg_table_name = 'ew_fixes' then
    perform public.ew_guard_text(new.note);
  end if;
  if tg_table_name = 'ew_posts' then
    select count(*) into recent from public.ew_posts where author_id = new.author_id and created_at > now() - interval '1 hour';
    if recent >= 20 then
      raise exception 'EW_LIMIT: You have posted a lot this hour. Take a short break and try again later.';
    end if;
  elsif tg_table_name = 'ew_comments' then
    if new.parent_id is not null and exists (select 1 from public.ew_comments c where c.id = new.parent_id and (c.parent_id is not null or c.post_id <> new.post_id)) then
      raise exception 'EW_REPLY: You can only reply to a comment, not to a reply.';
    end if;
    select count(*) into recent from public.ew_comments where author_id = new.author_id and created_at > now() - interval '1 hour';
    if recent >= 60 then
      raise exception 'EW_LIMIT: You have commented a lot this hour. Take a short break and try again later.';
    end if;
  elsif tg_table_name = 'ew_fixes' then
    select count(*) into recent from public.ew_fixes where author_id = new.author_id and created_at > now() - interval '1 hour';
    if recent >= 60 then
      raise exception 'EW_LIMIT: You have sent a lot of corrections this hour. Take a short break and try again later.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists ew_posts_check on public.ew_posts;
create trigger ew_posts_check before insert on public.ew_posts for each row execute function public.ew_check_row();
drop trigger if exists ew_comments_check on public.ew_comments;
create trigger ew_comments_check before insert on public.ew_comments for each row execute function public.ew_check_row();
drop trigger if exists ew_fixes_check on public.ew_fixes;
create trigger ew_fixes_check before insert on public.ew_fixes for each row execute function public.ew_check_row();

create or replace function public.ew_check_profile()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform public.ew_guard_text(new.name);
  perform public.ew_guard_text(new.goal);
  return new;
end;
$$;
drop trigger if exists ew_profiles_check on public.ew_profiles;
create trigger ew_profiles_check before insert or update on public.ew_profiles for each row execute function public.ew_check_profile();

-- 3 or more different people report something → hidden for everyone until a moderator reviews it.
create or replace function public.ew_after_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  select count(distinct reporter_id) into n from public.ew_reports where target_type = new.target_type and target_id = new.target_id;
  if n >= 3 then
    if new.target_type = 'post' then
      update public.ew_posts set hidden = true where id = new.target_id;
    elsif new.target_type = 'comment' then
      update public.ew_comments set hidden = true where id = new.target_id;
    elsif new.target_type = 'fix' then
      update public.ew_fixes set hidden = true where id = new.target_id;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists ew_reports_after on public.ew_reports;
create trigger ew_reports_after after insert on public.ew_reports for each row execute function public.ew_after_report();

-- ---------------------------------------------------------------------------
-- Row level security: who can read and write what
-- (Posts, comments and corrections are written only by the "ew-api" Edge Function,
--  after its safety check. Nobody can write them directly.)
-- ---------------------------------------------------------------------------

alter table public.ew_profiles enable row level security;
alter table public.ew_posts enable row level security;
alter table public.ew_reactions enable row level security;
alter table public.ew_fixes enable row level security;
alter table public.ew_comments enable row level security;
alter table public.ew_reports enable row level security;
alter table public.ew_mod enable row level security;

revoke all on public.ew_profiles, public.ew_posts, public.ew_reactions, public.ew_fixes, public.ew_comments, public.ew_reports, public.ew_mod from anon, authenticated;
grant select, insert, update on public.ew_profiles to authenticated;
grant select, delete on public.ew_posts to authenticated;
grant select, insert, delete on public.ew_reactions to authenticated;
grant select, delete on public.ew_fixes to authenticated;
grant select, delete on public.ew_comments to authenticated;
grant insert on public.ew_reports to authenticated;

drop policy if exists ew_profiles_read on public.ew_profiles;
create policy ew_profiles_read on public.ew_profiles for select to authenticated using (true);
drop policy if exists ew_profiles_insert on public.ew_profiles;
create policy ew_profiles_insert on public.ew_profiles for insert to authenticated with check (id = auth.uid());
drop policy if exists ew_profiles_update on public.ew_profiles;
create policy ew_profiles_update on public.ew_profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists ew_posts_read on public.ew_posts;
create policy ew_posts_read on public.ew_posts for select to authenticated
  using ((not hidden or author_id = auth.uid()) and (expires_at is null or expires_at > now()) and circle_code is null);
drop policy if exists ew_posts_delete on public.ew_posts;
create policy ew_posts_delete on public.ew_posts for delete to authenticated using (author_id = auth.uid());

drop policy if exists ew_reactions_read on public.ew_reactions;
create policy ew_reactions_read on public.ew_reactions for select to authenticated using (true);
drop policy if exists ew_reactions_insert on public.ew_reactions;
create policy ew_reactions_insert on public.ew_reactions for insert to authenticated with check (user_id = auth.uid());
drop policy if exists ew_reactions_delete on public.ew_reactions;
create policy ew_reactions_delete on public.ew_reactions for delete to authenticated using (user_id = auth.uid());

drop policy if exists ew_fixes_read on public.ew_fixes;
create policy ew_fixes_read on public.ew_fixes for select to authenticated using (not hidden or author_id = auth.uid());
drop policy if exists ew_fixes_delete on public.ew_fixes;
create policy ew_fixes_delete on public.ew_fixes for delete to authenticated using (author_id = auth.uid());

drop policy if exists ew_comments_read on public.ew_comments;
create policy ew_comments_read on public.ew_comments for select to authenticated using (not hidden or author_id = auth.uid());
drop policy if exists ew_comments_delete on public.ew_comments;
create policy ew_comments_delete on public.ew_comments for delete to authenticated using (author_id = auth.uid());

drop policy if exists ew_reports_insert on public.ew_reports;
create policy ew_reports_insert on public.ew_reports for insert to authenticated with check (reporter_id = auth.uid());
-- ew_mod: no policies (only the functions below can use it).

-- ---------------------------------------------------------------------------
-- Functions the app calls
-- ---------------------------------------------------------------------------

-- Reaction / correction / comment counts for the posts on screen (one call).
create or replace function public.ew_stats(ids uuid[])
returns table (post_id uuid, learned int, brave int, clear int, fixes int, comments int, mine text[])
language sql
stable
security invoker
set search_path = public
as $$
  select p.id,
    (select count(*) from public.ew_reactions r where r.post_id = p.id and r.type = 'learned')::int,
    (select count(*) from public.ew_reactions r where r.post_id = p.id and r.type = 'brave')::int,
    (select count(*) from public.ew_reactions r where r.post_id = p.id and r.type = 'clear')::int,
    (select count(*) from public.ew_fixes f where f.post_id = p.id and not f.hidden)::int,
    (select count(*) from public.ew_comments c where c.post_id = p.id and not c.hidden)::int,
    coalesce((select array_agg(r.type) from public.ew_reactions r where r.post_id = p.id and r.user_id = auth.uid()), '{}')
  from public.ew_posts p
  where p.id = any (ids);
$$;

-- Only the post's author can mark a correction "Helpful".
create or replace function public.ew_mark_helpful(fix uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ew_fixes f set helpful = true, helpful_at = now()
  where f.id = fix and not f.helpful
    and exists (select 1 from public.ew_posts p where p.id = f.post_id and p.author_id = auth.uid())
    and f.author_id <> auth.uid();
  return found;
end;
$$;

-- Only the asker can mark one answer "Solved".
create or replace function public.ew_mark_solved(comment uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ew_posts p set solved_comment_id = comment
  where p.author_id = auth.uid() and p.kind = 'question'
    and exists (select 1 from public.ew_comments c where c.id = comment and c.post_id = p.id);
  return found;
end;
$$;

-- In-app bell: what happened to my posts and corrections since a time.
create or replace function public.ew_notifications(since timestamptz)
returns table (kind text, post_id uuid, actor_name text, actor_avatar text, detail text, at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select * from (
    select 'reaction'::text, r.post_id, pr.name, pr.avatar, r.type, r.created_at
      from public.ew_reactions r join public.ew_posts p on p.id = r.post_id join public.ew_profiles pr on pr.id = r.user_id
      where p.author_id = auth.uid() and r.user_id <> auth.uid() and r.created_at > since
    union all
    select 'correction', f.post_id, pr.name, pr.avatar, left(f.text, 80), f.created_at
      from public.ew_fixes f join public.ew_posts p on p.id = f.post_id join public.ew_profiles pr on pr.id = f.author_id
      where p.author_id = auth.uid() and f.author_id <> auth.uid() and not f.hidden and f.created_at > since
    union all
    select 'helpful', f.post_id, pr.name, pr.avatar, left(f.text, 80), f.helpful_at
      from public.ew_fixes f join public.ew_posts p on p.id = f.post_id join public.ew_profiles pr on pr.id = p.author_id
      where f.author_id = auth.uid() and f.helpful and f.helpful_at > since
    union all
    select 'answer', c.post_id, pr.name, pr.avatar, left(c.text, 80), c.created_at
      from public.ew_comments c join public.ew_posts p on p.id = c.post_id join public.ew_profiles pr on pr.id = c.author_id
      where p.author_id = auth.uid() and c.author_id <> auth.uid() and not c.hidden and c.created_at > since
  ) n
  order by 6 desc
  limit 50;
$$;

-- Moderator mode (basic protection: one shared passcode, stored only as a hash).
create or replace function public.ew_mod_status()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.ew_mod);
$$;

create or replace function public.ew_mod_setup(passcode text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if char_length(passcode) < 6 then
    raise exception 'EW_MOD: The passcode needs at least 6 characters.';
  end if;
  if exists (select 1 from public.ew_mod) then
    return false;
  end if;
  insert into public.ew_mod (id, passcode_hash) values (1, extensions.crypt(passcode, extensions.gen_salt('bf')));
  return true;
end;
$$;

create or replace function public.ew_mod_ok(passcode text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (select 1 from public.ew_mod m where m.passcode_hash = extensions.crypt(passcode, m.passcode_hash));
$$;

create or replace function public.ew_mod_queue(passcode text)
returns table (target_type text, target_id uuid, post_id uuid, text text, author_name text, hidden boolean, reports int, reasons text[], created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.ew_mod_ok(passcode) then
    raise exception 'EW_MOD: Wrong passcode.';
  end if;
  return query
  with rep as (
    select r.target_type, r.target_id, count(distinct r.reporter_id)::int as n, array_agg(distinct r.reason) as reasons
    from public.ew_reports r group by r.target_type, r.target_id
  )
  select 'post'::text, p.id, p.id, p.text, pr.name, p.hidden, coalesce(rep.n, 0), coalesce(rep.reasons, '{}'), p.created_at
    from public.ew_posts p join public.ew_profiles pr on pr.id = p.author_id
    left join rep on rep.target_type = 'post' and rep.target_id = p.id
    where p.hidden or rep.n > 0
  union all
  select 'comment', c.id, c.post_id, c.text, pr.name, c.hidden, coalesce(rep.n, 0), coalesce(rep.reasons, '{}'), c.created_at
    from public.ew_comments c join public.ew_profiles pr on pr.id = c.author_id
    left join rep on rep.target_type = 'comment' and rep.target_id = c.id
    where c.hidden or rep.n > 0
  union all
  select 'fix', f.id, f.post_id, f.text, pr.name, f.hidden, coalesce(rep.n, 0), coalesce(rep.reasons, '{}'), f.created_at
    from public.ew_fixes f join public.ew_profiles pr on pr.id = f.author_id
    left join rep on rep.target_type = 'fix' and rep.target_id = f.id
    where f.hidden or rep.n > 0
  union all
  select 'profile', pr.id, null::uuid, pr.name || ' · ' || pr.goal, pr.name, false, rep.n, rep.reasons, pr.created_at
    from public.ew_profiles pr join rep on rep.target_type = 'profile' and rep.target_id = pr.id
  order by 7 desc, 9 desc
  limit 200;
end;
$$;

create or replace function public.ew_mod_set_hidden(passcode text, target_type text, target_id uuid, hide boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  changed boolean := false;
begin
  if not public.ew_mod_ok(passcode) then
    raise exception 'EW_MOD: Wrong passcode.';
  end if;
  if target_type = 'post' then
    update public.ew_posts set hidden = hide where id = target_id;
  elsif target_type = 'comment' then
    update public.ew_comments set hidden = hide where id = target_id;
  elsif target_type = 'fix' then
    update public.ew_fixes set hidden = hide where id = target_id;
  else
    return false;
  end if;
  changed := found;
  -- Restoring clears the reports, so it is not hidden again by the same reports.
  if not hide then
    delete from public.ew_reports r where r.target_type = ew_mod_set_hidden.target_type and r.target_id = ew_mod_set_hidden.target_id;
  end if;
  return changed;
end;
$$;

revoke execute on function public.ew_stats(uuid[]), public.ew_mark_helpful(uuid), public.ew_mark_solved(uuid), public.ew_notifications(timestamptz),
  public.ew_mod_status(), public.ew_mod_setup(text), public.ew_mod_ok(text), public.ew_mod_queue(text), public.ew_mod_set_hidden(text, text, uuid, boolean) from public, anon;
grant execute on function public.ew_stats(uuid[]), public.ew_mark_helpful(uuid), public.ew_mark_solved(uuid), public.ew_notifications(timestamptz),
  public.ew_mod_status(), public.ew_mod_setup(text), public.ew_mod_queue(text), public.ew_mod_set_hidden(text, text, uuid, boolean) to authenticated;
