import { GitStatus, ValidationResult, ValidationIssue } from './types.js';

/**
 * Validates task state to detect inconsistencies
 */
export class OutputValidator {
  /**
   * Validate git status
   */
  static validate(gitStatus: GitStatus): ValidationResult {
    const issues: ValidationIssue[] = [];
    issues.push(...this.validateGitStatus(gitStatus));

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  /**
   * Validate git status information
   */
  static validateGitStatus(git: GitStatus): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Validate commit SHA format
    if (!this.looksLikeCommitSha(git.lastCommitSha)) {
      issues.push({
        type: 'git_inconsistency',
        message: `Commit SHA "${git.lastCommitSha}" does not look like a valid git commit hash`,
      });
    }

    // Check branch name format (basic validation)
    if (!/^[a-zA-Z0-9_\-/.]+$/.test(git.branch)) {
      issues.push({
        type: 'git_inconsistency',
        message: `Branch name "${git.branch}" contains invalid characters`,
      });
    }

    // Check if uncommitted changes claim is consistent
    if (git.uncommittedChanges && git.lastCommitSha) {
      issues.push({
        type: 'git_inconsistency',
        message: 'Uncommitted changes reported but task claims to be complete',
      });
    }

    return issues;
  }

  // ============================================================================
  // Pattern matching helpers
  // ============================================================================

  private static looksLikeCommitSha(sha: string): boolean {
    // Git commit SHAs are 40 character hex (full) or 7+ chars (abbreviated)
    return /^[0-9a-f]{7,40}$/.test(sha);
  }
}
