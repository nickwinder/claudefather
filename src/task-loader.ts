import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import matter from 'gray-matter';
import { Task } from './types';

/**
 * Loads tasks from markdown files in .claudefather/tasks directory
 */
export class TaskLoader {
  private taskDir: string;

  constructor(projectDir: string = '.') {
    this.taskDir = join(projectDir, '.claudefather', 'tasks');
  }

  /**
   * Load all tasks from the tasks directory, sorted by filename
   */
  async loadTasks(): Promise<Task[]> {
    try {
      const files = await readdir(this.taskDir);

      // Filter for markdown files, sort numerically
      const mdFiles = files
        .filter((file) => file.endsWith('.md'))
        .sort((a, b) => {
          // Extract leading numbers for proper sorting
          const numA = parseInt(a.match(/^\d+/)?.[0] || '0', 10);
          const numB = parseInt(b.match(/^\d+/)?.[0] || '0', 10);
          return numA - numB;
        });

      const tasks: Task[] = [];

      for (const file of mdFiles) {
        const filePath = join(this.taskDir, file);
        const content = await readFile(filePath, 'utf-8');

        // Parse frontmatter if present
        const { data: metadata, content: taskContent } = matter(content);

        // Extract task ID from filename (e.g., "001-implement-auth.md" -> "001-implement-auth")
        const taskId = file.replace(/\.md$/, '');

        tasks.push({
          id: taskId,
          file: filePath,
          content: taskContent.trim(),
          metadata: metadata as Record<string, unknown>,
        });
      }

      return tasks;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // Tasks directory doesn't exist, return empty array
        return [];
      }
      throw error;
    }
  }

  /**
   * Load a specific task by ID
   */
  async loadTask(taskId: string): Promise<Task | null> {
    const taskFile = join(this.taskDir, `${taskId}.md`);

    try {
      const content = await readFile(taskFile, 'utf-8');
      const { data: metadata, content: taskContent } = matter(content);

      return {
        id: taskId,
        file: taskFile,
        content: taskContent.trim(),
        metadata: metadata as Record<string, unknown>,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Create a new task file
   */
  async createTask(taskId: string, description: string): Promise<Task> {
    // Find highest numbered file to generate next ID if not provided
    const tasks = await this.loadTasks();
    let finalId = taskId;

    if (taskId === 'auto') {
      const highestNum = tasks.reduce((max, t) => {
        const num = parseInt(t.id.match(/^\d+/)?.[0] || '0', 10);
        return Math.max(max, num);
      }, 0);

      const nextNum = String(highestNum + 1).padStart(3, '0');
      // Slugify description
      const slug = description
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .substring(0, 50);

      finalId = `${nextNum}-${slug}`;
    }

    const content = `# ${description}\n\n(Add task details here)\n`;

    // Create tasks directory if it doesn't exist
    try {
      await readdir(this.taskDir);
    } catch {
      // Directory doesn't exist, this will be handled by supervisor
    }

    return {
      id: finalId,
      file: join(this.taskDir, `${finalId}.md`),
      content: content.trim(),
      metadata: {},
    };
  }
}
