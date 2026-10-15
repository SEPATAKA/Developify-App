alter table public.developify_documents
  add column if not exists version bigint not null default 1;

create table if not exists public.developify_collection_versions (
  collection text primary key,
  version bigint not null default 0
);

alter table public.developify_collection_versions enable row level security;
revoke all on table public.developify_collection_versions from anon, authenticated;
grant all on table public.developify_collection_versions to service_role;

create or replace function public.developify_bump_collection_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.developify_collection_versions (collection, version)
  values (coalesce(new.collection, old.collection), 1)
  on conflict (collection) do update
  set version = public.developify_collection_versions.version + 1;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists developify_documents_bump_collection_version
  on public.developify_documents;
create trigger developify_documents_bump_collection_version
after insert or update or delete on public.developify_documents
for each row execute function public.developify_bump_collection_version();

create or replace function public.developify_commit(
  p_reads jsonb default '[]'::jsonb,
  p_operations jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  read_item jsonb;
  operation jsonb;
  current_version bigint;
  existing_data jsonb;
  target_collection text;
  target_id text;
  operation_kind text;
  operation_data jsonb;
  affected integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if jsonb_typeof(p_reads) <> 'array' or jsonb_typeof(p_operations) <> 'array' then
    raise exception 'invalid transaction payload' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('developify:document-commit', 0));

  for read_item in select value from jsonb_array_elements(p_reads)
  loop
    target_collection := read_item ->> 'collection';

    if read_item ? 'collection_version' then
      select version into current_version
      from public.developify_collection_versions
      where collection = target_collection;
      if coalesce(current_version, 0) <> (read_item ->> 'collection_version')::bigint then
        raise exception 'transaction conflict' using errcode = '40001';
      end if;
    else
      target_id := read_item ->> 'id';
      select version into current_version
      from public.developify_documents
      where collection = target_collection and document_id = target_id;
      if read_item -> 'version' = 'null'::jsonb then
        if found then
          raise exception 'transaction conflict' using errcode = '40001';
        end if;
      elsif not found or current_version <> (read_item ->> 'version')::bigint then
        raise exception 'transaction conflict' using errcode = '40001';
      end if;
    end if;
  end loop;

  for operation in select value from jsonb_array_elements(p_operations)
  loop
    target_collection := operation ->> 'collection';
    target_id := operation ->> 'id';
    operation_kind := operation ->> 'kind';
    operation_data := coalesce(operation -> 'data', '{}'::jsonb);

    if target_collection is null or target_id is null then
      raise exception 'document collection and id are required' using errcode = '22023';
    end if;

    if operation_kind = 'create' then
      insert into public.developify_documents (collection, document_id, data)
      values (target_collection, target_id, operation_data);
    elsif operation_kind = 'set' then
      insert into public.developify_documents (collection, document_id, data)
      values (target_collection, target_id, operation_data)
      on conflict (collection, document_id) do update
      set data = case when coalesce((operation ->> 'merge')::boolean, false)
                      then public.developify_documents.data || excluded.data
                      else excluded.data end,
          version = public.developify_documents.version + 1,
          updated_at = now();
    elsif operation_kind = 'update' then
      update public.developify_documents
      set data = data || operation_data,
          version = version + 1,
          updated_at = now()
      where collection = target_collection and document_id = target_id;
      get diagnostics affected = row_count;
      if affected = 0 then
        raise exception 'document does not exist: %/%', target_collection, target_id
          using errcode = 'P0002';
      end if;
    elsif operation_kind = 'delete' then
      delete from public.developify_documents
      where collection = target_collection and document_id = target_id;
    else
      raise exception 'unsupported document operation' using errcode = '22023';
    end if;
  end loop;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.developify_commit(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.developify_commit(jsonb, jsonb) to service_role;

insert into public.developify_migrations (version)
values ('002_atomic_document_operations')
on conflict (version) do nothing;
