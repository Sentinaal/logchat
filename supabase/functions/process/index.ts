import { createClient } from '@supabase/supabase-js';
import { processMeasurements, type MeasurementSection } from '../_lib/parse-measurements.ts';
import { Database } from '../_lib/database.ts';

// Environment variables for Supabase configuration
const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

// Define the expected structure of the incoming request body
interface RequestBody {
  measurement_id: number; // Changed to match what the trigger sends
}

// Type alias for processed measurement sections
type ProcessedSection = MeasurementSection;

/**
 * Normalizes a vector to exactly 384 dimensions
 * Either truncates or pads the vector as needed
 */
function normalizeVector(values: number[]): string {
  // Handle vectors of different lengths
  const normalized = values.length === 384 
    ? values // Use as-is if exactly 384
    : values.length < 384 
      ? [...values, ...Array(384 - values.length).fill(values[values.length - 1])] // Pad if too short
      : values.slice(0, 384); // Truncate if too long
  
  return `[${normalized.join(',')}]`;
}

/**
 * Main server function that processes measurement files
 * and stores their data in the database
 */
Deno.serve(async (req) => {
  // Validate environment variables
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Missing required environment variables');
    return new Response(
      JSON.stringify({ error: 'Server configuration error.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Validate authorization header
  const authorization = req.headers.get('Authorization');
  if (!authorization) {
    console.error('Missing authorization header');
    return new Response(
      JSON.stringify({ error: 'Authorization required' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Initialize Supabase client
  const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
    global: { headers: { authorization } },
    auth: { persistSession: false }
  });

  try {
    // Parse and validate request body
    const { measurement_id } = await req.json() as RequestBody;
    console.log('Processing measurement ID:', measurement_id);

    if (!measurement_id) {
      throw new Error('Missing measurement_id in request body');
    }

    // Fetch measurement details from database
    const { data: log, error: logError } = await supabase
      .from('logs_with_storage_path')
      .select('*')
      .eq('id', measurement_id)
      .single();

    if (logError) {
      console.error('Error fetching log:', logError);
      throw logError;
    }
    if (!log?.storage_object_path) {
      throw new Error('Storage path not found for measurement');
    }

    // Download the file from storage
    console.log('Downloading file:', log.storage_object_path);
    const { data: file, error: downloadError } = await supabase.storage
      .from('files')
      .download(log.storage_object_path);

    if (downloadError) {
      console.error('File download error:', downloadError);
      throw downloadError;
    }
    if (!file) {
      throw new Error('No file data received');
    }

    // Process file contents
    const fileContents = await file.text();
    console.log('File contents preview:', fileContents.substring(0, 200));
    
    let sections: ProcessedSection[] = [];

    try {
      const processed = processMeasurements(fileContents);
      sections = processed.sections;
    }
    catch (error) {
      console.error('Error parsing JSON:', error);
    }

    if (!sections || sections.length === 0) {
      throw new Error('No valid measurements found in file');
    }

    console.log(`Processing ${sections.length} measurement sections`);

    // Process measurements in batches to avoid overwhelming the database
    const BATCH_SIZE = 50;
    for (let i = 0; i < sections.length; i += BATCH_SIZE) {
      const batch = sections.slice(i, i + BATCH_SIZE);
      console.log(`Processing batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(sections.length/BATCH_SIZE)}`);
      
      const insertData: Database['public']['Tables']['measurements']['Insert'][] = batch.map(section => ({
        measurement_id,
        sensor_name: section.sensor_name,
        meas_description: section.description,
        units: section.units,
        min_value: section.min,
        max_value: section.max,
        avg_value: section.avg,
        total_measurements: section.total_measurements,
        sensor_readings: section.sensor_readings,
        source: section.source,
        tst_id: section.tst_id,
        uut_type: section.uut_type,
        meas_status: section.status,
        serial_number: section.serial_number,
        category: section.category,
        sub_category: section.sub_category,
        embedding: null, // This will be filled in by the embed function
        embedding_status: 'pending', // Add this status field
        embedding_text: `Sensor ${section.sensor_name} measuring ${section.description} with values ranging from ${section.min} to ${section.max} ${section.units}. Category: ${section.category}, Sub-category: ${section.sub_category}. Source: ${section.source}, Status: ${section.status}`
      }));

      const { error: insertError } = await supabase
        .from('measurements')
        .insert(insertData);

      if (insertError) {
        console.error('Insert error:', insertError);
        throw insertError;
      }
    }

    console.log('Successfully processed all measurements');
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