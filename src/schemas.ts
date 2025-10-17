import { z } from 'zod';

/**
 * Schema for validating git status
 */
export const GitStatusSchema = z.object({
  branch: z.string(),
  originalBranch: z.string().optional(),
  uncommittedChanges: z.boolean(),
  lastCommitMessage: z.string(),
  lastCommitSha: z.string(),
});

/**
 * Schema for validating assumptions
 */
export const AssumptionSchema = z.object({
  description: z.string(),
  reasoning: z.string(),
});

/**
 * Schema for validating workarounds
 */
export const WorkaroundSchema = z.object({
  issue: z.string(),
  solution: z.string(),
});

/**
 * Schema for validating task state (written by Claude)
 */
export const TaskStateSchema = z.object({
  taskId: z.string(),
  status: z.enum([
    'VERIFIED_COMPLETE',
    'TASK_COMPLETE',
    'HUMAN_REVIEW_REQUIRED',
    'TESTS_FAILING_STUCK',
    'BUILD_FAILING_STUCK',
    'LINT_ERRORS_STUCK',
    'MISSING_INFORMATION',
    'EXTERNAL_DEPENDENCY_BLOCKED',
    'MERGE_CONFLICT_DETECTED',
    'NEEDS_RETRY',
  ]),
  branch: z.string().optional(),
  commitSha: z.string().optional(),

  gitStatus: GitStatusSchema,

  blockerContext: z.string().optional(),
  assumptions: z.array(AssumptionSchema).optional(),
  workarounds: z.array(WorkaroundSchema).optional(),

  attemptNumber: z.number().int().min(1),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),

  filesChanged: z.array(z.string()),
  summary: z.string(),

  feedback: z
    .object({
      issues: z.array(z.string()),
      instruction: z.string(),
    })
    .optional(),

  validationIssues: z
    .array(
      z.object({
        type: z.enum(['exit_code_mismatch', 'invalid_format', 'suspicious_content', 'git_inconsistency']),
        message: z.string(),
      })
    )
    .optional(),
});
