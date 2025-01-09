// Types for the measurement tree structure
type MeasurementNodeType = 'root' | 'measurement' | 'values' | 'metadata';

interface BaseNode {
  type: MeasurementNodeType;
}

interface ValueNode extends BaseNode {
  type: 'values';
  values: number[];
}

interface MetadataNode extends BaseNode {
  type: 'metadata';
  metadata: Record<string, string>;
}

interface MeasurementNode extends BaseNode {
  type: 'measurement';
  children: (ValueNode | MetadataNode)[];
}

interface RootNode extends BaseNode {
  type: 'root';
  children: MeasurementNode[];
}

export type MeasurementSection = {
  sensor_readings: number[]; 
  total_measurements: number;
  min: number;
  max: number;
  avg: number;
  units: string;
  description: string;
  source: string;
  tst_id: string;
  uut_type: string;
  status: string;
  serial_number: string;
  category: string;
  sub_category: string;
  sensor_name: string;
};

export type ProcessedMeasurements = {
  sections: MeasurementSection[];
};

/**
 * Splits content into measurement blocks
 */
function splitIntoBlocks(content: string): string[] {
  return content
    .split(/(?=measurements)/)
    .filter(block => block.trim().length > 0);
}

/**
 * Parses a measurement block into a tree structure
 */
function parseBlock(block: string): MeasurementNode | null {
  try {
    // Extract values
    const valuesMatch = block.match(/values([\d\s.]+)total/);
    if (!valuesMatch) return null;

    const values = valuesMatch[1]
      .trim()
      .split(/\s+/)
      .map(str => parseFloat(str.replace(/^\d+/, '')))
      .filter(num => !isNaN(num));

    // Extract metadata using quotes
    const metadataMatches = [...block.matchAll(/"([^"]+)"/g)];
    const metadata: Record<string, string> = {};
    
    for (let i = 0; i < metadataMatches.length; i++) {
      const value = metadataMatches[i][1];
      if (i > 0) {
        const prevValue = metadataMatches[i-1][1].toLowerCase();
        if (prevValue.includes('units')) metadata.units = value;
        else if (prevValue.includes('description')) metadata.description = value;
        else if (prevValue.includes('source')) metadata.source = value;
        else if (prevValue.includes('tst_id')) metadata.tst_id = value;
        else if (prevValue.includes('uut_type')) metadata.uut_type = value;
        else if (prevValue.includes('status')) metadata.status = value;
        else if (prevValue.includes('serial number')) metadata.serial_number = value;
        else if (prevValue.includes('category')) metadata.category = value;
        else if (prevValue.includes('sub_category')) metadata.sub_category = value;
        else if (prevValue.includes('sensor name')) metadata.sensor_name = value;
      }
    }

    // Extract sensor name from description if needed
    if (metadata.description && !metadata.sensor_name) {
      const sensorMatch = metadata.description.match(/measurements for (.+)/);
      if (sensorMatch) {
        metadata.sensor_name = sensorMatch[1];
      }
    }

    return {
      type: 'measurement',
      children: [
        {
          type: 'values',
          values
        },
        {
          type: 'metadata',
          metadata
        }
      ]
    };
  } catch (error) {
    console.error('Error parsing block:', error);
    return null;
  }
}

export function processMeasurements(content: string): ProcessedMeasurements {
  try {
    // Parse JSON content
    console.log('Raw file content:', content);
    const json = JSON.parse(content);

    console.log('Parsed JSON:', json);

    // Ensure it's an array (wrap single object in array if needed)
    const measurementNodes = Array.isArray(json) ? json : [json];

    // Process each node into a section
    const sections = measurementNodes
      .map((node) => {
        try {
          return nodeToSection(node);
        } catch (error) {
          console.error('Error converting node to section:', error, node);
          return null;
        }
      })
      .filter((section): section is MeasurementSection => section !== null);

    console.log('Parsed sections:', sections);
    return { sections };
  } catch (error) {
    console.error('Error processing measurements:', error);
    return { sections: [] };
  }
}

function nodeToSection(node: any): MeasurementSection | null {
  try {
    const { measurements, description, metadata } = node;

    if (!measurements || !metadata || !description) {
      console.error('Missing required fields in node:', node);
      return null;
    }

    return {
      sensor_readings: measurements.values || [],
      total_measurements: measurements['total measurements'] || measurements.values.length,
      min: measurements.min,
      max: measurements.max,
      avg: measurements.avg,
      units: measurements.units || '',
      description: description || '',
      source: metadata.source || '',
      tst_id: metadata.tst_id || '',
      uut_type: metadata.uut_type || '',
      status: metadata.status || '',
      serial_number: metadata['serial number'] || '',
      category: metadata.category || '',
      sub_category: metadata['sub_category'] || '',
      sensor_name: metadata['sensor name'] || '',
    };
  } catch (error) {
    console.error('Error in nodeToSection:', error, node);
    return null;
  }
}