import { execa, execaCommand } from 'execa';
import { join } from 'path';
import { cp } from 'fs/promises';

/**
 * Manages git worktree lifecycle for parallel task execution
 */
export class WorktreeManager {
  private projectDir: string;
  private worktreeBaseDir: string;

  constructor(projectDir: string = '.') {
    this.projectDir = projectDir;
    this.worktreeBaseDir = join(projectDir, '.claudefather', 'worktrees');
  }

  /**
   * Get worktree path for a task
   */
  getWorktreePath(taskId: string): string {
    return join(this.worktreeBaseDir, taskId);
  }

  /**
   * Get the feature branch name for a task
   */
  getFeatureBranchName(taskId: string, branchPrefix: string = 'feature'): string {
    return `${branchPrefix}/${taskId}`;
  }

  /**
   * Create a worktree for a task
   */
  async createWorktree(taskId: string, branchPrefix: string = 'feature'): Promise<string> {
    const worktreePath = this.getWorktreePath(taskId);
    const branchName = this.getFeatureBranchName(taskId, branchPrefix);

    try {
      // Create new worktree with new branch
      // Use execa instead of execaCommand to properly escape arguments
      await execa('git', ['worktree', 'add', worktreePath, '-b', branchName], {
        cwd: this.projectDir,
      });

      return worktreePath;
    } catch (error) {
      throw new Error(
        `Failed to create worktree for task ${taskId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Remove a worktree after task completion
   */
  async removeWorktree(taskId: string): Promise<void> {
    const worktreePath = this.getWorktreePath(taskId);

    try {
      // Remove the worktree
      // Use execa instead of execaCommand to properly escape arguments
      await execa('git', ['worktree', 'remove', worktreePath], {
        cwd: this.projectDir,
      });
    } catch (error) {
      // Log warning but don't fail - worktree removal is best-effort
      console.warn(
        `Warning: Failed to remove worktree for task ${taskId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Clean up stale worktrees (those that don't have corresponding tasks)
   */
  async pruneStaleWorktrees(): Promise<void> {
    try {
      // Git prune removes stale worktree data
      await execaCommand('git worktree prune', {
        cwd: this.projectDir,
      });
    } catch (error) {
      console.warn(
        `Warning: Failed to prune stale worktrees: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * List all active worktrees
   */
  async listWorktrees(): Promise<Array<{ path: string; branch: string }>> {
    try {
      const { stdout } = await execaCommand('git worktree list --porcelain', {
        cwd: this.projectDir,
      });

      const worktrees: Array<{ path: string; branch: string }> = [];
      for (const line of stdout.split('\n')) {
        if (line.startsWith('worktree')) {
          const parts = line.split('\t');
          if (parts.length >= 2) {
            const path = parts[0].replace('worktree ', '');
            worktrees.push({
              path,
              branch: parts[1] || 'unknown',
            });
          }
        }
      }
      return worktrees;
    } catch (error) {
      console.warn(
        `Warning: Failed to list worktrees: ${error instanceof Error ? error.message : String(error)}`
      );
      return [];
    }
  }

  /**
   * Sync .claudefather files from worktree back to main project
   * This copies task files, state files, and logs that Claude created in the worktree
   * back to the main project directory so they persist after worktree cleanup
   */
  async syncFromWorktree(taskId: string): Promise<void> {
    const worktreePath = this.getWorktreePath(taskId);
    const worktreeClaude = join(worktreePath, '.claudefather');
    const mainClaude = join(this.projectDir, '.claudefather');

    try {
      // Sync tasks directory - copy any newly created task files
      try {
        await cp(
          join(worktreeClaude, 'tasks'),
          join(mainClaude, 'tasks'),
          { recursive: true, force: true }
        );
      } catch (error) {
        // Tasks directory might not exist or be empty - that's OK
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }

      // Sync state directory - copy state files
      try {
        await cp(
          join(worktreeClaude, 'state'),
          join(mainClaude, 'state'),
          { recursive: true, force: true }
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }

      // Sync logs directory - copy log files
      try {
        await cp(
          join(worktreeClaude, 'logs'),
          join(mainClaude, 'logs'),
          { recursive: true, force: true }
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }
    } catch (error) {
      // Log warning but don't fail - sync is best-effort
      console.warn(
        `Warning: Failed to sync files from worktree for task ${taskId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
