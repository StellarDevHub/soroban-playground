import fs from 'fs';
import path from 'path';

const v1Schema = {
  compile: {
    request: { code: 'string', dependencies: 'object' },
    response: { 
      success: 'boolean', 
      durationMs: 'number', 
      artifact: { sizeBytes: 'number' } 
    }
  },
  deploy: {
    request: { wasmPath: 'string', contractName: 'string' },
    response: { contractId: 'string', deployedAt: 'string' }
  },
  invoke: {
    request: { contractId: 'string', functionName: 'string' },
    response: { invokedAt: 'string' }
  }
};

const v2Schema = {
  compile: {
    request: { code: 'string', dependencies: 'object' },
    response: { 
      success: 'boolean', 
      duration_ms: 'number', 
      artifact: { size_bytes: 'number' } 
    }
  },
  deploy: {
    request: { wasm_path: 'string', contract_name: 'string' },
    response: { contract_id: 'string', deployed_at: 'string' }
  },
  invoke: {
    request: { contract_id: 'string', function_name: 'string' },
    response: { invoked_at: 'string' }
  }
};

function generateGuide() {
  let markdown = '# API Migration Guide: v1 to v2\n\n';
  markdown += 'This guide details the breaking changes and naming convention updates between API v1 and v2.\n\n';
  
  markdown += '## Overview of Changes\n';
  markdown += '- **Naming Convention**: v2 uses `snake_case` instead of `camelCase` for all fields.\n';
  markdown += '- **Deprecation**: v1 is now deprecated and will return a `Warning` header.\n\n';

  Object.keys(v1Schema).forEach(endpoint => {
    markdown += `### Endpoint: /api/${endpoint}\n\n`;
    
    markdown += '#### Request Changes\n';
    markdown += '| v1 Field | v2 Field | Type |\n';
    markdown += '|----------|----------|------|\n';
    
    Object.keys(v1Schema[endpoint].request).forEach(key => {
      const v2Key = key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
      markdown += `| \`${key}\` | \`${v2Key}\` | ${v1Schema[endpoint].request[key]} |\n`;
    });
    
    markdown += '\n#### Response Changes\n';
    markdown += '| v1 Field | v2 Field | Type |\n';
    markdown += '|----------|----------|------|\n';

    const flatten = (obj, prefix = '') => {
      let result = [];
      for (const key in obj) {
        if (typeof obj[key] === 'object') {
          result = result.concat(flatten(obj[key], `${prefix}${key}.`));
        } else {
          result.push(`${prefix}${key}`);
        }
      }
      return result;
    };

    const v1Fields = flatten(v1Schema[endpoint].response);
    v1Fields.forEach(field => {
      const v2Field = field.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
      markdown += `| \`${field}\` | \`${v2Field}\` | - |\n`;
    });

    markdown += '\n---\n\n';
  });

  const outputPath = path.join(process.cwd(), 'API_MIGRATION_GUIDE.md');
  fs.writeFileSync(outputPath, markdown);
  console.log(`Migration guide generated at: ${outputPath}`);
}

generateGuide();
