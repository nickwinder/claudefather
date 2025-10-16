import { Task, TaskState, ValidationResult } from './types'
import { TaskLoader } from './task-loader'
import { StateManager } from './state-manager'
import { ClaudeRunner } from './claude-runner'
import { PromptBuilder } from './prompt-builder'
import { OutputValidator } from './validators'
import chalk from 'chalk'
import ora from 'ora'
import { resolve } from 'path'

/**
 * Main supervisor that orchestrates the task queue
 */
export class AISupervisor {
  private taskLoader: TaskLoader
  private stateManager: StateManager
  private claudeRunner: ClaudeRunner
  private promptBuilder: PromptBuilder

  constructor(projectDir: string = '.') {
    const resolvedProjectDir = resolve(projectDir)
    this.taskLoader = new TaskLoader(resolvedProjectDir)
    this.stateManager = new StateManager(resolvedProjectDir)
    this.claudeRunner = new ClaudeRunner(this.stateManager, resolvedProjectDir)
    this.promptBuilder = new PromptBuilder(resolvedProjectDir)
  }

  /**
   * Run the supervisor - process all tasks
   */
  async run(): Promise<void> {
    console.log(chalk.bold.blue('\n🚀 ClaudeFather Starting\n'))

    const tasks = await this.taskLoader.loadTasks()

    if (tasks.length === 0) {
      console.log(chalk.yellow('⚠️  No tasks found in tasks/ directory'))
      return
    }

    console.log(chalk.blue(`Found ${tasks.length} task(s)\n`))

    for (const task of tasks) {
      await this.processTask(task)
    }

    console.log(chalk.bold.green('\n✅ Supervisor completed\n'))
  }

  /**
   * Process a single task
   */
  async processTask(task: Task): Promise<void> {
    console.log(chalk.bold(`\n📋 Task: ${task.id}`))

    // Load previous state if exists
    let state = await this.stateManager.loadState(task.id)

    // If already complete, skip
    if (state && state.status === 'VERIFIED_COMPLETE') {
      console.log(chalk.green(`✅ Already complete (attempt ${state.attemptNumber})`))
      return
    }

    // If blocked, stop
    if (state && this.isBlocker(state.status)) {
      console.log(chalk.yellow(`⚠️  Blocked: ${state.status}`))
      console.log(chalk.gray(`   ${state.blockerContext || 'No additional context'}`))
      process.exit(0) // Stop at blocker
      return
    }

    // Execute task with retries
    const maxAttempts = 3
    let lastValidation: ValidationResult | undefined

    while (!state || (state.status !== 'VERIFIED_COMPLETE' && !this.isBlocker(state.status))) {
      const attemptNum = (state?.attemptNumber ?? 0) + 1

      if (attemptNum > maxAttempts) {
        console.log(chalk.red(`❌ Max retries exceeded (${maxAttempts})`))
        state = {
          ...state!,
          status: 'HUMAN_REVIEW_REQUIRED',
          blockerContext: 'Max retries exceeded',
          attemptNumber: attemptNum,
          startedAt: state?.startedAt || new Date().toISOString(),
          completedAt: new Date().toISOString(),
          filesChanged: state?.filesChanged || [],
          summary: state?.summary || 'Task failed after max retries',
          verification: state?.verification || {
            tests: { exitCode: 1, output: '', summary: '' },
            build: { exitCode: 1, output: '', summary: '' },
            lint: { exitCode: 1, output: '', summary: '' },
          },
          gitStatus: state?.gitStatus || {
            branch: '',
            uncommittedChanges: true,
            lastCommitMessage: '',
            lastCommitSha: '',
          },
        }
        await this.stateManager.saveState(state)
        console.log(chalk.red('⚠️  Marked for human review'))
        process.exit(0)
        return
      }

      console.log(chalk.blue(`\n  🔄 Attempt ${attemptNum}/${maxAttempts}`))

      try {
        // Build prompt with retry context
        const prompt = await this.promptBuilder.buildPrompt(task, state ?? undefined, lastValidation)

        // Execute Claude Code
        const spinner = ora('Running Claude Code...').start()
        state = await this.claudeRunner.run(task.id, prompt)
        spinner.succeed('Claude Code completed')

        // Validate outputs
        const spinner2 = ora('Validating outputs...').start()
        lastValidation = OutputValidator.validate(state.verification, state.gitStatus)

        if (!lastValidation.valid) {
          spinner2.warn(`Found ${lastValidation.issues.length} issue(s)`)

          // Log issues
          lastValidation.issues.forEach((issue) => {
            console.log(chalk.yellow(`    - [${issue.type}] ${issue.message}`))
          })

          // Create feedback for next attempt
          state = {
            ...state,
            status: 'NEEDS_RETRY',
            feedback: {
              issues: lastValidation.issues.map((i) => i.message),
              instruction: 'Please fix the following issues and try again',
            },
          }

          await this.stateManager.saveState(state)
          continue
        } else {
          spinner2.succeed('All validations passed')
        }

        // Check if Claude claims completion
        if (state.status === 'VERIFIED_COMPLETE') {
          console.log(chalk.green('✅ Task verified complete'))
          await this.stateManager.saveState(state)
          return
        }

        if (state.status === 'TASK_COMPLETE') {
          console.log(chalk.yellow('⚠️  Claude claims complete but validation had issues'))
          state.status = 'NEEDS_RETRY'
          continue
        }

        // If blocker, stop
        if (this.isBlocker(state.status)) {
          console.log(chalk.yellow(`⚠️  Blocked: ${state.status}`))
          console.log(chalk.gray(`   ${state.blockerContext || 'No additional context'}`))
          await this.stateManager.saveState(state)
          process.exit(0)
          return
        }

        // Otherwise continue
        console.log(chalk.blue(`   Status: ${state.status}`))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.log(chalk.red(`  ❌ Error: ${message}`))

        // Create error state
        state = {
          taskId: task.id,
          status: 'HUMAN_REVIEW_REQUIRED',
          blockerContext: `Error during execution: ${message}`,
          attemptNumber: attemptNum,
          startedAt: state?.startedAt || new Date().toISOString(),
          completedAt: new Date().toISOString(),
          filesChanged: state?.filesChanged || [],
          summary: state?.summary || `Task failed: ${message}`,
          verification: state?.verification || {
            tests: { exitCode: 1, output: '', summary: '' },
            build: { exitCode: 1, output: '', summary: '' },
            lint: { exitCode: 1, output: '', summary: '' },
          },
          gitStatus: state?.gitStatus || {
            branch: '',
            uncommittedChanges: true,
            lastCommitMessage: '',
            lastCommitSha: '',
          },
        }

        await this.stateManager.saveState(state)
        process.exit(1)
        return
      }
    }
  }

  /**
   * Check if a status is a blocker (needs human intervention)
   */
  private isBlocker(status: string): boolean {
    return [
      'HUMAN_REVIEW_REQUIRED',
      'TESTS_FAILING_STUCK',
      'BUILD_FAILING_STUCK',
      'LINT_ERRORS_STUCK',
      'MISSING_INFORMATION',
      'EXTERNAL_DEPENDENCY_BLOCKED',
      'MERGE_CONFLICT_DETECTED',
    ].includes(status)
  }

  /**
   * Reset a task to pending state
   */
  async resetTask(taskId: string): Promise<void> {
    await this.stateManager.resetTask(taskId)
    console.log(chalk.green(`✅ Task ${taskId} reset to pending`))
  }

  /**
   * Get status summary
   */
  async getStatus(): Promise<void> {
    const tasks = await this.taskLoader.loadTasks()

    const completed: TaskState[] = []
    const inProgress: TaskState[] = []
    const blocked: TaskState[] = []
    const pending: Task[] = []

    for (const task of tasks) {
      const state = await this.stateManager.loadState(task.id)

      if (!state) {
        pending.push(task)
      } else if (state.status === 'VERIFIED_COMPLETE') {
        completed.push(state)
      } else if (this.isBlocker(state.status)) {
        blocked.push(state)
      } else {
        inProgress.push(state)
      }
    }

    console.log(chalk.bold('\n📊 ClaudeFather Status\n'))

    if (completed.length > 0) {
      console.log(chalk.green(`✅ Completed: ${completed.length}`))
      completed.forEach((s) => {
        console.log(chalk.gray(`   ${s.taskId} (attempt ${s.attemptNumber})`))
      })
    }

    if (inProgress.length > 0) {
      console.log(chalk.blue(`\n🔄 In Progress: ${inProgress.length}`))
      inProgress.forEach((s) => {
        console.log(chalk.gray(`   ${s.taskId} (attempt ${s.attemptNumber})`))
      })
    }

    if (blocked.length > 0) {
      console.log(chalk.yellow(`\n⚠️  Blocked: ${blocked.length}`))
      blocked.forEach((s) => {
        console.log(chalk.gray(`   ${s.taskId}: ${s.status}`))
      })
    }

    if (pending.length > 0) {
      console.log(chalk.gray(`\n⏳ Pending: ${pending.length}`))
      pending.forEach((t) => {
        console.log(chalk.gray(`   ${t.id}`))
      })
    }

    console.log('')
  }
}
