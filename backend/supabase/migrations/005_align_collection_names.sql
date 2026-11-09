with renamed_documents as (
  select
    'systemConfigs' as collection,
    document_id,
    data,
    created_at,
    updated_at,
    version
  from public.developify_documents
  where collection = 'systemConfig'

  union all

  select
    regexp_replace(collection, '/searchHistory$', '/searchHistories') as collection,
    document_id,
    data,
    created_at,
    updated_at,
    version
  from public.developify_documents
  where collection ~ '^users/[^/]+/searchHistory$'
)
insert into public.developify_documents (
  collection,
  document_id,
  data,
  created_at,
  updated_at,
  version
)
select collection, document_id, data, created_at, updated_at, version
from renamed_documents
on conflict (collection, document_id) do update
set data = public.developify_documents.data || excluded.data,
    created_at = least(public.developify_documents.created_at, excluded.created_at),
    updated_at = greatest(
      public.developify_documents.updated_at,
      excluded.updated_at,
      now()
    ),
    version = greatest(public.developify_documents.version, excluded.version) + 1;

delete from public.developify_documents
where collection = 'systemConfig'
   or collection ~ '^users/[^/]+/searchHistory$';

delete from public.developify_collection_versions
where collection = 'systemConfig'
   or collection ~ '^users/[^/]+/searchHistory$';

insert into public.developify_migrations (version)
values ('005_align_collection_names')
on conflict (version) do nothing;
