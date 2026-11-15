export const GIT_BRANCH_NAME_MAX_LENGTH = 200;

export type GitBranchNameValidation = "required" | "tooLong" | "invalid" | null;

function hasInvalidBranchNameCharacter(branch: string): boolean {
  for (const character of branch) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      /\s/u.test(character) ||
      codePoint < 0x20 ||
      (codePoint >= 0x7f && codePoint <= 0x9f)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * 与 App Server 的 create-branch 校验保持同一组显式规则：
 * trim、非空、最多 200 个字符，拒绝空白/控制字符、`..` 和 `-` 开头。
 */
export function validateGitBranchName(value: string): GitBranchNameValidation {
  const branch = value.trim();
  if (!branch) return "required";
  if ([...branch].length > GIT_BRANCH_NAME_MAX_LENGTH) return "tooLong";
  if (
    branch.startsWith("-") ||
    branch.includes("..") ||
    hasInvalidBranchNameCharacter(branch)
  ) {
    return "invalid";
  }
  return null;
}
