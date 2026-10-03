create table if not exists public.wishlist_items (
	id uuid primary key default gen_random_uuid(),
	user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
	title text not null,
	price numeric(12, 2) default null check (price is null or price >= 0),
	category text not null default 'Unsorted',
	image_url text not null default '',
	note text not null default '',
	received boolean not null default false,
	created_at timestamptz not null default now()
);

alter table public.wishlist_items alter column price drop not null;
alter table public.wishlist_items alter column price drop default;

create index if not exists wishlist_items_user_created_idx
	on public.wishlist_items (user_id, created_at desc);

create table if not exists public.wishlist_categories (
	id uuid primary key default gen_random_uuid(),
	user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
	name text not null check (char_length(name) between 1 and 32),
	created_at timestamptz not null default now(),
	unique (user_id, name)
);

alter table public.wishlist_items enable row level security;
alter table public.wishlist_categories enable row level security;

grant select, insert, update, delete on public.wishlist_items to authenticated;
grant select, insert, update, delete on public.wishlist_categories to authenticated;

drop policy if exists "Users manage their own wishes" on public.wishlist_items;
create policy "Users manage their own wishes"
	on public.wishlist_items for all
	using (auth.uid() = user_id)
	with check (auth.uid() = user_id);

drop policy if exists "Users manage their own categories" on public.wishlist_categories;
create policy "Users manage their own categories"
	on public.wishlist_categories for all
	using (auth.uid() = user_id)
	with check (auth.uid() = user_id);

do $$
begin
	if not exists (
		select 1 from pg_publication_tables
		where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'wishlist_items'
	) then
		alter publication supabase_realtime add table public.wishlist_items;
	end if;
	if not exists (
		select 1 from pg_publication_tables
		where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'wishlist_categories'
	) then
		alter publication supabase_realtime add table public.wishlist_categories;
	end if;
end $$;