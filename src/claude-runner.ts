import {
  query,
  type SDKMessage,
  type SDKAssistantMessage,
  type SDKUserMessage,
  type SDKResultMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { createWriteStream } from 'fs';
import { TaskState } from './types.js';
import { StateManager } from './state-manager.js';
import { TaskStateSchema } from './schemas.js';

/**
 * Type guard functions for SDK messages
 */
const isAssistantMessage = (msg: SDKMessage): msg is SDKAssistantMessage => msg.type === 'assistant';

const isUserMessage = (msg: SDKMessage): msg is SDKUserMessage => msg.type === 'user';

const isResultMessage = (msg: SDKMessage): msg is SDKResultMessage => msg.type === 'result';

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
            if (message.type === 'system') {
              // System initialization message (skip, not shown in Claude Code style)
              continue;
            }

            if (isUserMessage(message)) {
              // User message with tool results - TypeScript now knows this is SDKUserMessage
              if (message.message?.content && Array.isArray(message.message.content)) {
                for (const block of message.message.content) {
                  if (block.type === 'tool_result') {
                    // Show tool result
                    const isError = block.is_error || false;

                    // block.content can be a string, array, or object
                    let resultText = '';
                    if (typeof block.content === 'string') {
                      resultText = block.content;
                    } else if (Array.isArray(block.content)) {
                      // Extract text from content blocks array
                      resultText = block.content
                        .filter((c: unknown): c is { type: 'text'; text: string } =>
                          typeof c === 'object' && c !== null && 'type' in c && c.type === 'text'
                        )
                        .map((c: { type: 'text'; text: string }) => c.text)
                        .join('\n');
                    } else if (block.content && typeof block.content === 'object') {
                      // Try to stringify object content
                      resultText = JSON.stringify(block.content);
                    }

                    if (isError) {
                      process.stdout.write(`  ⎿  ❌ Error\n`);
                    } else if (typeof resultText === 'string' && resultText.length > 0 && resultText.length < 200) {
                      // Show short results inline
                      const preview = resultText.trim().split('\n')[0];
                      process.stdout.write(`  ⎿  ${preview}\n`);
                    } else {
                      process.stdout.write(`  ⎿  ✓\n`);
                    }
                  }
                }
              }
            }

            if (isAssistantMessage(message)) {
              // Assistant message with text and/or tool use - TypeScript knows this is SDKAssistantMessage
              if (message.message?.content && Array.isArray(message.message.content)) {
                for (const block of message.message.content) {
                  if (block.type === 'text') {
                    // Display assistant text response
                    const text = block.text.trim();
                    if (text) {
                      process.stdout.write(`\n⏺ ${text}\n`);
                    }
                  } else if (block.type === 'tool_use') {
                    // Display tool call in Claude Code style
                    const input = block.input as Record<string, unknown>;

                    // Build parameter string
                    let params = '';
                    if (typeof input.file_path === 'string') {
                      params = input.file_path;
                    } else if (typeof input.command === 'string') {
                      params = input.command;
                    } else if (typeof input.pattern === 'string') {
                      params = `"${input.pattern}"`;
                    } else if (typeof input.description === 'string') {
                      params = input.description;
                    } else if (typeof input.prompt === 'string') {
                      const p = input.prompt;
                      params = p.length > 60 ? p.substring(0, 60) + '...' : p;
                    }

                    process.stdout.write(`\n⏺ ${block.name}(${params})\n`);
                  }
                }
              }
            }

            if (isResultMessage(message)) {
              // Final result with stats - TypeScript knows this is SDKResultMessage
              if (message.subtype === 'success') {
                process.stdout.write(
                  `\n✓ Completed in ${(message.duration_ms / 1000).toFixed(1)}s (${message.num_turns} turns, $${message.total_cost_usd.toFixed(4)})\n`
                );
              } else {
                process.stdout.write(`\n❌ Failed: ${message.subtype}\n`);
              }
            }

            // stream_event messages are ignored (partial streaming events)
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
