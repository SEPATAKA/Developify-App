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
      and coalesce(
        jsonb_typeof(registration -> 'representatives'),
        'null'
      ) <> 'array'
    )
    or case
      when jsonb_typeof(registration -> 'representatives') = 'array'
        then jsonb_array_length(registration -> 'representatives') > 20
      else false
    end
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

  insert into public.developify_documents (collection, document_id, data)
  select 'users', new.id::text, profile_data
  where not exists (
    select 1
    from public.developify_documents
    where collection = 'users'
      and lower(data ->> 'email') = lower(btrim(new.email))
      and document_id <> new.id::text
  )
  on conflict (collection, document_id) do nothing;

  return new;
end;
$$;

revoke all on function public.developify_bootstrap_auth_user_profile()
  from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_trigger
    where tgname = 'developify_auth_user_profile_bootstrap'
      and tgrelid = 'auth.users'::regclass
      and not tgisinternal
  ) then
    execute 'create trigger developify_auth_user_profile_bootstrap
      after insert on auth.users
      for each row execute function public.developify_bootstrap_auth_user_profile()';
  end if;
end;
$$;

insert into public.developify_migrations (version)
values ('004_auth_user_profile_bootstrap')
on conflict (version) do nothing;
