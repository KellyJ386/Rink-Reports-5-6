// DELETED: This helper was migrated to src/lib/auth/safe-redirect.ts
//
// Reason: Redirect validation was centralized in a shared utility to avoid
// duplication and harden behavior across login and callback flows. The legacy
// implementation that lived here (isSafeRedirectPath) has been removed and its
// behavior is now provided by `src/lib/auth/safe-redirect.ts`.
//
// Notes for reviewers:
// - Keep this file only as a history marker for the refactor. It intentionally
//   contains no implementation to avoid any accidental usage.
// - If you prefer to fully delete this file, run:
//     git rm "src/app/(auth)/login/redirect-safe.ts"
//     git commit -m "chore(auth): remove legacy redirect-safe helper"
//     git push origin codex/conduct-security-review-of-rink-reports-uppq0k
//
// Reference: src/lib/auth/safe-redirect.ts
