/**
 * Task status enum - defines all possible states
 */
export type TaskStatus =
  | 'VERIFIED_COMPLETE'
  | 'TASK_COMPLETE'
  | 'HUMAN_REVIEW_REQUIRED'
  | 'TESTS_FAILING_STUCK'
  | 'BUILD_FAILING_STUCK'
  | 'LINT_ERRORS_STUCK'
  | 'MISSING_INFORMATION'
  | 'EXTERNAL_DEPENDENCY_BLOCKED'
  | 'MERGE_CONFLICT_DETECTED'
  | 'NEEDS_RETRY';

/**
 * Git status information
 */
export interface GitStatus {
  branch: string;
  originalBranch?: string; // Branch that was active before creating feature branch
  uncommittedChanges: boolean;
  lastCommitMessage: string;
  lastCommitSha: string;
}

/**
 * Assumption made by Claude during execution
 */
export interface Assumption {
  description: string;
  reasoning: string;
}

/**
 * Workaround applied by Claude
 */
export interface Workaround {
  issue: string;
  solution: string;
}

/**
 * Validation issue found by supervisor
 */
export interface ValidationIssue {
  type: 'exit_code_mismatch' | 'invalid_format' | 'suspicious_content' | 'git_inconsistency';
  message: string;
}

/**
 * Feedback to provide on retry
 */
export interface RetryFeedback {
  issues: string[];
  instruction: string;
}

/**
 * Main task state - written by Claude, read by supervisor
 */
export interface TaskState {
  taskId: string;
  status: TaskStatus;
  branch?: string;
  commitSha?: string;
  branchPrefix: string; // e.g., "feature", "fix", "docs"

  gitStatus: GitStatus;

  blockerContext?: string;
  assumptions?: Assumption[];
  workarounds?: Workaround[];

  attemptNumber: number;
  startedAt: string; // ISO 8601
  completedAt: string; // ISO 8601

  filesChanged: string[];
  summary: string;

  // Added by supervisor for retries
  feedback?: RetryFeedback;
  validationIssues?: ValidationIssue[];
}

/**
 * Task from markdown file
 */
export interface Task {
  id: string;
  file: string;
  content: string;
  metadata?: Record<string, unknown>;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

/**
 * Status summary for CLI display
 */
export interface StatusSummary {
  completed: TaskState[];
  inProgress: TaskState[];
  needsReview: TaskState[];
  pending: Task[];
  totalTime: number;
}
