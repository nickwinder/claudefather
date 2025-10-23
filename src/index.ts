#!/usr/bin/env node

import { Command } from 'commander';
import { AISupervisor } from './supervisor.js';
import { TaskLoader } from './task-loader.js';
import { writeFile, readdir, readFile } from 'fs/promises';
import { watch } from 'fs';
import { join, resolve, isAbsolute } from 'path';
import chalk from 'chalk';

const program = new Command();

program.name('claudefather').description('Lightweight AI orchestrator for managing Claude Code task automation').version('0.0.1');

/**
 * Start command - run the supervisor
 */
program
  .command('start')
  .description('Start the supervisor and process all tasks')
  .option('-p, --parallel <number>', 'Number of parallel tasks to run (default: 5, use git worktrees)', '5')
  .action(async (options, command) => {
    try {
      const globalOpts = command.parent.opts();
      const projectDir = globalOpts.projectDir || '.';
      const parallelCount = parseInt(options.parallel, 10) || 1;

      if (parallelCount < 1) {
        console.error(chalk.red('Error: --parallel must be at least 1'));
        process.exit(1);
      }

      const supervisor = new AISupervisor(projectDir, parallelCount);
      await supervisor.run();
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

/**
 * Status command - show task progress
 */
program
  .command('status')
  .description('Show status of all tasks')
  .action(async (_options, command) => {
    try {
      const globalOpts = command.parent.opts();
      const projectDir = globalOpts.projectDir || '.';
      const supervisor = new AISupervisor(projectDir);
      await supervisor.getStatus();
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

/**
 * Create command - create a new task file
 */
program
  .command('create <description>')
  .description('Create a new task file')
  .action(async (description, _options, command) => {
    try {
      const globalOpts = command.parent.opts();
      const projectDirOption = globalOpts.projectDir || '.';
      const projectDir = isAbsolute(projectDirOption) ? projectDirOption : resolve(process.cwd(), projectDirOption);
      const taskLoader = new TaskLoader(projectDir);

      // Get next task number
      const tasks = await taskLoader.loadTasks();
      const highestNum = tasks.reduce((max, t) => {
        const num = parseInt(t.id.match(/^\d+/)?.[0] || '0', 10);
        return Math.max(max, num);
      }, 0);

      const nextNum = String(highestNum + 1).padStart(3, '0');
      const slug = description
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .substring(0, 50);

      const taskId = `${nextNum}-${slug}`;
      // Use taskLoader to create task to ensure directory exists
      const taskToCreate = await taskLoader.createTask(taskId, description);
      const taskFile = taskToCreate.file;

      const content = `# ${description}

Add detailed task requirements here. Include:
- What should be implemented
- Any specific requirements
- Expected outcomes
- Testing guidelines

Make sure to commit your work on a feature branch and do not push.
`;

      await writeFile(taskFile, content);
      console.log(chalk.green(`✅ Created task: ${taskId}`));
      console.log(chalk.gray(`   File: ${taskFile}`));
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

/**
 * Reset command - reset a task to pending state
 */
program
  .command('reset [taskId]')
  .description('Reset a task to pending state')
  .option('--all', 'Reset all tasks')
  .action(async (taskId, options, command) => {
    try {
      const globalOpts = command.parent.opts();
      const projectDirOption = globalOpts.projectDir || '.';
      const projectDir = isAbsolute(projectDirOption) ? projectDirOption : resolve(process.cwd(), projectDirOption);
      const supervisor = new AISupervisor(projectDir);

      if (options.all) {
        const taskLoader = new TaskLoader(projectDir);
        const tasks = await taskLoader.loadTasks();
        for (const task of tasks) {
          await supervisor.resetTask(task.id);
        }
        console.log(chalk.green(`✅ Reset all ${tasks.length} tasks`));
      } else if (taskId) {
        await supervisor.resetTask(taskId);
      } else {
        console.error(chalk.red('Error: Provide taskId or use --all'));
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

/**
 * Log command - show task logs
 */
program
  .command('log')
  .description('Show latest or specific task logs')
  .option('-t, --task <id>', 'Specific task ID to view')
  .option('-f, --follow', 'Follow log in real-time (like tail -f)')
  .option('-n, --lines <num>', 'Show last N lines', '50')
  .action(async (options, command) => {
    try {
      const globalOpts = command.parent.opts();
      const projectDirOption = globalOpts.projectDir || '.';
      const projectDir = isAbsolute(projectDirOption) ? projectDirOption : resolve(process.cwd(), projectDirOption);
      const logsDir = join(projectDir, '.claudefather', 'logs');

      let logPath: string;

      if (options.task) {
        // Use specified task
        logPath = join(logsDir, `${options.task}.log`);
      } else {
        // Find latest log file
        try {
          const files = await readdir(logsDir);
          const logFiles = files.filter((f) => f.endsWith('.log'));

          if (logFiles.length === 0) {
            console.log(chalk.yellow('⚠️  No log files found'));
            return;
          }

          // Just use the first one (last by default with fs operations)
          logPath = join(logsDir, logFiles[logFiles.length - 1]);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            console.log(chalk.yellow('⚠️  No logs directory found. Run tasks first.'));
          } else {
            throw error;
          }
          return;
        }
      }

      // Read and display log
      const content = await readFile(logPath, 'utf-8');
      const lines = content.split('\n');
      const numLines = parseInt(options.lines, 10) || 50;

      if (options.follow) {
        // Watch mode
        console.log(chalk.blue(`📋 Following: ${logPath}`));
        console.log(chalk.gray('Press Ctrl+C to stop\n'));

        let lastLine = lines.length;

        // Print initial content
        const startLine = Math.max(0, lines.length - numLines);
        lines.slice(startLine).forEach((line) => {
          if (line.trim()) console.log(line);
        });

        // Watch for changes
        const watcher = watch(logPath, (eventType) => {
          if (eventType === 'change') {
            readFile(logPath, 'utf-8')
              .then((newContent) => {
                const newLines = newContent.split('\n');
                // Print only new lines
                for (let i = lastLine; i < newLines.length; i++) {
                  if (newLines[i]?.trim()) {
                    console.log(newLines[i]);
                  }
                }
                lastLine = newLines.length;
              })
              .catch((err) => {
                console.error(chalk.red('Error reading log:'), err);
              });
          }
        });

        process.on('SIGINT', () => {
          watcher.close();
          console.log(chalk.gray('\n👋 Stopped following logs'));
          process.exit(0);
        });
      } else {
        // Print last N lines
        const startLine = Math.max(0, lines.length - numLines);
        console.log(chalk.blue(`📋 Latest logs from: ${logPath}\n`));

        if (startLine > 0) {
          console.log(chalk.gray(`... (showing last ${numLines} of ${lines.length} lines) ...\n`));
        }

        lines.slice(startLine).forEach((line) => {
          if (line.includes('[ERROR]') || line.includes('[STDERR]')) {
            console.log(chalk.red(line));
          } else if (line.includes('================')) {
            console.log(chalk.blue(line));
          } else if (line.includes('Started:') || line.includes('Ended:')) {
            console.log(chalk.cyan(line));
          } else {
            console.log(line);
          }
        });
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .option('--project-dir <dir>', 'Target project directory', '.')
  .parse();
