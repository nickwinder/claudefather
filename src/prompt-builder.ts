import { readFile } from 'fs/promises';
import { join } from 'path';
import { Task, TaskState, ValidationResult } from './types';

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

    let prompt = systemPrompt + '\n\n---\n\n[USER TASK]\n' + task.content;

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

    // Show actual verification results if different from what was claimed
    if (previousState.verification) {
      context += `Previous verification results:\n`;
      context += `- Tests: Exit code ${previousState.verification.tests.exitCode}\n`;
      if (previousState.verification.tests.exitCode !== 0) {
        context += `  ${previousState.verification.tests.output.substring(0, 200)}\n`;
      }
      context += `- Build: Exit code ${previousState.verification.build.exitCode}\n`;
      if (previousState.verification.build.exitCode !== 0) {
        context += `  ${previousState.verification.build.output.substring(0, 200)}\n`;
      }
      context += `- Lint: Exit code ${previousState.verification.lint.exitCode}\n`;
      if (previousState.verification.lint.exitCode !== 0) {
        context += `  ${previousState.verification.lint.output.substring(0, 200)}\n`;
      }
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

1. Create feature branch: \`feature/{task-id}\`
2. Implement the requirements
3. Write tests for new functionality
4. Run verification:
   - \`pnpm test\` (capture full output)
   - \`pnpm build\` (capture full output)
   - \`pnpm lint\` (capture full output)
5. Commit your work with descriptive message
6. DO NOT push the branch
7. Write state file and exit

## State File Format

Write \`.claudefather/state/{task-id}.json\` before exiting:

\`\`\`json
{
  "taskId": "{task-id}",
  "status": "VERIFIED_COMPLETE",
  "branch": "feature/{task-id}",
  "commitSha": "abc123...",
  "verification": {
    "tests": {
      "exitCode": 0,
      "output": "(paste full test output here)",
      "summary": "42 tests passing"
    },
    "build": {
      "exitCode": 0,
      "output": "(paste full build output here)",
      "summary": "Build completed successfully"
    },
    "lint": {
      "exitCode": 0,
      "output": "(paste full lint output here)",
      "summary": "No linting errors"
    }
  },
  "gitStatus": {
    "branch": "feature/{task-id}",
    "uncommittedChanges": false,
    "lastCommitMessage": "Your commit message",
    "lastCommitSha": "abc123def456..."
  },
  "attemptNumber": 1,
  "startedAt": "2025-10-17T10:00:00Z",
  "completedAt": "2025-10-17T10:45:00Z",
  "filesChanged": ["src/file1.ts", "tests/file1.test.ts"],
  "summary": "Brief summary of what was implemented"
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

- Include ACTUAL command output in state file (copy/paste from terminal)
- Don't hallucinate results - show real outputs
- Document any assumptions made
- Try to fix issues 2-3 times before marking stuck
- Exit after writing state file`;
  }
}
