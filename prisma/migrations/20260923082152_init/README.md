# Superseded, and kept on purpose

This created the seven-table schema of the interim application. It was
replaced wholesale by `20260929100729_platform_init`, and nothing it built
survives.

It was deleted from this directory once, along with the screens it supported.
That was a mistake, and an instructive one: Prisma records every applied
migration in `_prisma_migrations`, so a folder that disappears from the
directory while its row remains looks like drift. The next `migrate dev`
offered only one remedy — reset the database and lose everything in it.

Migration history is append-only for the same reason the audit log is. A
migration that ran is a fact about the database, and removing the record of it
does not unrun it; it only removes the ability to reason about what happened.

Leave it here.
