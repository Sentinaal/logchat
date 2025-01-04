-- Enable required extensions
create extension if not exists pg_net with schema extensions;
create extension if not exists vector with schema extensions;

-- Create measurements table
create table measurements (
  id bigint primary key generated always as identity,
  name text not null,
  measurements_vector vector(16),
  sensor_name text not null,
  description text not null,
  units text not null,
  min_value numeric not null,
  max_value numeric not null,
  avg_value numeric not null,
  total_measurements integer not null,
  source text not null,
  tst_id timestamp with time zone not null,
  uut_type text not null,
  status text not null,
  serial_number text not null,
  category text not null,
  sub_category text not null,
  processing_status text not null default 'pending'
    check (processing_status in ('pending', 'processing', 'completed', 'error')),
  storage_object_id uuid references storage.objects (id),
  created_by uuid not null references auth.users (id) default auth.uid(),
  created_at timestamp with time zone not null default now()
);

-- Create view for easy storage path access
create view measurements_with_storage_path
with (security_invoker=true)
as
  select measurements.*, storage.objects.name as storage_object_path
  from measurements
  join storage.objects
    on storage.objects.id = measurements.storage_object_id;

-- Create HNSW index
create index on measurements using hnsw (measurements_vector vector_ip_ops);

-- Enable RLS
alter table measurements enable row level security;

-- RLS policies
create policy "Users can insert measurements"
on measurements for insert to authenticated with check (
  auth.uid() = created_by
);

create policy "Users can query their own measurements"
on measurements for select to authenticated using (
  auth.uid() = created_by
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
create function private.handle_measurement_upload()
returns trigger
language plpgsql
as $$
declare
  edge_function_result int;
begin
  select
    net.http_post(
      url := supabase_url() || '/functions/v1/process',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', current_setting('request.headers')::json->>'authorization'
      ),
      body := jsonb_build_object(
        'file_name', new.name,
        'storage_object_id', new.id,
        'owner_id', new.owner
      )
    )
  into edge_function_result;
  
  return null;
end;
$$;

-- Create trigger for file uploads
create trigger on_measurement_file_upload
  after insert on storage.objects
  for each row
  when (new.bucket_id = 'measurements')
  execute procedure private.handle_measurement_upload();