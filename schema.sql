-- Run once in Supabase SQL Editor.  Each account can read and change only its
-- own notes.  The dashboard itself is intentionally public-readable.
create table if not exists public.tracker_notes (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tracker_id text not null,
  row_key text not null,
  note text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, tracker_id, row_key)
);

alter table public.tracker_notes enable row level security;

create policy "read own tracker notes" on public.tracker_notes
  for select using (auth.uid() = user_id);
create policy "write own tracker notes" on public.tracker_notes
  for insert with check (auth.uid() = user_id);
create policy "update own tracker notes" on public.tracker_notes
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own tracker notes" on public.tracker_notes
  for delete using (auth.uid() = user_id);
