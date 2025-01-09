-- Enable required extensions
create extension if not exists pg_net with schema extensions;
create extension if not exists vector with schema extensions;

-- Create main measurements table
create table logs (
  id bigint primary key generated always as identity,
  name text not null,
  storage_object_id uuid not null references storage.objects (id),
  created_by uuid not null references auth.users (id) default auth.uid(),
  created_at timestamp with time zone not null default now()
);

-- Create view for easy storage path access
create view logs_with_storage_path
with (security_invoker=true)
as
  select logs.*, storage.objects.name as storage_object_path
  from logs
  join storage.objects
    on storage.objects.id = logs.storage_object_id;

-- Create measurements table with a single embedding column
create table measurements (
  id bigint primary key generated always as identity,
  measurement_id bigint not null references logs (id),
  sensor_name text not null,
  meas_description text not null,
  units text not null,
  min_value numeric not null,
  max_value numeric not null,
  avg_value numeric not null,
  total_measurements integer not null,
  sensor_readings numeric[] not null,
  source text not null,
  tst_id timestamp with time zone not null,
  uut_type text not null,
  meas_status text not null,
  serial_number text not null,
  category text not null,
  sub_category text not null,
  embedding_text text not null,
  embedding_status text not null,
  embedding vector(384) -- Single embedding column
);

-- Index for embedding column
create index on measurements using hnsw (embedding vector_ip_ops);

-- Enable RLS
alter table logs enable row level security;
alter table measurements enable row level security;

-- RLS policies for measurements
create policy "Users can insert measurements"
on logs for insert to authenticated with check (
  auth.uid() = created_by
);

create policy "Users can query their own measurements"
on logs for select to authenticated using (
  auth.uid() = created_by
);

-- RLS policies for measurement sections
create policy "Users can insert measurement sections"
on measurements for insert to authenticated with check (
  measurement_id in (
    select id
    from logs
    where created_by = auth.uid()
  )
);

create policy "Users can update their own measurement sections"
on measurements for update to authenticated using (
  measurement_id in (
    select id
    from logs
    where created_by = auth.uid()
  )
) with check (
  measurement_id in (
    select id
    from logs
    where created_by = auth.uid()
  )
);

create policy "Users can query their own measurement sections"
on measurements for select to authenticated using (
  measurement_id in (
    select id
    from logs
    where created_by = auth.uid()
  )
);

-- Function to get Supabase URL
create function supabase_url()
returns text
language plpgsql
security definer
as $$
declare
  secret_value text;
begin
  select decrypted_secret into secret_value from vault.decrypted_secrets where name = 'supabase_url';
  return secret_value;
end;
$$;

-- Create trigger function
create or replace function private.handle_measurement_upload()
returns trigger
language plpgsql
as $$
declare
  measurement_id bigint;
  result int;
begin
  insert into logs (name, storage_object_id, created_by)
    values (new.name, new.id, new.owner)
    returning id into measurement_id;

  select
    net.http_post(
      url := supabase_url() || '/functions/v1/process',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', current_setting('request.headers')::json->>'authorization'
      ),
      body := jsonb_build_object(
        'measurement_id', measurement_id
      )
    )
  into result;

  return null;
end;
$$;

-- Create trigger for file uploads
create trigger on_measurement_upload
  after insert on storage.objects
  for each row
  when (new.bucket_id = 'files')
  execute procedure private.handle_measurement_upload();