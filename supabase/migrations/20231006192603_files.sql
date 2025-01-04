-- Enable required extensions
create extension if not exists pg_net with schema extensions;
create extension if not exists vector with schema extensions;

-- Create schema
create schema private;

-- Create storage bucket for measurements
insert into storage.buckets (id, name)
values ('measurements', 'measurements')
on conflict do nothing;

-- Create UUID helper function
create or replace function private.uuid_or_null(str text)
returns uuid
language plpgsql
as $$
begin
  return str::uuid;
  exception when invalid_text_representation then
    return null;
  end;
$$;

-- Storage policies for measurement files
create policy "Authenticated users can upload measurements"
on storage.objects for insert to authenticated with check (
  bucket_id = 'measurements' and
  owner = auth.uid() and
  private.uuid_or_null(path_tokens[1]) is not null
);

create policy "Users can view their own measurements"
on storage.objects for select to authenticated using (
  bucket_id = 'measurements' and owner = auth.uid()
);

create policy "Users can update their own measurements"
on storage.objects for update to authenticated with check (
  bucket_id = 'measurements' and owner = auth.uid()
);

create policy "Users can delete their own measurements"
on storage.objects for delete to authenticated using (
  bucket_id = 'measurements' and owner = auth.uid()
);