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
Task Files (.md)
    ↓
TaskLoader (parses front matter)
    ↓
Supervisor (main orchestrator)
    ├→ StateManager (loads/saves JSON state)
    ├→ PromptBuilder (creates Claude prompts)
    ├→ ClaudeRunner (spawns `claude` CLI process)
    └→ OutputValidator (detects hallucinations)
    ↓
State Files (.claudefather/state/*.json)
Logs (.claudefather/logs/*.log)
```

### Key Modules

1. **TaskLoader** (`src/task-loader.ts`) - Reads markdown files from `tasks/` directory, parses YAML front matter for metadata, extracts task content. Sorts tasks numerically by ID (e.g., `001-`, `002-`).

2. **StateManager** (`src/state-manager.ts`) - Persists task state to `.claudefather/state/{task-id}.json`. Loads previous execution state to resume or retry. Handles state validation with Zod schemas.

3. **ClaudeRunner** (`src/claude-runner.ts`) - Spawns Claude Code CLI as a subprocess with 1-hour timeout. Passes prompt via stdin. Captures full stdout/stderr output. Handles process cleanup.

4. **PromptBuilder** (`src/prompt-builder.ts`) - Constructs the prompt sent to Claude, including system instructions from `templates/system-prompt.md`, the task description, and retry feedback from previous attempts if validation failed.

5. **OutputValidator** (`src/validators.ts`) - Validates Claude's output state file by checking for hallucinations. Pattern-matches for real command outputs: test framework markers (✓, FAIL, PASS), file paths, exit codes, timing info. Returns specific validation issues that are fed back to Claude on retry.

6. **Supervisor** (`src/supervisor.ts`) - Main orchestration logic. Loads tasks, processes each sequentially, manages retry loop (max 3 attempts). Stops at blockers (human intervention needed). Marks tasks as complete when validation passes.

### Task State Lifecycle

1. **Pending** - Task exists but no state file yet
2. **In Progress** - Claude is working on it (state file exists with unfinished status)
3. **Blocked** - State shows a blocker status (HUMAN_REVIEW_REQUIRED, TESTS_FAILING_STUCK, etc.)
4. **Verified Complete** - Validation passed, all checks green, task done
5. **Complete** - Work done but awaiting supervisor validation (gets validated and retried if needed)

### Retry Mechanism

When a task fails validation:
1. Supervisor detects issues (exit code mismatch, hallucinated output, git inconsistency)
2. Issues are serialized as feedback into the retry prompt
3. New prompt includes: system instructions + task + previous state + validation feedback
4. Claude retries with context about what went wrong
5. Max 3 attempts before marking for human review

### Validation Patterns

The validator checks for these signals of real command execution:

- **Tests**: "PASS", "FAIL", "✓", test file paths (tests/*.test.ts), test counts
- **Build**: "webpack", "vite", "tsc", "turbo", "dist/", "build/", timing info
- **Lint**: "eslint", "prettier", warning/error counts, file paths
- **Git**: Valid commit SHA format, consistent branch names

## Task File Format

Tasks are markdown files in `tasks/` directory named `{number}-{slug}.md`:

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
  verification: {     // actual command outputs
    tests: { exitCode, output, summary }
    build: { exitCode, output, summary }
    lint: { exitCode, output, summary }
  }
  gitStatus: { branch, uncommittedChanges, lastCommitMessage, lastCommitSha }
  attemptNumber: number;
  startedAt: ISO8601;
  completedAt: ISO8601;
  filesChanged: string[];
  summary: string;
  assumptions?: Array<{ description, reasoning }>;
  workarounds?: Array<{ issue, solution }>;
  feedback?: { issues, instruction };     // Added by supervisor on retry
  validationIssues?: ValidationIssue[];    // Added by supervisor on retry
}
```

See `templates/system-prompt.md` for detailed requirements Claude must follow when writing state files.

## Configuration

### Directories

- **Project Directory**: `.` (configurable via `--project-dir` flag) - The target project where Claude works. All paths are resolved relative to this directory.
- **Task Directory**: `tasks/` (configurable via `--tasks-dir` flag) - Relative to project-dir. Contains markdown task files.
- **State Directory**: `.claudefather/` (configurable via `--supervisor-dir` flag, gitignored) - Relative to project-dir. Contains task state files and logs.

### Path Resolution

All paths are resolved relative to `--project-dir`:

```bash
# Default: uses current directory as project
pnpm claudefather start

# Specify different project
pnpm claudefather start --project-dir /path/to/project

# Customize task/state locations
pnpm claudefather start --project-dir /path/to/project \
  --tasks-dir ./tasks \
  --supervisor-dir ./.supervisor
```

### State Files & Logs

- **State Files**: `{project-dir}/.claudefather/state/{task-id}.json`
- **Logs**: `{project-dir}/.claudefather/logs/{task-id}.log`
- **Claude Working Directory**: When Claude runs, its `cwd` is set to `{project-dir}` so all file operations happen there

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

The validator is intentionally conservative to catch hallucinations:
- Detects suspicious patterns (too clean output, missing real markers)
- Checks exit code consistency (claim 0 but exit non-zero = catch)
- Validates git state (commit SHA format, branch consistency)
- Reports all issues found, not just first one

Claude should always include actual command output, not summaries.

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

- Tasks run on feature branches named `feature/{task-id}`
- Claude commits work to the feature branch
- **Claude does NOT push branches** - supervisor manages that
- State files track git status for verification
- If `MERGE_CONFLICT_DETECTED`, human must resolve and reset

## Debugging Tips

- **Hallucination detected**: Check what patterns are triggering. Claude may need to copy more real output.
- **Exit code mismatch**: Supervisor caught Claude claiming exit 0 when it was non-zero. Check actual command output.
- **Git inconsistency**: Branch name or commit format doesn't match expectations. Check git status in state file.
- **Max retries exceeded**: Task hit 3 attempts and still has validation issues. Likely needs human review or different approach.
