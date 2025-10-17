# Claudefather

A lightweight CLI tool that orchestrates Claude Code sessions to autonomously complete tasks from markdown files. Claudefather manages task queues, validates outputs, and handles retries with intelligent feedback.

## Features

✅ **Autonomous Task Execution** - Claude Code works independently on tasks without interruption
✅ **Output Validation** - Detects hallucinations by validating test/build/lint outputs
✅ **Intelligent Retries** - Retries with feedback when validation fails (max 3 attempts)
✅ **State Persistence** - Tracks progress across restarts
✅ **Blocker Detection** - Stops at human intervention points
✅ **Full Logging** - Captures all activity for debugging

## Quick Start

### Usage

```bash
# Run Claudefather in current directory
pnpm claudefather <command>

# Run Claudefather in a specific project directory
pnpm claudefather <command> --project-dir /path/to/project
```

#### Project Directory Option

The `--project-dir` flag allows you to specify a different project directory for Claudefather to operate in. When not specified, Claudefather uses the current directory. This is useful for:

- Running tasks in a different project
- Supporting multi-project workflows
- Isolating task execution environments

### Building

```bash
# Build TypeScript
pnpm build
```

### Create Your First Task

```bash
# Create a task
pnpm claudefather create "Implement user authentication"

# This creates: tasks/001-implement-user-authentication.md
# Edit the file with task details
```

### Run Claudefather

```bash
# Start processing tasks
pnpm claudefather start

# Check progress
pnpm claudefather status

# Reset a task to retry
pnpm claudefather reset 001-implement-user-authentication
```

## Task Format

Tasks are markdown files in the `tasks/` directory:

```markdown
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

See `tasks/README.md` for more details.

## How It Works

### Architecture

```
┌─────────────────────┐
│  Task Queue         │  (tasks/*.md)
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│  Supervisor         │
│  - Loads tasks      │
│  - Manages retries  │
│  - Validates output │
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│  Claude Code CLI    │  (autonomous)
│  - Implements task  │
│  - Runs tests/build │
│  - Writes state     │
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│  State & Logs       │  (.claudefather/)
│  - state/{id}.json  │
│  - logs/{id}.log    │
└─────────────────────┘
```

### Execution Flow

1. **Load Tasks**: Reads markdown files from `tasks/` directory (sorted numerically)
2. **Check State**: Loads any previous state for the task
3. **Build Prompt**: Creates prompt with system instructions + task + retry feedback
4. **Spawn Claude**: Runs `claude -p <prompt>` (autonomous, 1-hour timeout)
5. **Read State**: Reads state file Claude wrote
6. **Validate**: Checks if outputs look real (pattern matching for hallucinations)
7. **Handle Result**:
   - ✅ Valid → Mark complete, move to next task
   - ❌ Invalid → Retry with feedback (max 3 attempts)
   - ⚠️ Blocker → Stop for human review

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
# Run tasks in the current project
pnpm claudefather start

# Run tasks in a different project directory
pnpm claudefather start --project-dir /path/to/project
```

#### Project Directory

The `--project-dir` flag allows you to specify a different project for Claudefather to operate in. When not specified, Claudefather uses the current directory.

Claudefather always uses a consistent directory structure:

- **Tasks**: Always stored in `.claudefather/tasks/`
- **Templates**: Always stored in `.claudefather/templates/`
- **Logs and State**: Always in `.claudefather/logs/` and `.claudefather/state/`

This ensures consistent and predictable task management across different projects.

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

# Creates: tasks/001-implement-user-authentication.md
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
├── src/
│   ├── index.ts              # CLI entry point
│   ├── supervisor.ts         # Main orchestration
│   ├── task-loader.ts        # Load tasks from markdown
│   ├── state-manager.ts      # Persist state to JSON
│   ├── claude-runner.ts      # Spawn Claude Code CLI
│   ├── prompt-builder.ts     # Build prompts with context
│   ├── validators.ts         # Validate outputs
│   ├── schemas.ts            # Zod schemas
│   └── types.ts              # TypeScript types
├── templates/
│   └── system-prompt.md      # System instructions for Claude
├── tasks/
│   └── README.md             # Task creation guide
├── .claudefather/           # State (gitignored)
│   ├── state/                # Per-task state files
│   └── logs/                 # Full session logs
├── package.json
├── tsconfig.json
└── README.md
```

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
pnpm ai-supervisor status
```

## Best Practices

### Task Writing

1. **Be Specific**: Clear requirements → better implementations
2. **Include Examples**: Show what good looks like
3. **Test Guidance**: Mention what tests should cover
4. **Reference Code**: Link to similar patterns in repo
5. **Acceptance Criteria**: Define what "done" means

### Running Supervisor

1. **Check Status First**: `pnpm ai-supervisor status`
2. **Monitor Logs**: `tail -f .claudefather/logs/*.log`
3. **Handle Blockers**: Review blocked tasks and provide input
4. **Retry if Needed**: `pnpm ai-supervisor reset <task-id>`

### Handling Blockers

When a task is blocked:

1. Review the blocked task: `cat .claudefather/state/{task-id}.json`
2. Check the log: `cat .claudefather/logs/{task-id}.log`
3. Provide feedback or fix the blocker
4. Reset and retry: `pnpm ai-supervisor reset {task-id}`
5. Resume: `pnpm ai-supervisor start`

## Troubleshooting

### Claude Code CLI not found

```bash
# Install Claude Code
pip install claude-code

# Or ensure it's in PATH
which claude
```

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

## Contributing

To extend the supervisor:

1. **Add validators**: `src/validators.ts` for custom output validation
2. **Add commands**: `src/index.ts` for new CLI commands
3. **Customize prompts**: `templates/system-prompt.md` for system instructions
4. **Extend state**: `src/types.ts` and `src/schemas.ts` for new state fields

## License

Part of Document Assistant. See root LICENSE file.

## Support

For issues or questions:

1. Check logs: `.claudefather/logs/`
2. Review state: `.claudefather/state/`
3. See troubleshooting section above
4. Check task format: `tasks/README.md`

Happy automating! 🚀
