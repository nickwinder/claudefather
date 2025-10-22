import { join } from 'path';
import { readFileSync, existsSync } from 'fs';
import { config } from 'dotenv';
import { z } from 'zod';

const ConfigSchema = z.object({
  branchPrefix: z.string().default('feature'),
}).strict();

export type Config = z.infer<typeof ConfigSchema>;

export class ConfigLoader {
  private claudefatherDir: string;

  constructor(projectDir: string) {
    this.claudefatherDir = join(projectDir, '.claudefather');
  }

  load(): Config {
    // Load environment variables from .env file in .claudefather directory
    const envPath = join(this.claudefatherDir, '.env');
    if (existsSync(envPath)) {
      config({ path: envPath });
    }

    // Load .claudefatherrc from .claudefather directory
    const rcPath = join(this.claudefatherDir, '.claudefatherrc');
    let rcConfig: Record<string, unknown> = {};

    if (existsSync(rcPath)) {
      try {
        const content = readFileSync(rcPath, 'utf-8');
        rcConfig = JSON.parse(content);
      } catch (error) {
        throw new Error(`Failed to parse .claudefatherrc: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Build config from RC file
    const config_data: Record<string, unknown> = {
      branchPrefix: rcConfig.branchPrefix,
    };

    // Remove undefined values
    Object.keys(config_data).forEach(key => {
      if (config_data[key] === undefined) {
        delete config_data[key];
      }
    });

    return ConfigSchema.parse(config_data);
  }
}
