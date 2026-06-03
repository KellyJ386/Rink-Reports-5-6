# Manual rollback scripts

Down/rollback counterparts for forward migrations in `../migrations/`.

These live **outside** `supabase/migrations/` on purpose:

- `supabase/migrations/` is a flat, monotonic, **forward-only** set — one
  `.sql` file per 14-digit prefix (see `CLAUDE.md` and the
  `migration-prefix-check` workflow). A `.down.sql` sharing a prefix there
  collides with that rule **and** would be picked up and applied by the
  Supabase CLI as if it were a forward migration.
- Rollbacks are run **manually** by an operator when reverting a specific
  migration, e.g.:

  ```bash
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -f supabase/rollbacks/00000000000108_create_employee_complete_job_areas.down.sql
  ```

Each file is named `<prefix>_<name>.down.sql` to match the forward migration it
reverses. Apply them in **descending** prefix order when undoing a range.
