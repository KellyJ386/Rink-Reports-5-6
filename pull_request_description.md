# Fix: close unterminated string literals in admin layout and notifications page

This PR closes unterminated JSX string literals that caused ESLint to fail parsing.

Files changed:
- src/app/admin/layout.tsx
- src/app/admin/scheduling/notifications/page.tsx

Both changes are purely syntactic: closing className strings and replacing truncated class tokens with valid Tailwind-like tokens.
