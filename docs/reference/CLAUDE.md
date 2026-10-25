# Reference Docs Guide

Each file in `docs/reference/` documents one dokku-compose feature. These are user-facing references — concise, practical, no internal implementation detail. They are living documents: each one always describes the latest behaviour.

## Structure

Every reference doc should follow this template:

1. **Title** — The module name (e.g., `# Apps`)
2. **Dokku docs link** — Always link to the upstream Dokku documentation for the namespace (e.g., `Dokku docs: https://dokku.com/docs/...`). This is the primary way users find the full Dokku docs for the feature.
3. **Module** — The `src/modules/*.ts` or `src/resources/*.ts` file that implements it
4. **YAML Keys** — One subsection per supported YAML key, each with:
   - Brief description of what it does
   - YAML example showing all valid forms (with inline comments)
   - Table mapping values to Dokku commands
   - Note the behavior when the key is absent (usually "no action")

## Guidelines

- Document the current behaviour only: no planned, proposed or future sections. Within a PR, "current" is what the PR ships. The PR's first commit (the design) edits the doc in place, and the code commits make it true (see "Tracking work" in `docs/dokku-audit.md`).
- Show the YAML the user writes and the Dokku command it produces. That's the core value.
- Use inline comments in YAML examples to explain each variant.
- Keep descriptions to one or two sentences. If it needs more, the YAML example should do the explaining.
- When a key has boolean/tri-state behavior (true/false/absent), always document all three cases.
- When a value maps to multiple Dokku commands, use `<br>` to put each command on its own line in the table.
- Each reference doc covers one feature. Don't split or combine.

## Naming

Files are named after their module: `apps.md`, `domains.md`, `config.md`, etc.
