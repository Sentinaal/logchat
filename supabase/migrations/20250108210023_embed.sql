-- First create the embed() function that will be used as a trigger
create function private.embed()
returns trigger
language plpgsql
as $$
declare
  content_column text = TG_ARGV[0];
  embedding_column text = TG_ARGV[1];
  batch_size int = case when array_length(TG_ARGV, 1) >= 3 then TG_ARGV[2]::int else 5 end;
  timeout_milliseconds int = case when array_length(TG_ARGV, 1) >= 4 then TG_ARGV[3]::int else 5 * 60 * 1000 end;
  batch_count int = ceiling((select count(*) from inserted) / batch_size::float);
begin
  -- Loop through each batch and invoke edge function
  for i in 0 .. (batch_count-1) loop
    perform
      net.http_post(
        url := supabase_url() || '/functions/v1/embed',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', current_setting('request.headers')::json->>'authorization'
        ),
        body := jsonb_build_object(
          'ids', (select json_agg(ms.id) from (select id from inserted limit batch_size offset i*batch_size) ms),
          'table', TG_TABLE_NAME,
          'contentColumn', content_column,
          'embeddingColumn', embedding_column
        ),
        timeout_milliseconds := timeout_milliseconds
      );
  end loop;

  return null;
end;
$$;

-- Create the trigger on the measurements table
create trigger embed_measurements
  after insert on measurements
  referencing new table as inserted
  for each statement
  execute procedure private.embed('embedding_text', 'embedding', 50, 300000);