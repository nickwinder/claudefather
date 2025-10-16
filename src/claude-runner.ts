import { spawn } from 'child_process';
import { createWriteStream } from 'fs';
import { TaskState } from './types';
import { StateManager } from './state-manager';
import { TaskStateSchema } from './schemas';

/**
 * Runs Claude Code CLI and manages the process
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
   * Execute Claude Code with a prompt (with real-time log streaming)
   * Returns the task state Claude wrote, or throws an error
   * Streams all output to log file in real-time
   */
  async run(taskId: string, prompt: string): Promise<TaskState> {
    // Ensure logs directory exists first
    await this.stateManager.ensureLogsDir();

    return new Promise((resolve, reject) => {
      const logPath = this.stateManager.getLogPath(taskId);

      // Create write stream for real-time logging
      const logStream = createWriteStream(logPath, { flags: 'a' });

      // Spawn Claude Code process
      // Note: Pass prompt via stdin, not as argument (handles long prompts better)
      const claude = spawn('claude', ['-p', '--dangerously-skip-permissions'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: this.projectDir,
        env: {
          ...process.env,
          ANTHROPIC_LOG: 'debug', // Enable debug logging
        },
      });

      let lastError = '';
      let timeoutHandle: NodeJS.Timeout;

      // Write header to log
      logStream.write(
        `\n${'='.repeat(80)}\nClaudefather Task: ${taskId}\nStarted: ${new Date().toISOString()}\n${'='.repeat(80)}\n\n`
      );

      // Write prompt to stdin and close it
      if (claude.stdin) {
        claude.stdin.write(prompt);
        claude.stdin.end();
      }

      // Stream stdout in real-time
      claude.stdout.on('data', (data) => {
        const chunk = data.toString();
        logStream.write(chunk);
        process.stdout.write(`.`); // Visual indicator of activity
      });

      // Stream stderr in real-time
      claude.stderr.on('data', (data) => {
        const chunk = data.toString();
        logStream.write(`[STDERR] ${chunk}`);
        lastError = chunk;
      });

      // Handle process exit
      claude.on('close', (code) => {
        clearTimeout(timeoutHandle);

        // Write footer to log
        logStream.write(`\n${'='.repeat(80)}\nProcess exited with code: ${code}\nEnded: ${new Date().toISOString()}\n${'='.repeat(80)}\n`);
        logStream.end();

        process.stdout.write('\n'); // New line after dots

        // Handle exit code
        if (code !== 0) {
          reject(new Error(`Claude Code exited with code ${code}. Last error: ${lastError}`));
          return;
        }

        // Claude should have written a state file before exiting
        this.stateManager
          .loadState(taskId)
          .then((state) => {
            if (!state) {
              reject(
                new Error(`Claude did not write state file for task ${taskId}. Check log at: ${logPath}`)
              );
              return;
            }
            resolve(state);
          })
          .catch((error) => {
            reject(
              new Error(`Failed to read state file: ${error instanceof Error ? error.message : String(error)}`)
            );
          });
      });

      // Handle errors
      claude.on('error', (error) => {
        clearTimeout(timeoutHandle);
        logStream.write(`\n[ERROR] Process error: ${error.message}\n`);
        logStream.end();

        if ((error as any).code === 'ENOENT') {
          reject(
            new Error(
              'Claude Code CLI not found. Please ensure claude-code is installed and in your PATH'
            )
          );
        } else {
          reject(error);
        }
      });

      // Set timeout
      timeoutHandle = setTimeout(() => {
        claude.kill('SIGTERM');
        logStream.write(`\n[TIMEOUT] Task exceeded ${this.timeoutMs / 1000 / 60} minutes\n`);
        logStream.end();
        reject(new Error(`Task ${taskId} timed out after ${this.timeoutMs / 1000 / 60} minutes`));
      }, this.timeoutMs);
    });
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
