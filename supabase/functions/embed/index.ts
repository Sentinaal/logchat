import { createClient } from '@supabase/supabase-js';
import { Database } from '../_lib/database.ts';

// Initialize the AI model
const model = new Supabase.ai.Session('gte-small');

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

Deno.serve(async (req) => {
  // Validate environment variables
  if (!supabaseUrl || !supabaseAnonKey) {
    return new Response(
      JSON.stringify({ error: 'Missing environment variables.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Check for authorization header
  const authorization = req.headers.get('Authorization');
  if (!authorization) {
    return new Response(
      JSON.stringify({ error: 'No authorization header passed' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Initialize Supabase client
  const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
    global: { headers: { authorization } },
    auth: { persistSession: false }
  });

  try {
    // Parse request body
    const { ids, table, contentColumn, embeddingColumn } = await req.json();
    
    console.log(`Processing embeddings for ${ids.length} rows from ${table}`);

    // Fetch rows that need embeddings
    const { data: rows, error: selectError } = await supabase
      .from(table)
      .select(`id, ${contentColumn}` as '*')
      .in('id', ids)
      .is(embeddingColumn, null);

    if (selectError) {
      console.error('Error fetching rows:', selectError);
      throw selectError;
    }

    if (!rows?.length) {
      console.log('No rows to process');
      return new Response(null, { status: 204 });
    }

    // Process each row
    for (const row of rows) {
      const { id, [contentColumn]: content } = row;
      
      if (!content) {
        console.error(`No content available in column '${contentColumn}' for id ${id}`);
        // Update status to failed
        await supabase
          .from(table)
          .update({ embedding_status: 'failed' })
          .eq('id', id);
        continue;
      }

      try {
        console.log(`Generating embedding for row ${id}`);
        
        // Generate embedding
        const output = await model.run(content, {
          mean_pool: true,
          normalize: true,
        }) as number[];

        // Update row with embedding
        const { error: updateError } = await supabase
          .from(table)
          .update({
            [embeddingColumn]: output,
            embedding_status: 'complete'
          })
          .eq('id', id);

        if (updateError) {
          console.error(`Error updating row ${id}:`, updateError);
          throw updateError;
        }

        console.log(`Successfully processed row ${id}`);
      } catch (error) {
        console.error(`Error processing row ${id}:`, error);
        
        // Update status to failed
        await supabase
          .from(table)
          .update({ embedding_status: 'failed' })
          .eq('id', id);
      }
    }

    return new Response(null, { 
      status: 204,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Processing error:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Failed to process embeddings',
        details: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});