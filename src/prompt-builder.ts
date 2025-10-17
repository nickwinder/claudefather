import { readFile } from 'fs/promises';
import { join } from 'path';
import { Task, TaskState, ValidationResult } from './types.js';

/**
 * Builds prompts with system instructions and context
 */
export class PromptBuilder {
  private systemPromptPath: string;

  constructor(projectDir: string = '.') {
    const templatesDir = join(projectDir, '.claudefather', 'templates');
    this.systemPromptPath = join(templatesDir, 'system-prompt.md');
  }

  /**
   * Build a prompt for a task, optionally with retry context
   */
  async buildPrompt(
    task: Task,
    previousState?: TaskState,
    validation?: ValidationResult
  ): Promise<string> {
    // Load system prompt template
    let systemPrompt = await this.loadSystemPrompt();

    let prompt = systemPrompt + '\n\n---\n\n[TASK ASSIGNMENT]\n\n';
    prompt += `Task ID: ${task.id}\n\n`;
    prompt += `IMPORTANT: You MUST use the exact Task ID "${task.id}" when:\n`;
    prompt += `- Creating the feature branch: feature/${task.id}\n`;
    prompt += `- Writing the state file: .claudefather/state/${task.id}.json\n`;
    prompt += `- Setting the taskId field in the JSON: "taskId": "${task.id}"\n\n`;
    prompt += `---\n\n[TASK DESCRIPTION]\n\n${task.content}`;

    // Add retry context if this is a retry
    if (previousState) {
      prompt += this.buildRetryContext(previousState, validation);
    }

    return prompt;
  }

  /**
   * Load the system prompt template
   */
  private async loadSystemPrompt(): Promise<string> {
    try {
      return await readFile(this.systemPromptPath, 'utf-8');
    } catch (error) {
      // Return default system prompt if template file not found
      return this.getDefaultSystemPrompt();
    }
  }

  /**
   * Build retry context to append to prompt
   */
  private buildRetryContext(previousState: TaskState, validation?: ValidationResult): string {
    let context = `\n\n---\n\n[PREVIOUS ATTEMPT - ATTEMPT #${previousState.attemptNumber}]\n\n`;

    context += `Status: ${previousState.status}\n`;
    context += `Completed at: ${previousState.completedAt}\n\n`;

    if (previousState.feedback?.issues && previousState.feedback.issues.length > 0) {
      context += `Issues found:\n`;
      previousState.feedback.issues.forEach((issue, i) => {
        context += `${i + 1}. ${issue}\n`;
      });
      context += '\n';
    }

    if (validation?.issues && validation.issues.length > 0) {
      context += `Validation issues:\n`;
      validation.issues.forEach((issue, i) => {
        context += `${i + 1}. [${issue.type}] ${issue.message}\n`;
      });
      context += '\n';
    }

    context += `Please address these issues and try again.\n`;
    context += `Write your updated state file when done.\n`;

    return context;
  }

  /**
   * Default system prompt - used if template file not found
   */
  private getDefaultSystemPrompt(): string {
    return `[SYSTEM INSTRUCTIONS - AI SUPERVISOR MODE]

You are working in an automated task queue managed by an AI supervisor.
Your task is to implement requirements and verify everything works.

## Your Workflow

1. Check current branch with \`git branch --show-current\` and save it
2. Create feature branch: \`git checkout -b feature/{task-id}\`
3. Implement the requirements
4. Write tests for new functionality
5. Run any necessary checks to verify your implementation
6. Commit your work with descriptive message
7. Switch back to original branch: \`git checkout {original-branch}\`
8. DO NOT push any branches
9. Write state file and exit

## State File Format

Write \`.claudefather/state/{task-id}.json\` before exiting:

\`\`\`json
{
  "taskId": "{task-id}",
  "status": "VERIFIED_COMPLETE",
  "branch": "feature/{task-id}",
  "commitSha": "abc123...",
  "gitStatus": {
    "branch": "{original-branch}",
    "originalBranch": "{original-branch}",
    "uncommittedChanges": false,
    "lastCommitMessage": "Your commit message",
    "lastCommitSha": "abc123def456..."
  },
  "attemptNumber": 1,
  "startedAt": "2025-10-17T10:00:00Z",
  "completedAt": "2025-10-17T10:45:00Z",
  "filesChanged": ["src/file1.ts", "tests/file1.test.ts"],
  "summary": "Implemented the feature. All 42 tests passing. Build successful. No lint errors."
}
\`\`\`

## Status Values

- **VERIFIED_COMPLETE** - All checks passed, work is ready
- **TASK_COMPLETE** - Work done, awaiting verification
- **HUMAN_REVIEW_REQUIRED** - Need clarification or design decision
- **TESTS_FAILING_STUCK** - Tests fail, exhausted debugging
- **BUILD_FAILING_STUCK** - Build fails, can't resolve
- **LINT_ERRORS_STUCK** - Lint errors need architectural change
- **MISSING_INFORMATION** - Cannot make reasonable assumption
- **EXTERNAL_DEPENDENCY_BLOCKED** - Service/DB/network issue
- **MERGE_CONFLICT_DETECTED** - Git conflicts need resolution

## Important

- Provide detailed summary including test results, build status, and any issues
- Be honest about status - use appropriate status values
- Document any assumptions made
- Try to fix issues 2-3 times before marking stuck
- After switching back to original branch, the "branch" field in gitStatus should be the original branch (since that's the current branch)
- Save the original branch name in "originalBranch" field so supervisor can verify you switched back
- Exit after writing state file`;
  }
}
