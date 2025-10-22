import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
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
    validation?: ValidationResult,
    branchPrefix: string = 'feature'
  ): Promise<string> {
    // Build system prompt (core instructions + optional project template)
    let systemPrompt = await this.buildSystemPrompt();

    // Substitute branch prefix placeholder
    systemPrompt = systemPrompt.replace(/{BRANCH_PREFIX}/g, branchPrefix);

    let prompt = systemPrompt + '\n\n---\n\n[TASK ASSIGNMENT]\n\n';
    prompt += `Task ID: ${task.id}\n\n`;
    prompt += `IMPORTANT: You MUST use the exact Task ID "${task.id}" when:\n`;
    prompt += `- Creating the branch: ${branchPrefix}/${task.id}\n`;
    prompt += `- Writing the state file: .claudefather/state/${task.id}.json\n`;
    prompt += `- Setting the taskId field in the JSON: "taskId": "${task.id}"\n`;
    prompt += `- Setting the branchPrefix field in the JSON: "branchPrefix": "${branchPrefix}"\n\n`;

    // Include task metadata if present
    if (task.metadata && Object.keys(task.metadata).length > 0) {
      prompt += `[TASK METADATA]\n\n`;

      // Highlight PR creation requirement if present
      if (task.metadata.createPr === true) {
        prompt += `⚠️ **PR CREATION REQUIRED**: createPr = true\n`;
        prompt += `This task REQUIRES creating a Pull Request on GitHub before marking complete.\n`;
        if (task.metadata.title) {
          prompt += `- PR Title: ${task.metadata.title}\n`;
        }
        if (task.metadata.labels && Array.isArray(task.metadata.labels)) {
          prompt += `- PR Labels: ${task.metadata.labels.join(', ')}\n`;
        }
        prompt += `\n`;
      }

      // Include other metadata
      for (const [key, value] of Object.entries(task.metadata)) {
        if (key !== 'createPr' && key !== 'title' && key !== 'labels') {
          prompt += `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}\n`;
        }
      }
      prompt += '\n';
    }

    prompt += `---\n\n[TASK DESCRIPTION]\n\n${task.content}`;

    // Add retry context if this is a retry
    if (previousState) {
      prompt += this.buildRetryContext(previousState, validation);
    }

    return prompt;
  }

  /**
   * Build the system prompt (core instructions + optional project template)
   *
   * This is called as part of buildPrompt() to construct the full system instructions.
   * Flow:
   * 1. Get core instructions (workflow, state format, critical rules)
   * 2. If project template exists at .claudefather/templates/system-prompt.md, append it
   * 3. Project template provides project-specific extensions to core instructions
   */
  private async buildSystemPrompt(): Promise<string> {
    const corePrompt = this.getDefaultSystemPrompt();

    // Check if project template exists and append it if present
    if (existsSync(this.systemPromptPath)) {
      const projectTemplate = await readFile(this.systemPromptPath, 'utf-8');
      return corePrompt + '\n\n' + projectTemplate;
    }

    // No project template, just use core instructions
    return corePrompt;
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
   * Default system prompt - minimal core instructions
   * The template file provides complete detailed guidance and is appended below
   */
  private getDefaultSystemPrompt(): string {
    return `You are working in an automated task queue managed by an AI supervisor.
Your job is to implement requirements, verify everything works, and report your status.

Read the complete instructions below carefully - they contain the full workflow, state file requirements, and status definitions.`;
  }
}
