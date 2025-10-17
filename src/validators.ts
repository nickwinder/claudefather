import { Verification, GitStatus, ValidationResult, ValidationIssue } from './types.js';

/**
 * Validates outputs to detect hallucinations and inconsistencies
 */
export class OutputValidator {
  /**
   * Validate all outputs together
   */
  static validate(verification: Verification, gitStatus: GitStatus): ValidationResult {
    const issues: ValidationIssue[] = [];

    // Validate each command output
    issues.push(...this.validateTestOutput(verification.tests));
    issues.push(...this.validateBuildOutput(verification.build));
    issues.push(...this.validateLintOutput(verification.lint));
    issues.push(...this.validateGitStatus(gitStatus));

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  /**
   * Validate test output
   */
  static validateTestOutput(tests: { exitCode: number; output: string }): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Check exit code consistency
    if (tests.exitCode === 0 && !this.looksLikeSuccessfulTestOutput(tests.output)) {
      issues.push({
        type: 'suspicious_content',
        message:
          'Test exit code is 0 (success) but output does not look like real test output - possible hallucination',
      });
    }

    if (tests.exitCode !== 0 && !this.looksLikeTestFailure(tests.output)) {
      issues.push({
        type: 'suspicious_content',
        message:
          'Test exit code is non-zero (failure) but output does not look like real test failure',
      });
    }

    // Check if output is empty when it shouldn't be
    if (tests.output.trim().length === 0 && tests.exitCode === 0) {
      issues.push({
        type: 'invalid_format',
        message: 'Test output is empty but exit code is 0 - incomplete capture',
      });
    }

    return issues;
  }

  /**
   * Validate build output
   */
  static validateBuildOutput(build: { exitCode: number; output: string }): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    if (build.exitCode === 0 && !this.looksLikeRealBuildOutput(build.output)) {
      issues.push({
        type: 'suspicious_content',
        message: 'Build exit code is 0 (success) but output does not look like real build output',
      });
    }

    if (build.exitCode !== 0 && !this.looksLikeBuildFailure(build.output)) {
      issues.push({
        type: 'suspicious_content',
        message: 'Build exit code is non-zero (failure) but output does not look like real build failure',
      });
    }

    if (build.output.trim().length === 0 && build.exitCode === 0) {
      issues.push({
        type: 'invalid_format',
        message: 'Build output is empty but exit code is 0',
      });
    }

    return issues;
  }

  /**
   * Validate lint output
   */
  static validateLintOutput(lint: { exitCode: number; output: string }): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    if (lint.exitCode === 0 && !this.looksLikeLintSuccess(lint.output)) {
      issues.push({
        type: 'suspicious_content',
        message: 'Lint exit code is 0 (success) but output does not look like successful lint',
      });
    }

    if (lint.exitCode !== 0 && !this.looksLikeLintFailure(lint.output)) {
      issues.push({
        type: 'suspicious_content',
        message: 'Lint exit code is non-zero (failure) but output does not look like real lint failure',
      });
    }

    return issues;
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

  private static looksLikeSuccessfulTestOutput(output: string): boolean {
    // Should contain markers of successful test execution
    const patterns = [
      /PASS|✓/,                    // Pass markers
      /Test Suites?:.*passed/i,    // Jest/Vitest summary
      /Tests?:.*\d+.*passed/i,     // Test count summary
      /\d+\.\d+s/,                 // Timing (seconds)
      /tests\//,                   // Test file paths
    ];

    const matches = patterns.filter((p) => p.test(output)).length;
    // Should match at least 3 patterns to consider it real
    return matches >= 3;
  }

  private static looksLikeTestFailure(output: string): boolean {
    const patterns = [
      /FAIL|✗|×/,                  // Failure markers
      /Tests?:.*\d+.*fail/i,       // Failed test count
      /Error:|Expected|Received/i, // Error messages
    ];

    const matches = patterns.filter((p) => p.test(output)).length;
    return matches >= 2;
  }

  private static looksLikeRealBuildOutput(output: string): boolean {
    const patterns = [
      /Built? in \d+\.?\d*s/i,     // Build timing
      /Compiled|Successfully/i,    // Build success
      /webpack|vite|tsc|turbo/i,   // Build tools
      /✓.*built/i,                 // Build completion
      /dist\/|build\//,            // Output directories
    ];

    const matches = patterns.filter((p) => p.test(output)).length;
    return matches >= 2;
  }

  private static looksLikeBuildFailure(output: string): boolean {
    const patterns = [
      /error|failed|unable/i,
      /TypeError|SyntaxError/i,
      /Cannot find|no such file/i,
      /exit code.*[1-9]/i,
    ];

    const matches = patterns.filter((p) => p.test(output)).length;
    return matches >= 1;
  }

  private static looksLikeLintSuccess(output: string): boolean {
    const patterns = [
      /no (?:linting |)errors?/i,
      /✓|pass/i,
      /^$/m, // Empty output is also valid for lint
    ];

    return patterns.some((p) => p.test(output));
  }

  private static looksLikeLintFailure(output: string): boolean {
    const patterns = [
      /error\s*:/i,
      /\d+\s+errors?/i,
      /warnings?:/i,
      /eslint|prettier/i,
    ];

    return patterns.some((p) => p.test(output));
  }

  private static looksLikeCommitSha(sha: string): boolean {
    // Git commit SHAs are 40 character hex (full) or 7+ chars (abbreviated)
    return /^[0-9a-f]{7,40}$/.test(sha);
  }
}
