import { createClient } from '@supabase/supabase-js';
import { processMeasurements } from '../_lib/log-parser.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

interface RequestBody {
  file_name: string;
  storage_object_id: string;
  owner_id: string;
}

function normalizeVector(values: number[]): number[] {
  if (values.length === 16) return values;
  if (values.length < 16) {
    const lastValue = values[values.length - 1];
    return [...values, ...Array(16 - values.length).fill(lastValue)];
  }
  return values.slice(0, 16);
}

Deno.serve(async (req) => {
  if (!supabaseUrl || !supabaseAnonKey) {
    return new Response(
      JSON.stringify({ error: 'Missing environment variables.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const authorization = req.headers.get('Authorization');
  if (!authorization) {
    return new Response(
      JSON.stringify({ error: 'No authorization header passed' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { authorization } },
    auth: { persistSession: false }
  });

  try {
    const { file_name, storage_object_id, owner_id } = await req.json() as RequestBody;

    if (!file_name || !storage_object_id || !owner_id) {
      throw new Error('Missing required parameters in request body');
    }

    // Download file
    const { data: file, error: downloadError } = await supabase.storage
      .from('measurements')
      .download(file_name);

    if (downloadError) throw downloadError;
    if (!file) throw new Error('No file data received');

    const fileContents = await file.text();
    let sections: any[] = [];

    // Parse file contents
    try {
      const jsonData = JSON.parse(fileContents);
      if (Array.isArray(jsonData)) {
        sections = jsonData.map(item => ({
          values: item.measurements.values,
          total_measurements: item.measurements['total measurements'],
          min: item.measurements.min,
          max: item.measurements.max,
          avg: item.measurements.avg,
          units: item.measurements.units,
          description: item.description,
          source: item.metadata.source,
          tst_id: item.metadata.tst_id,
          uut_type: item.metadata.uut_type,
          status: item.metadata.status,
          serial_number: item.metadata['serial number'],
          category: item.metadata.category,
          sub_category: item.metadata.sub_category,
          sensor_name: item.metadata['sensor name']
        }));
      }
    } catch (jsonError) {
      const processed = processMeasurements(fileContents);
      sections = processed.sections;
    }

    if (!sections || sections.length === 0) {
      throw new Error('No valid measurements found in file');
    }

    // Insert measurements in batches
    const BATCH_SIZE = 50;
    for (let i = 0; i < sections.length; i += BATCH_SIZE) {
      const batch = sections.slice(i, i + BATCH_SIZE);
      
      const { error: insertError } = await supabase
        .from('measurements')
        .insert(batch.map(section => ({
          name: `${section.sensor_name}_${section.tst_id}`,
          measurements_vector: normalizeVector(section.values),
          sensor_name: section.sensor_name,
          description: section.description,
          units: section.units,
          min_value: section.min,
          max_value: section.max,
          avg_value: section.avg,
          total_measurements: section.total_measurements,
          source: section.source,
          tst_id: section.tst_id,
          uut_type: section.uut_type,
          status: section.status,
          serial_number: section.serial_number,
          category: section.category,
          sub_category: section.sub_category,
          processing_status: 'completed',
          storage_object_id,
          created_by: owner_id
        })));

      if (insertError) throw insertError;
    }

    return new Response(null, {
      status: 204,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Processing error:', error);
    
    return new Response(
      JSON.stringify({ 
        error: 'Failed to process measurement file',
        details: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});