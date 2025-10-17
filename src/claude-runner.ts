import { query } from '@anthropic-ai/claude-agent-sdk';
import { createWriteStream } from 'fs';
import { TaskState } from './types.js';
import { StateManager } from './state-manager.js';
import { TaskStateSchema } from './schemas.js';

/**
 * Runs Claude Code using the Agent SDK and manages execution
 */
export class ClaudeRunner {
  private stateManager: StateManager;
  private timeoutMs: number;
  private projectDir: string;

  constructor(stateManager: StateManager, projectDir: string = '.', timeoutMs: number = 60 * 60 * 1000) {
    // 1 hour default timeout
    this.stateManager = stateManager;
    this.projectDir = projectDir;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Execute Claude Code using the Agent SDK with real-time streaming
   * Returns the task state Claude wrote, or throws an error
   * Streams all output to log file and console in real-time
   */
  async run(taskId: string, prompt: string): Promise<TaskState> {
    // Ensure logs directory exists first
    await this.stateManager.ensureLogsDir();

    const logPath = this.stateManager.getLogPath(taskId);
    const logStream = createWriteStream(logPath, { flags: 'a' });

    // Write header to log
    logStream.write(
      `\n${'='.repeat(80)}\nClaudefather Task: ${taskId}\nStarted: ${new Date().toISOString()}\n${'='.repeat(80)}\n\n`
    );

    try {
      // Create the query using Claude Agent SDK
      const result = query({
        prompt,
        options: {
          model: 'claude-sonnet-4-5-20250929',
          cwd: this.projectDir,
          systemPrompt: { type: 'preset', preset: 'claude_code' },
          permissionMode: 'bypassPermissions',
          settingSources: ['user', 'local', 'project'], // Load all settings like CLI does
        },
      });

      // Set timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Task ${taskId} timed out after ${this.timeoutMs / 1000 / 60} minutes`));
        }, this.timeoutMs);
      });

      // Stream and process messages
      await Promise.race([
        (async () => {
          for await (const message of result) {
            // Log everything
            const messageStr = JSON.stringify(message, null, 2);
            logStream.write(messageStr + '\n');

            // Display messages to console based on type
            const msg = message as any;

            switch (message.type) {
              case 'system':
                // System initialization message (skip, not shown in Claude Code style)
                break;

              case 'user':
                // User message with tool results
                const userContent = msg.message?.content;
                if (Array.isArray(userContent)) {
                  for (const block of userContent) {
                    if (block.type === 'tool_result') {
                      // Show tool result
                      const resultText = block.content || '';
                      const isError = block.is_error || false;

                      if (isError) {
                        process.stdout.write(`  ⎿  ❌ Error\n`);
                      } else if (resultText.length > 0 && resultText.length < 200) {
                        // Show short results inline
                        const preview = resultText.trim().split('\n')[0];
                        process.stdout.write(`  ⎿  ${preview}\n`);
                      } else {
                        process.stdout.write(`  ⎿  ✓\n`);
                      }
                    }
                  }
                }
                break;

              case 'assistant':
                // Assistant message with text and/or tool use
                const content = msg.message?.content;
                if (Array.isArray(content)) {
                  for (const block of content) {
                    if (block.type === 'text') {
                      // Display assistant text response
                      const text = block.text.trim();
                      if (text) {
                        process.stdout.write(`\n⏺ ${text}\n`);
                      }
                    } else if (block.type === 'tool_use') {
                      // Display tool call in Claude Code style
                      const input = block.input || {};

                      // Build parameter string
                      let params = '';
                      if (input.file_path) {
                        params = input.file_path;
                      } else if (input.command) {
                        params = input.command;
                      } else if (input.pattern) {
                        params = `"${input.pattern}"`;
                      } else if (input.description) {
                        params = input.description;
                      } else if (input.prompt) {
                        const p = input.prompt;
                        params = p.length > 60 ? p.substring(0, 60) + '...' : p;
                      }

                      process.stdout.write(`\n⏺ ${block.name}(${params})\n`);
                    }
                  }
                }
                break;

              case 'result':
                // Final result with stats
                if (msg.subtype === 'success') {
                  process.stdout.write(`\n✓ Completed in ${(msg.duration_ms / 1000).toFixed(1)}s (${msg.num_turns} turns, $${msg.total_cost_usd.toFixed(4)})\n`);
                } else {
                  process.stdout.write(`\n❌ Failed: ${msg.subtype}\n`);
                }
                break;

              case 'stream_event':
                // Partial streaming events (if enabled)
                break;
            }
          }
        })(),
        timeoutPromise,
      ]);

      // Write footer to log
      logStream.write(
        `\n${'='.repeat(80)}\nProcess completed successfully\nEnded: ${new Date().toISOString()}\n${'='.repeat(80)}\n`
      );
      logStream.end();

      // Claude should have written a state file before exiting
      const state = await this.stateManager.loadState(taskId);
      if (!state) {
        throw new Error(`Claude did not write state file for task ${taskId}. Check log at: ${logPath}`);
      }

      return state;
    } catch (error) {
      // Write error to log
      logStream.write(`\n[ERROR] ${error instanceof Error ? error.message : String(error)}\n`);
      logStream.write(
        `\n${'='.repeat(80)}\nProcess failed\nEnded: ${new Date().toISOString()}\n${'='.repeat(80)}\n`
      );
      logStream.end();

      throw error;
    }
  }

  /**
   * Validate that a state file from Claude is valid
   */
  async validateStateFile(taskId: string): Promise<{ valid: boolean; error?: string }> {
    try {
      const state = await this.stateManager.loadState(taskId);

      if (!state) {
        return {
          valid: false,
          error: 'State file does not exist',
        };
      }

      // Parse with schema to validate structure
      TaskStateSchema.parse(state);

      return { valid: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        valid: false,
        error: message,
      };
    }
  }
}
