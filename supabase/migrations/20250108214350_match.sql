create or replace function match_measurements(embedding vector(384), match_threshold float)
returns setof measurements
language plpgsql
as $$
#variable_conflict use_variable
begin
  return query
  select *
  from measurements

  -- The inner product is negative, so we negate match_threshold
  where measurements.embedding <#> embedding < -match_threshold

  -- Our embeddings are normalized to length 1, so cosine similarity
  -- and inner product will produce the same query results.
  -- Using inner product which can be computed faster.
  --
  -- For the different distance functions, see https://github.com/pgvector/pgvector
  order by measurements.embedding <#> embedding;
end;
$$;