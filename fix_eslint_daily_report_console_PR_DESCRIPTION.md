# Fix ESLint parse error in daily-report-console

This branch removes a stray unclosed <Select> tag in src/app/reports/daily/_components/daily-report-console.tsx which caused ESLint to fail with a parsing error.

Details:
- Commit: fix: remove stray unclosed <Select> in daily-report-console to resolve ESLint parse error
- Branch: fix/eslint-daily-report-console

Please run CI on this branch to verify the lint job passes.
