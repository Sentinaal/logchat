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
  values: number[];
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

/**
 * Converts a measurement node into a section
 */
function nodeToSection(node: MeasurementNode): MeasurementSection | null {
  try {
    const valuesNode = node.children.find((child): child is ValueNode => child.type === 'values');
    const metadataNode = node.children.find((child): child is MetadataNode => child.type === 'metadata');

    if (!valuesNode || !metadataNode) return null;

    const values = valuesNode.values;
    const metadata = metadataNode.metadata;

    return {
      values,
      total_measurements: values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      units: metadata.units || 'Watts',
      description: metadata.description || '',
      source: metadata.source || '',
      tst_id: metadata.tst_id || new Date().toISOString(),
      uut_type: metadata.uut_type || 'unknown',
      status: metadata.status || 'unknown',
      serial_number: metadata.serial_number || 'unknown',
      category: metadata.category || 'power',
      sub_category: metadata.sub_category || 'OTHER',
      sensor_name: metadata.sensor_name || ''
    };
  } catch (error) {
    console.error('Error converting node to section:', error);
    return null;
  }
}

/**
 * Process measurement content into sections
 */
export function processMeasurements(content: string): ProcessedMeasurements {
  // Split content into blocks
  const blocks = splitIntoBlocks(content);

  // Parse blocks into measurement nodes
  const measurementNodes = blocks
    .map(block => parseBlock(block))
    .filter((node): node is MeasurementNode => node !== null);

  // Convert nodes to sections
  const sections = measurementNodes
    .map(node => nodeToSection(node))
    .filter((section): section is MeasurementSection => 
      section !== null && 
      section.values.length > 0 && 
      !!section.sensor_name
    );

  return { sections };
}