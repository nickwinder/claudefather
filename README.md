# Claudefather

A lightweight CLI tool that orchestrates Claude sessions to autonomously complete tasks from markdown files. Built on the **Claude Agents SDK**, Claudefather manages task queues, validates outputs to detect hallucinations, and handles intelligent retries with feedback—all via API calls. Works seamlessly with Claude Code CLI authentication or direct API keys.

## Features

✅ **Autonomous Task Execution** - Claude works independently on tasks without interruption via API
✅ **Output Validation** - Detects hallucinations by validating test/build/lint outputs
✅ **Intelligent Retries** - Retries with feedback when validation fails (max 3 attempts)
✅ **State Persistence** - Tracks progress across restarts
✅ **Blocker Detection** - Stops at human intervention points
✅ **Full Logging** - Captures all activity for debugging
✅ **Parallel Execution** - Runs multiple tasks concurrently using git worktrees
✅ **File Synchronization** - Syncs task files and state from worktrees back to main project

## Installation

### Prerequisites

- **Node.js** 18+ and pnpm
- **Authentication** - Choose one of the following:

  **Option A: Claude Code CLI (Recommended)**
  - Install Claude Code CLI from [claude.ai/code](https://claude.ai/code)
  - Run `claude login` to authenticate
  - Claudefather automatically uses your Claude Code credentials via `~/.claude/settings.json`

  **Option B: Direct API Key**
  - Get an API key from [console.anthropic.com](https://console.anthropic.com)
  - Set the `ANTHROPIC_API_KEY` environment variable:
    ```bash
    export ANTHROPIC_API_KEY="your-api-key-here"
    ```

### Install Claudefather

```bash
# Clone the repository
git clone https://github.com/your-org/claudefather.git
cd claudefather

# Install dependencies
pnpm install

# Build
pnpm build
```

## Quick Start

### Authenticate First

Before running Claudefather, ensure you're authenticated:

```bash
# Option A: Using Claude Code CLI (Recommended)
claude login

# Option B: Using direct API key
export ANTHROPIC_API_KEY="your-api-key-here"
```

### Create Your First Task

```bash
# Create a task
pnpm claudefather create "Implement user authentication"

# This creates: .claudefather/tasks/001-implement-user-authentication.md
# Edit the file with task details
```

### Run Claudefather

```bash
# Start processing tasks in a project
pnpm claudefather --project-dir /path/to/project start

# Check progress
pnpm claudefather --project-dir /path/to/project status

# Reset a task to retry
pnpm claudefather --project-dir /path/to/project reset 001-implement-user-authentication

# Or run in current directory (omit --project-dir if current dir is your project)
pnpm claudefather start
```

## Task Format

Tasks are markdown files in the `.claudefather/tasks/` directory with optional YAML frontmatter for metadata:

```markdown
---
createPr: true
title: Add User Authentication
labels:
  - feature
  - backend
  - auth
---

# Implement User Authentication

Add JWT-based authentication to the API:

1. Create auth service with JWT token generation
2. Add authentication middleware
3. Protect /api/users endpoints
4. Write comprehensive tests
5. Support token refresh
6. Handle token expiration

Ensure:
- All tests pass with `pnpm test`
- Build succeeds with `pnpm build`
- No linting errors with `pnpm lint`
- Work committed to feature branch
- Branch not pushed to remote
```

### Task Frontmatter

The optional YAML frontmatter at the top of task files controls task metadata:

#### `createPr` (boolean)

Set to `true` to require Claude to create a GitHub Pull Request after completing the task:

```yaml
---
createPr: true
title: "Add User Authentication"
labels:
  - feature
  - backend
---
```

When `createPr: true`:
- Claude MUST create a PR on GitHub before marking the task complete
- If a `title` is provided, it will be used as the PR title
- If `labels` are provided, they will be added to the PR
- The PR will be created from the feature branch to the original branch
- The PR status will be included in the task state file

#### `title` (string, optional)

Specifies the PR title to use when `createPr: true`. If not provided, a title will be auto-generated from the task:

```yaml
---
createPr: true
title: "Add JWT authentication to API"
---
```

#### `labels` (array of strings, optional)

GitHub labels to add to the PR when `createPr: true`:

```yaml
---
createPr: true
labels:
  - feature
  - backend
  - auth
  - high-priority
---
```

See `.claudefather/tasks/README.md` for task writing guidelines (created automatically when you run `pnpm claudefather create`).

## How It Works

### Architecture

```
┌─────────────────────────────────┐
│  Task Queue                     │
│  (.claudefather/tasks/*.md)     │
└────────────┬────────────────────┘
             │
┌────────────▼────────────────────┐
│  Supervisor (Claudefather)      │
│  - Loads tasks                  │
│  - Creates git worktrees        │
│  - Builds prompts               │
│  - Manages parallel execution   │
│  - Manages retries              │
│  - Validates outputs            │
│  - Syncs files from worktrees   │
└────────────┬────────────────────┘
             │
     ┌───────┴────────┐
     │                │
┌────▼─────┐    ┌────▼─────┐
│ Worktree │    │ Worktree │  (Multiple parallel worktrees)
│  Task 1  │    │  Task 2  │
└────┬─────┘    └────┬─────┘
     │                │
┌────▼──────────────▼─────┐
│  Claude Agents SDK      │
│  - Makes API calls      │
│  - Executes tasks       │
│  - Runs tests/build     │
│  - Writes state file    │
└────┬────────────────────┘
     │
┌────▼──────────────────────────┐
│  File Sync & State            │
│  - Sync from worktree         │
│  - Main project               │
│  (.claudefather/)             │
│  - state/{id}.json            │
│  - logs/{id}.log              │
│  - tasks/{id}.md (if created) │
└───────────────────────────────┘
```

### Execution Flow

1. **Load Tasks**: Reads markdown files from `.claudefather/tasks/` directory (sorted numerically)
2. **Create Worktree**: Creates isolated git worktree for task with feature branch
3. **Check State**: Loads any previous state for the task
4. **Build Prompt**: Creates prompt with system instructions + task + retry feedback
5. **Spawn Claude**: Uses Claude Agents SDK to execute task in worktree (1-hour timeout)
6. **Read State**: Reads state file Claude wrote at `.claudefather/state/{task-id}.json` in worktree
7. **Validate**: Checks if outputs look real (pattern matching for hallucinations)
8. **Sync Files**: Copies task files, state, and logs from worktree back to main project
9. **Clean Worktree**: Removes git worktree after files are synced
10. **Handle Result**:
    - ✅ Valid → Mark complete, move to next task
    - ❌ Invalid → Retry with feedback (max 3 attempts)
    - ⚠️ Blocker → Stop for human review

**Parallel Execution**: Multiple tasks run concurrently in separate worktrees (configurable via `--parallel` flag)

### State File Format

Claude writes `.claudefather/state/{task-id}.json`:

```json
{
  "taskId": "001-auth",
  "status": "VERIFIED_COMPLETE",
  "branch": "feature/auth",
  "commitSha": "abc123...",
  "verification": {
    "tests": {
      "exitCode": 0,
      "output": "PASS  tests/auth.test.ts\n✓ 42 tests passing",
      "summary": "42 tests passing"
    },
    "build": {
      "exitCode": 0,
      "output": "Build completed in 12.3s",
      "summary": "Build successful"
    },
    "lint": {
      "exitCode": 0,
      "output": "No errors",
      "summary": "Lint clean"
    }
  },
  "gitStatus": {
    "branch": "feature/auth",
    "uncommittedChanges": false,
    "lastCommitMessage": "Implement JWT auth",
    "lastCommitSha": "abc123def456..."
  },
  "attemptNumber": 1,
  "startedAt": "2025-10-17T10:00:00Z",
  "completedAt": "2025-10-17T10:45:00Z",
  "filesChanged": ["src/auth.ts", "tests/auth.test.ts"],
  "summary": "Implemented JWT authentication"
}
```

## Status Values

### Completion

- **VERIFIED_COMPLETE** - All checks passed, task done ✅
- **TASK_COMPLETE** - Work done, awaiting supervisor validation

### Blockers (Need Human Review)

- **HUMAN_REVIEW_REQUIRED** - Design decision or clarification needed
- **TESTS_FAILING_STUCK** - Tests failing, exhausted debugging
- **BUILD_FAILING_STUCK** - Build failing, can't resolve
- **LINT_ERRORS_STUCK** - Lint errors need architectural changes
- **MISSING_INFORMATION** - Can't proceed without context
- **EXTERNAL_DEPENDENCY_BLOCKED** - DB/API unavailable
- **MERGE_CONFLICT_DETECTED** - Git conflicts need resolution

## CLI Commands

### start

Run Claudefather and process all tasks:

```bash
# Run tasks in the current project (5 parallel workers by default)
pnpm claudefather start

# Run tasks in a different project directory
pnpm claudefather start --project-dir /path/to/project

# Run with custom parallel worker count
pnpm claudefather start --parallel 10
pnpm claudefather start --project-dir /path/to/project --parallel 3
```

#### Project Directory

The `--project-dir` flag allows you to specify a different project for Claudefather to operate in. When not specified, Claudefather uses the current directory.

Claudefather always uses a consistent directory structure:

- **Tasks**: Always stored in `.claudefather/tasks/`
- **Templates**: Always stored in `.claudefather/templates/`
- **Logs and State**: Always in `.claudefather/logs/` and `.claudefather/state/`

This ensures consistent and predictable task management across different projects.

#### Parallel Execution with Worktrees

Claudefather uses **git worktrees** to run multiple tasks in parallel. Each task gets its own isolated worktree with a dedicated feature branch, allowing true concurrent execution without conflicts.

**How it works:**
- Default: 5 parallel tasks (configurable with `--parallel`)
- Each task runs in `.claudefather/worktrees/{task-id}/`
- After completion, files are synced back to the main project
- Worktrees are automatically cleaned up
- Safe for monorepos and large projects

**Benefits:**
- Tasks don't interfere with each other
- Faster total execution time
- Cleaner git workflow (each task has its own branch)
- Files automatically synchronized back to main project

### status

Show current progress:

```bash
pnpm claudefather status

# Output:
# ✅ Completed: 2
#    001-auth (attempt 1)
#    002-api (attempt 2)
#
# 🔄 In Progress: 1
#    003-tests (attempt 1)
#
# ⚠️  Blocked: 1
#    004-cache: HUMAN_REVIEW_REQUIRED
#
# ⏳ Pending: 1
#    005-docs
```

### create

Create a new task:

```bash
pnpm claudefather create "Implement user authentication"

# Creates: .claudefather/tasks/001-implement-user-authentication.md
```

### reset

Reset a task to pending state:

```bash
# Reset one task
pnpm claudefather reset 001-auth

# Reset all tasks
pnpm claudefather reset --all
```

## Output Validation

The supervisor validates outputs to detect hallucinations:

### Test Output

Checks for:
- Real test framework markers (✓, FAIL, PASS)
- Test file paths (tests/*.test.ts)
- Test counts and timing
- Exit code consistency

### Build Output

Checks for:
- Build tool names (webpack, vite, tsc, turbo)
- Output directory paths (dist/, build/)
- Build timing
- Exit code consistency

### Lint Output

Checks for:
- Error/warning markers
- Lint tool output (eslint, prettier)
- Exit code consistency

### Git Status

Checks for:
- Valid commit SHA format
- Consistent branch names
- No uncommitted changes when complete

## Retry Logic

When validation fails:

1. **First attempt fails**: Supervisor adds validation feedback
2. **Prompt rebuilt**: New prompt includes issues found + previous state
3. **Claude retries**: Works on task again with context
4. **Validation re-runs**: Checks if issues are resolved
5. **Max 3 attempts**: If still failing after 3 attempts, mark for review

Example feedback:

```
[FEEDBACK FROM PREVIOUS ATTEMPT]
Attempt: 1

Issues found:
1. [suspicious_content] Test output doesn't look like real output
2. [exit_code_mismatch] Lint exit code is 1 but tests claim success

Please address these issues and try again.
```

## Files and Directories

```
├── src/                      # Source code (TypeScript)
│   ├── index.ts              # CLI entry point
│   ├── supervisor.ts         # Main orchestration
│   ├── task-loader.ts        # Load tasks from markdown
│   ├── state-manager.ts      # Persist state to JSON
│   ├── claude-runner.ts      # Execute Claude via Agents SDK
│   ├── prompt-builder.ts     # Build prompts with context
│   ├── validators.ts         # Validate outputs
│   ├── config-loader.ts      # Load configuration
│   ├── worktree-manager.ts   # Manage git worktrees
│   ├── concurrency-manager.ts# Handle parallel execution
│   ├── schemas.ts            # Zod schemas
│   └── types.ts              # TypeScript types
├── .claudefather/            # Working directory (gitignored)
│   ├── tasks/                # Task markdown files
│   ├── templates/            # System prompt templates
│   ├── state/                # Per-task state JSON files
│   ├── logs/                 # Full session logs
│   ├── worktrees/            # Git worktrees for parallel execution
│   ├── .claudefatherrc       # Configuration file (JSON)
│   └── .env                  # Environment variables
├── package.json
├── tsconfig.json
├── CLAUDE.md                 # Project instructions for Claude
└── README.md
```

**Note**: When using `--project-dir`, the `.claudefather/` directory is created in the specified project directory. Worktrees are created in `.claudefather/worktrees/{task-id}/` but are automatically cleaned up after task completion.

### Configuration Files

#### `.claudefatherrc`

Located at `.claudefather/.claudefatherrc`, this is a JSON configuration file that controls Claudefather's behavior:

```json
{
  "branchPrefix": "feature"
}
```

**Configuration Options:**

- **branchPrefix** (string, default: `"feature"`) - The prefix used for feature branches created during task execution. For example, with `"feature"` prefix, task `001-auth` will create a branch named `feature/001-auth`.

#### `.env`

Located at `.claudefather/.env`, this is an environment variable file that gets loaded when Claudefather starts. Use it to set environment variables needed by your project or tasks:

```bash
# Example .claudefather/.env
DATABASE_URL=postgresql://localhost/mydb
API_KEY=secret-key-123
NODE_ENV=development
CUSTOM_VAR=value
```

**Use Cases:**

- Set environment variables for tests or build processes
- Configure API endpoints or credentials
- Override default behavior for specific projects
- Set project-specific build flags or options

The `.env` file is loaded using the `dotenv` package, so any variables defined here will be available to:
- Claude when executing tasks
- Test runners and build tools spawned by Claude
- Any scripts that source the environment

**Important**: Don't commit sensitive credentials to version control. Use `.env` for project-specific settings and keep credentials in your local environment or CI/CD secrets.

## Key Technologies

Claudefather is built with:

- **[@anthropic-ai/claude-agent-sdk](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)** - Official SDK for programmatic Claude execution via API
- **TypeScript** - Full type safety with strict mode enabled
- **Zod** - Runtime schema validation for state files
- **Commander** - CLI argument parsing and command structure
- **Execa** - Enhanced child process execution
- **Chalk** - Terminal output formatting and colors

## Authentication & Settings

Claudefather leverages the Claude Agents SDK's flexible authentication system:

### How Authentication Works

The SDK checks for credentials in this order:

1. **User Settings** - `~/.claude/settings.json` (created by `claude login`)
2. **Local Settings** - `.claude/settings.local.json` (project-specific overrides)
3. **Project Settings** - `.claude/settings.json` (checked into version control)
4. **Environment Variable** - `ANTHROPIC_API_KEY` (fallback)

This is configured via:
```typescript
settingSources: ['user', 'local', 'project']
```

### Recommended Setup

**For Development:**
- Use `claude login` to authenticate once
- Credentials are stored in `~/.claude/settings.json`
- Works automatically for all Claudefather projects

**For CI/CD:**
- Set `ANTHROPIC_API_KEY` environment variable in your CI system
- Don't commit credentials to version control
- Consider using secret management tools

**For Teams:**
- Each developer runs `claude login` individually
- API keys are never committed to the repository
- Consistent experience across team members

## Logging and Debugging

### Full Logs

Each task execution is logged to `.claudefather/logs/{task-id}.log`:

```bash
cat .claudefather/logs/001-auth.log
```

### State Files

Task state is saved to `.claudefather/state/{task-id}.json`:

```bash
cat .claudefather/state/001-auth.json | jq .
```

### Status Summary

Quick overview of all tasks:

```bash
pnpm claudefather status
```

## Best Practices

### Task Writing

1. **Be Specific**: Clear requirements → better implementations
2. **Include Examples**: Show what good looks like
3. **Test Guidance**: Mention what tests should cover
4. **Reference Code**: Link to similar patterns in repo
5. **Acceptance Criteria**: Define what "done" means

### Running Claudefather

1. **Check Status First**: `pnpm claudefather status`
2. **Monitor Logs**: `tail -f .claudefather/logs/*.log`
3. **Handle Blockers**: Review blocked tasks and provide input
4. **Retry if Needed**: `pnpm claudefather reset <task-id>`

### Handling Blockers

When a task is blocked:

1. Review the blocked task: `cat .claudefather/state/{task-id}.json`
2. Check the log: `cat .claudefather/logs/{task-id}.log`
3. Provide feedback or fix the blocker
4. Reset and retry: `pnpm claudefather reset {task-id}`
5. Resume: `pnpm claudefather start`

## Troubleshooting

### Authentication Issues

Claudefather supports two authentication methods:

**If using Claude Code CLI authentication:**
- Verify you're logged in: `claude --version` (should not prompt for login)
- Check credentials file exists: `cat ~/.claude/settings.json`
- Re-authenticate if needed: `claude login`

**If using direct API key:**
- Verify environment variable is set: `echo $ANTHROPIC_API_KEY`
- Add to shell profile for persistence (`~/.zshrc` or `~/.bashrc`):
  ```bash
  export ANTHROPIC_API_KEY="your-api-key-here"
  ```

**How Claudefather finds credentials:**

Claudefather uses the Claude Agents SDK with `settingSources: ['user', 'local', 'project']`, which checks:
1. `~/.claude/settings.json` (user-level, set by `claude login`)
2. `.claude/settings.local.json` (local overrides)
3. `.claude/settings.json` (project-level)
4. `ANTHROPIC_API_KEY` environment variable (if the above don't contain credentials)

### State file validation errors

Check `.claudefather/logs/{task-id}.log` for the full execution output.

### Output looks like hallucination

The supervisor detected suspicious output (e.g., "All tests passed" without real test output). Claude needs to include actual command outputs.

### Task keeps failing

Review the feedback in the retry context. The supervisor will retry up to 3 times with feedback.

## Future Enhancements

- [ ] Task parallelization (run N tasks concurrently)
- [ ] GitHub Issues integration (pull tasks from issues)
- [ ] Slack notifications (notify on completion/blockers)
- [ ] Metrics dashboard (track time, success rate, etc.)
- [ ] Custom validators (project-specific output validation)
- [ ] Interactive mode (pause/resume with human input)

## Extending Claudefather

To extend or customize Claudefather:

1. **Add validators**: `src/validators.ts` for custom output validation
2. **Add commands**: `src/index.ts` for new CLI commands
3. **Customize prompts**: `.claudefather/templates/system-prompt.md` for system instructions
4. **Extend state**: `src/types.ts` and `src/schemas.ts` for new state fields

## License

MIT License - see LICENSE file for details.

## Support

For issues or questions:

1. Check logs: `.claudefather/logs/`
2. Review state: `.claudefather/state/`
3. See troubleshooting section above
4. Check task format guidelines: `.claudefather/tasks/README.md`

Happy automating! 🚀
