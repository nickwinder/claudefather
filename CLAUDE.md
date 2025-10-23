# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Claudefather** is a lightweight CLI tool that orchestrates Claude Code sessions to autonomously complete tasks from markdown files. It manages task queues, validates outputs to detect hallucinations, handles intelligent retries, and maintains state persistence across restarts. The supervisor spawns Claude Code sessions, validates their outputs against patterns that indicate real command executions, and retries with feedback when validation fails.

## Development Commands

### Build & Development

```bash
# Build TypeScript to JavaScript
pnpm build

# Watch mode for development
pnpm dev

# Start the CLI
pnpm start
```

### Running Claudefather

```bash
# Process all tasks in queue
pnpm claudefather start

# Show current progress
pnpm claudefather status

# Create a new task
pnpm claudefather create "Task description"

# Reset a task to retry
pnpm claudefather reset <task-id>
pnpm claudefather reset --all

# Working with different projects (use --project-dir)
pnpm claudefather start --project-dir /path/to/project
pnpm claudefather status --project-dir /path/to/project
pnpm claudefather create "Task" --project-dir /path/to/project
```

## Architecture

### High-Level Flow

```
Task Files (.claudefather/tasks/.md)
    ↓
TaskLoader (parses front matter)
    ↓
Supervisor (main orchestrator)
    ├→ WorktreeManager (creates isolated git worktrees)
    ├→ ConcurrencyManager (handles parallel execution)
    ├→ StateManager (loads/saves JSON state)
    ├→ PromptBuilder (creates Claude prompts)
    ├→ ClaudeRunner (spawns `claude` CLI process in worktree)
    └→ OutputValidator (detects hallucinations)
    ↓
File Sync (copies files from worktree back to main project)
    ↓
Worktree Cleanup (removes isolated git worktree)
    ↓
State Files (.claudefather/state/*.json)
Logs (.claudefather/logs/*.log)
Templates (.claudefather/templates/*.md)
```

### Parallel Execution

Claudefather runs multiple tasks concurrently using **git worktrees**:
- Each task gets its own isolated worktree with a feature branch
- Default: 5 parallel tasks (configurable with `--parallel` flag)
- Tasks don't interfere with each other's git state
- Files are synced back to main project after completion
- Worktrees are automatically cleaned up

### Key Modules

1. **TaskLoader** (`src/task-loader.ts`) - Reads markdown files from `.claudefather/tasks/` directory, parses YAML front matter for metadata, extracts task content. Sorts tasks numerically by ID (e.g., `001-`, `002-`).

2. **StateManager** (`src/state-manager.ts`) - Persists task state to `.claudefather/state/{task-id}.json`. Loads previous execution state to resume or retry. Handles state validation with Zod schemas.

3. **WorktreeManager** (`src/worktree-manager.ts`) - Creates and manages git worktrees for isolated task execution. Creates feature branches for each task. Syncs `.claudefather/` files from worktree back to main project. Cleans up worktrees after task completion.

4. **ClaudeRunner** (`src/claude-runner.ts`) - Spawns Claude Code CLI as a subprocess with 1-hour timeout. Passes prompt via stdin. Captures full stdout/stderr output. Handles process cleanup. Works within worktree context when provided.

5. **PromptBuilder** (`src/prompt-builder.ts`) - Constructs the prompt sent to Claude, including system instructions from `.claudefather/templates/system-prompt.md`, the task description, and retry feedback from previous attempts if validation failed.

6. **OutputValidator** (`src/validators.ts`) - Validates Claude's output state file for consistency. Validates git state (commit SHA format, branch consistency). Returns specific validation issues that are fed back to Claude on retry.

7. **ConcurrencyManager** (`src/concurrency-manager.ts`) - Manages parallel task execution. Limits concurrent tasks to configurable count (default: 5). Queues and schedules tasks for execution.

8. **Supervisor** (`src/supervisor.ts`) - Main orchestration logic. Loads tasks, creates worktrees, processes tasks in parallel via ConcurrencyManager, syncs files from worktrees, manages retry loop (max 3 attempts). Stops at blockers (human intervention needed). Marks tasks as complete when validation passes.

### Task State Lifecycle

1. **Pending** - Task exists but no state file yet
2. **In Progress** - Claude is working on it (state file exists with unfinished status)
3. **Blocked** - State shows a blocker status (HUMAN_REVIEW_REQUIRED, TESTS_FAILING_STUCK, etc.)
4. **Verified Complete** - Validation passed, all checks green, task done
5. **Complete** - Work done but awaiting supervisor validation (gets validated and retried if needed)

### Retry Mechanism

When a task fails validation:
1. Supervisor detects issues (git inconsistency, invalid format, etc.)
2. Issues are serialized as feedback into the retry prompt
3. New prompt includes: system instructions + task + previous state + validation feedback
4. Claude retries with context about what went wrong
5. Max 3 attempts before marking for human review

### Validation

The validator checks for:
- **Git**: Valid commit SHA format, consistent branch names, no uncommitted changes

## Task File Format

Tasks are markdown files in `.claudefather/tasks/` directory named `{number}-{slug}.md`:

```markdown
# Task Title

Description of what needs to be implemented.

## Acceptance Criteria

- Clear list of what success looks like
- Reference existing patterns if applicable

Ensure:
- All tests pass with `pnpm test`
- Build succeeds with `pnpm build`
- No linting errors with `pnpm lint`
```

See `tasks/README.md` for detailed task writing guide.

## State File Structure

Claude writes `.claudefather/state/{task-id}.json` with this schema (defined in `src/schemas.ts`):

```typescript
{
  taskId: string;
  status: TaskStatus; // enum: VERIFIED_COMPLETE | HUMAN_REVIEW_REQUIRED | TESTS_FAILING_STUCK | etc
  branch: string;     // git branch name
  commitSha: string;  // commit hash
  gitStatus: { branch, originalBranch?, uncommittedChanges, lastCommitMessage, lastCommitSha }
  attemptNumber: number;
  startedAt: ISO8601;
  completedAt: ISO8601;
  filesChanged: string[];
  summary: string;    // Should include details about tests, build, and any issues
  assumptions?: Array<{ description, reasoning }>;
  workarounds?: Array<{ issue, solution }>;
  feedback?: { issues, instruction };     // Added by supervisor on retry
  validationIssues?: ValidationIssue[];    // Added by supervisor on retry
}
```

See `.claudefather/templates/system-prompt.md` for detailed requirements Claude must follow when writing state files.

## Configuration

### Directory Structure

All directories are encapsulated under `.claudefather/` (gitignored):

```
project-dir/
└── .claudefather/               # All supervisor working directories (gitignored)
    ├── tasks/                   # Task markdown files (e.g., 001-task.md)
    ├── state/                   # Task state JSON files (synced from worktrees)
    ├── logs/                    # Task execution logs (synced from worktrees)
    ├── templates/               # System prompt templates
    └── worktrees/               # Git worktrees for parallel execution
        ├── {task-id}/           # Isolated worktree for each task
        │   └── .claudefather/   # Task's local .claudefather (synced back to main)
        └── ...                  # One worktree per parallel task
```

**Note**: Worktrees are temporary and automatically cleaned up after each task completes. The `.claudefather/` directories created within worktrees are synced back to the main project before cleanup, ensuring no data is lost.

### Fixed Paths

- **Project Directory**: Configurable via `--project-dir` flag, defaults to `.`
- **Task Directory**: Always `{project-dir}/.claudefather/tasks/` - Contains markdown task files
- **State Directory**: Always `{project-dir}/.claudefather/state/` - Task state files (synced from worktrees)
- **Logs Directory**: Always `{project-dir}/.claudefather/logs/` - Execution logs (synced from worktrees)
- **Templates Directory**: Always `{project-dir}/.claudefather/templates/` - System prompts
- **Worktrees Directory**: Always `{project-dir}/.claudefather/worktrees/` - Git worktrees for parallel task execution
- **Worktree Paths**: Each task gets `{project-dir}/.claudefather/worktrees/{task-id}/` with its own feature branch

### Usage

```bash
# Default: uses current directory as project (5 parallel workers)
pnpm claudefather start

# Specify a different project directory
pnpm claudefather start --project-dir /path/to/project

# Control parallel execution (default: 5)
pnpm claudefather start --parallel 10
pnpm claudefather start --project-dir /path/to/project --parallel 3

# Other commands also support --project-dir
pnpm claudefather status --project-dir /path/to/project
pnpm claudefather create "Task" --project-dir /path/to/project
```

### Working Directory

When Claude Code runs, its working directory (`cwd`) is set to the **worktree root** for that task (e.g., `{project-dir}/.claudefather/worktrees/{task-id}/`), not the main project directory. This ensures file operations happen in the isolated task context.

**Important**: The worktree has the same git history and structure as the main project, so paths are identical.

## TypeScript Configuration

Project uses strict mode with these key settings:
- `ES2020` target with ES module semantics
- Full strict mode enabled
- `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns` all enforced
- Source maps enabled for debugging
- See `tsconfig.json` for complete config

## Key Dependencies

- **commander**: CLI argument parsing
- **chalk**: Terminal colors and formatting
- **execa**: Child process execution with better error handling
- **gray-matter**: YAML front matter parsing from markdown
- **ora**: Spinner/progress indicators
- **zod**: Runtime schema validation for state files

## Important Patterns & Conventions

### Blocker Statuses

When Claude can't proceed, it marks tasks with blocker statuses instead of retrying endlessly:
- `HUMAN_REVIEW_REQUIRED` - Design decision or clarification needed
- `TESTS_FAILING_STUCK` - Tried multiple fixes, root cause unclear
- `BUILD_FAILING_STUCK` - Build error won't resolve (e.g., complex type inference)
- `LINT_ERRORS_STUCK` - Architectural changes needed
- `MISSING_INFORMATION` - Task requirements incomplete
- `EXTERNAL_DEPENDENCY_BLOCKED` - DB/API/service unavailable
- `MERGE_CONFLICT_DETECTED` - Git conflicts need manual resolution

Supervisor stops processing when a blocker is encountered and exits with code 0. Human must fix and reset.

### Output Validation Philosophy

The validator checks for basic consistency:
- Validates git state (commit SHA format, branch consistency)
- Reports all issues found, not just first one

Claude should provide detailed summaries in the summary field, including test results, build status, and any issues encountered.

### Assumptions & Workarounds

Claude documents in the state file:
- **Assumptions**: Decisions made without explicit requirements (e.g., "token expiry = 1 hour")
- **Workarounds**: Non-ideal solutions to blockers (e.g., "used mock data instead of API")

These help humans understand the implementation choices.

## Common Development Tasks

### Adding a New CLI Command

1. Add command definition to `src/index.ts` using commander
2. Implement corresponding method in `AISupervisor` class
3. Handle options and errors appropriately

### Extending Validation

1. Add pattern to `src/validators.ts` in the appropriate check function
2. Update validation issue types in `src/types.ts` if needed
3. Test with sample state files to ensure patterns work

### Modifying State Schema

1. Update TypeScript interface in `src/types.ts`
2. Update Zod schema in `src/schemas.ts`
3. Update template in `templates/system-prompt.md` to reflect new schema
4. Handle migration of old state files if needed

### Debugging Task Execution

1. Check logs: `cat .claudefather/logs/{task-id}.log`
2. Inspect state: `cat .claudefather/state/{task-id}.json | jq`
3. Look for validation issues in state: check `validationIssues` array
4. Review retry feedback: check `feedback` field
5. Re-run with `pnpm claudefather reset {task-id}` then `pnpm claudefather start`

## Testing & Quality

All code uses TypeScript strict mode. No existing test suite yet (this is for a task automation tool). To test locally:

1. Create a test task in `tasks/` directory
2. Run `pnpm build` to compile
3. Run `pnpm claudefather start` to process
4. Check state file and logs in `.claudefather/`

## Git Workflow

- **Worktree Isolation**: Each task runs in its own git worktree with a dedicated feature branch
- Claude checks the current branch in the worktree before starting
- Tasks run on feature branches named `feature/{task-id}` (or `{prefix}/{task-id}` with custom branch prefix)
- Claude commits work to the feature branch within the worktree
- **Claude switches back to the original branch** after committing (within the worktree)
- **Claude does NOT push branches** - supervisor manages that
- **File Synchronization**: After Claude completes, supervisor syncs `.claudefather/` files from worktree to main project
- **Worktree Cleanup**: Supervisor removes the worktree after files are synced
- State files track git status (including `originalBranch`) for verification
- The `branch` field in gitStatus should reflect the current branch (original branch after switching back)
- If `MERGE_CONFLICT_DETECTED`, human must resolve and reset
- **Multiple Worktrees**: Multiple worktrees can exist simultaneously without interfering with each other or the main project

## Debugging Tips

- **Git inconsistency**: Branch name or commit format doesn't match expectations. Check git status in state file.
- **Max retries exceeded**: Task hit 3 attempts and still has validation issues. Likely needs human review or different approach.
- **Invalid summary**: Summary should be detailed and include test results, build status, and any issues encountered.
