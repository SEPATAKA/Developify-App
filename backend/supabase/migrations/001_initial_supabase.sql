create extension if not exists pgcrypto;

create table if not exists public.developify_documents (
  collection text not null check (length(collection) between 1 and 120),
  document_id text not null check (length(document_id) between 1 and 200),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (collection, document_id)
);

create index if not exists developify_documents_data_gin
  on public.developify_documents using gin (data jsonb_path_ops);
create index if not exists developify_documents_user_id
  on public.developify_documents (collection, (data ->> 'userId'));
create index if not exists developify_documents_email
  on public.developify_documents (collection, lower(data ->> 'email'));
create index if not exists developify_documents_entity_id
  on public.developify_documents (collection, (data ->> 'entityId'));
create index if not exists developify_documents_status
  on public.developify_documents (collection, (data ->> 'status'));
create index if not exists developify_documents_created_at
  on public.developify_documents (collection, (data ->> 'createdAt'));

alter table public.developify_documents enable row level security;

revoke all on table public.developify_documents from anon, authenticated;
grant all on table public.developify_documents to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'developify-private',
  'developify-private',
  false,
  5242880,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.developify_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

alter table public.developify_migrations enable row level security;
revoke all on table public.developify_migrations from anon, authenticated;
grant all on table public.developify_migrations to service_role;

insert into public.developify_migrations (version)
values ('001_initial_supabase')
on conflict (version) do nothing;
