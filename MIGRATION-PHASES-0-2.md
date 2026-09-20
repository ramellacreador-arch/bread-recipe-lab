# Migration Phases 0-2

This branch prepares an additive, reversible migration. It does not migrate production records.

## Boundaries

- The legacy `workspaces` table is unchanged.
- `drizzle/0001_dizzy_spiral.sql` creates new tables and indexes only.
- There is no backfill SQL.
- The dry-run tool reads exactly one owner-scoped export and writes only its JSON report to standard output.
- Non-gram ingredient quantities remain unverified and have no proposed canonical gram value.
- Approved recipes remain Approved; no recipe is proposed as Mastered.
- Product mappings remain review candidates; no Product is active and no SKU is generated.
- Separate owner-scoped exports are never merged by the dry-run tool.

## Dry run

```powershell
npm run migration:dry-run -- <legacy-export.json> --source-label <source-identity> --source-revision <revision>
```

The report includes:

- source checksum and revision;
- record counts;
- preserved Recipe, ingredient, step and test IDs;
- proposed Recipe, ingredient, step, test and Product-candidate mappings;
- all non-gram ingredient rows;
- formula, target-yield and label-weight comparisons;
- explicit no-write safeguards and warnings.

The source label must describe the export's actual owner context. Do not label an export as the authoritative business workspace until that ownership has been verified.

## Validation

Run `npm test`. The schema test applies the legacy migration, inserts a representative legacy workspace row, applies the additive migration in an in-memory SQLite database, and verifies the legacy row is unchanged.
