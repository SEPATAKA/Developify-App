alter table public.developify_collection_versions
  add column if not exists scope text not null default '';

alter table public.developify_collection_versions
  drop constraint if exists developify_collection_versions_pkey;
alter table public.developify_collection_versions
  add primary key (collection, scope);

create or replace function public.developify_bump_physical_collection_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_scope text;
begin
  if tg_op = 'DELETE' then
    target_scope := old.scope;
  else
    target_scope := new.scope;
  end if;

  insert into public.developify_collection_versions (collection, scope, version)
  values (tg_table_name, target_scope, 1)
  on conflict (collection, scope) do update
  set version = public.developify_collection_versions.version + 1;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

do $$
declare
  collection_name text;
  collection_names text[] := array[
    'adminUsers',
    'auditLogs',
    'authChallenges',
    'chatMessages',
    'deviceInstallations',
    'documents',
    'favourites',
    'investmentMilestones',
    'investmentQuotes',
    'investments',
    'investorEntities',
    'kycDrafts',
    'kycInvites',
    'kycMembers',
    'landownerPayouts',
    'ledgerAccounts',
    'ledgerEntries',
    'memberships',
    'notifications',
    'paymentMethods',
    'payoutAccounts',
    'projects',
    'properties',
    'refreshTokens',
    'searchHistories',
    'securityPreferences',
    'submissionDrafts',
    'systemConfigs',
    'systemCounters',
    'transactions',
    'userPreferences',
    'users'
  ];
begin
  foreach collection_name in array collection_names
  loop
    execute format(
      'create table if not exists public.%I (
        scope text not null default '''',
        document_id text not null
          check (length(document_id) between 1 and 1500),
        data jsonb not null default ''{}''::jsonb
          check (jsonb_typeof(data) = ''object''),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        version bigint not null default 1,
        primary key (scope, document_id)
      )',
      collection_name
    );
    execute format(
      'create index if not exists %I on public.%I using gin (data jsonb_path_ops)',
      'developify_' || lower(collection_name) || '_data_gin',
      collection_name
    );
    execute format(
      'create index if not exists %I on public.%I (scope, updated_at desc)',
      'developify_' || lower(collection_name) || '_updated_at',
      collection_name
    );
    execute format('alter table public.%I enable row level security', collection_name);
    execute format('revoke all on table public.%I from anon, authenticated', collection_name);
    execute format('grant all on table public.%I to service_role', collection_name);
    execute format(
      'drop trigger if exists developify_physical_collection_version on public.%I',
      collection_name
    );
    execute format(
      'create trigger developify_physical_collection_version
        after insert or update or delete on public.%I
        for each row execute function public.developify_bump_physical_collection_version()',
      collection_name
    );
  end loop;
end;
$$;

do $$
declare
  collection_name text;
  collection_names text[] := array[
    'adminUsers',
    'auditLogs',
    'authChallenges',
    'chatMessages',
    'deviceInstallations',
    'documents',
    'favourites',
    'investmentMilestones',
    'investmentQuotes',
    'investments',
    'investorEntities',
    'kycDrafts',
    'kycInvites',
    'kycMembers',
    'landownerPayouts',
    'ledgerAccounts',
    'ledgerEntries',
    'memberships',
    'notifications',
    'paymentMethods',
    'payoutAccounts',
    'projects',
    'properties',
    'refreshTokens',
    'searchHistories',
    'securityPreferences',
    'submissionDrafts',
    'systemConfigs',
    'systemCounters',
    'transactions',
    'userPreferences',
    'users'
  ];
begin
  foreach collection_name in array collection_names
  loop
    execute format(
      'insert into public.%I (
        scope, document_id, data, created_at, updated_at, version
      )
      select
        case when collection = $1 then ''''
             else regexp_replace(collection, ''/[^/]+$'', '''')
        end,
        document_id, data, created_at, updated_at, version
      from public.developify_documents
      where collection = $1
         or (
           collection ~ (''^(?:[^/]+/[^/]+/)*'' || $1 || ''$'')
           and cardinality(string_to_array(collection, ''/'')) %% 2 = 1
         )
      on conflict (scope, document_id) do nothing',
      collection_name
    ) using collection_name;
  end loop;
end;
$$;

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
  target_collection text;
  target_table text;
  target_scope text;
  target_id text;
  target_parts text[];
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
    target_parts := string_to_array(target_collection, '/');
    if target_collection is null or cardinality(target_parts) % 2 <> 1 then
      raise exception 'invalid collection path' using errcode = '22023';
    end if;
    target_table := target_parts[cardinality(target_parts)];
    if not exists (
      select 1
      from public.developify_collection_versions
      where collection = target_table and scope = ''
    ) then
      raise exception 'unsupported document collection' using errcode = '22023';
    end if;
    if cardinality(target_parts) = 1 then
      target_scope := '';
    else
      target_scope := array_to_string(
        target_parts[1:cardinality(target_parts) - 1],
        '/'
      );
    end if;

    if read_item ? 'collection_version' then
      select version into current_version
      from public.developify_collection_versions
      where collection = target_table and scope = target_scope;
      if coalesce(current_version, 0) <> (read_item ->> 'collection_version')::bigint then
        raise exception 'transaction conflict' using errcode = '40001';
      end if;
    else
      target_id := read_item ->> 'id';
      current_version := null;
      execute format(
        'select version from public.%I where scope = $1 and document_id = $2',
        target_table
      ) into current_version using target_scope, target_id;
      if read_item -> 'version' = 'null'::jsonb then
        if current_version is not null then
          raise exception 'transaction conflict' using errcode = '40001';
        end if;
      elsif current_version is null
        or current_version <> (read_item ->> 'version')::bigint
      then
        raise exception 'transaction conflict' using errcode = '40001';
      end if;
    end if;
  end loop;

  for operation in select value from jsonb_array_elements(p_operations)
  loop
    target_collection := operation ->> 'collection';
    target_parts := string_to_array(target_collection, '/');
    if target_collection is null or cardinality(target_parts) % 2 <> 1 then
      raise exception 'invalid collection path' using errcode = '22023';
    end if;
    target_table := target_parts[cardinality(target_parts)];
    if not exists (
      select 1
      from public.developify_collection_versions
      where collection = target_table and scope = ''
    ) then
      raise exception 'unsupported document collection' using errcode = '22023';
    end if;
    if cardinality(target_parts) = 1 then
      target_scope := '';
    else
      target_scope := array_to_string(
        target_parts[1:cardinality(target_parts) - 1],
        '/'
      );
    end if;
    target_id := operation ->> 'id';
    operation_kind := operation ->> 'kind';
    operation_data := coalesce(operation -> 'data', '{}'::jsonb);

    if target_id is null or length(target_id) = 0
      or length(target_id) > 1500
      or position('/' in target_id) > 0
      or jsonb_typeof(operation_data) <> 'object'
    then
      raise exception 'invalid document operation' using errcode = '22023';
    end if;

    if operation_kind = 'create' then
      execute format(
        'insert into public.%I (scope, document_id, data) values ($1, $2, $3)',
        target_table
      ) using target_scope, target_id, operation_data;
    elsif operation_kind = 'set' then
      execute format(
        'insert into public.%I (scope, document_id, data)
         values ($1, $2, $3)
         on conflict (scope, document_id) do update
         set data = case when $4
                         then public.%I.data || excluded.data
                         else excluded.data
                    end,
             version = public.%I.version + 1,
             updated_at = now()',
        target_table,
        target_table,
        target_table
      ) using target_scope, target_id, operation_data,
        coalesce((operation ->> 'merge')::boolean, false);
    elsif operation_kind = 'update' then
      execute format(
        'update public.%I
         set data = data || $3, version = version + 1, updated_at = now()
         where scope = $1 and document_id = $2',
        target_table
      ) using target_scope, target_id, operation_data;
      get diagnostics affected = row_count;
      if affected = 0 then
        raise exception 'document does not exist: %/%', target_collection, target_id
          using errcode = 'P0002';
      end if;
    elsif operation_kind = 'delete' then
      execute format(
        'delete from public.%I where scope = $1 and document_id = $2',
        target_table
      ) using target_scope, target_id;
    else
      raise exception 'unsupported document operation' using errcode = '22023';
    end if;
  end loop;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.developify_bootstrap_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  registration jsonb;
  registration_type text;
  profile_name text;
  profile_phone text;
  profile_entity text;
  profile_data jsonb;
begin
  if not (coalesce(new.raw_user_meta_data, '{}'::jsonb) ? 'developifyRegistration') then
    return new;
  end if;

  registration := coalesce(
    new.raw_user_meta_data -> 'developifyRegistration',
    '{}'::jsonb
  );
  registration_type := registration ->> 'type';
  profile_name := nullif(
    btrim(coalesce(registration ->> 'name', new.raw_user_meta_data ->> 'name')),
    ''
  );
  profile_phone := nullif(btrim(registration ->> 'phone'), '');
  profile_entity := registration ->> 'entity';

  if jsonb_typeof(registration) <> 'object'
    or new.email is null
    or profile_name is null
    or length(profile_name) > 200
    or profile_phone is null
    or length(profile_phone) > 50
    or registration_type is null
    or registration_type not in ('investor', 'landowner')
    or profile_entity is null
    or profile_entity not in ('individual', 'company', 'trust', 'stokvel')
    or (
      registration ? 'representatives'
      and coalesce(jsonb_typeof(registration -> 'representatives'), 'null') <> 'array'
    )
    or (
      case
        when jsonb_typeof(registration -> 'representatives') = 'array'
          then jsonb_array_length(registration -> 'representatives') > 20
        else false
      end
    )
  then
    raise exception 'Invalid Developify signup profile metadata';
  end if;

  profile_data := jsonb_build_object(
    'id', new.id::text,
    'email', lower(btrim(new.email)),
    'name', profile_name,
    'phone', profile_phone,
    'entity', profile_entity,
    'address', '',
    'countryCode', coalesce(nullif(btrim(registration ->> 'countryCode'), ''), 'ZA'),
    'hasProfilePhoto', false,
    'nonResident', (registration ->> 'nonResident') = 'true',
    'locked', false,
    'supabaseUid', new.id::text,
    'authProvider', 'supabase',
    'registrationStatus', 'pending_verification',
    'createdAt', to_jsonb(new.created_at),
    'updatedAt', to_jsonb(new.created_at)
  );

  if nullif(btrim(registration ->> 'registrationNumber'), '') is not null then
    if length(btrim(registration ->> 'registrationNumber')) > 100 then
      raise exception 'Invalid Developify registration number';
    end if;
    profile_data := profile_data || jsonb_build_object(
      'registrationNumber',
      btrim(registration ->> 'registrationNumber')
    );
  end if;

  if jsonb_typeof(registration -> 'representatives') = 'array' then
    profile_data := profile_data || jsonb_build_object(
      'representatives',
      registration -> 'representatives'
    );
  end if;

  insert into public."users" (scope, document_id, data)
  select '', new.id::text, profile_data
  where not exists (
    select 1
    from public."users"
    where scope = ''
      and lower(data ->> 'email') = lower(btrim(new.email))
      and document_id <> new.id::text
  )
  on conflict (scope, document_id) do nothing;

  return new;
end;
$$;

revoke all on function public.developify_bump_physical_collection_version()
  from public, anon, authenticated;
revoke all on function public.developify_bootstrap_auth_user_profile()
  from public, anon, authenticated;
revoke all on function public.developify_commit(jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.developify_commit(jsonb, jsonb) to service_role;

insert into public.developify_migrations (version)
values ('006_physical_firestore_collections')
on conflict (version) do nothing;
