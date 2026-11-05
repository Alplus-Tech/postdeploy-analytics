# Explicit installation targets and offline recovery

Status: implemented locally; remote account acceptance pending.

Keep the source Wrangler configuration as a template. Generate a private ignored
configuration per named installation, pinning account, origin, sender and DB.
Plan has no remote effects. Provision lists before creation and refuses ambiguous
adoption; an explicit verified ID resumes interrupted creation. Remote execution
requires the installation name; changing a Worker also requires explicit ownership
confirmation. Secrets use random generation, private files and subprocess stdin.
No CLI command drops resources or automatically restores a failed deployment.

Reuse Wrangler migrations/deployment and the existing exact compact exporter,
conversion and headroom tools. Do not introduce a registry, hosted control plane,
mandatory new service or online replication claim. Fresh installs begin with the
legacy schema and are recommended to convert while empty before collection.
Populated storage conversion remains an explicit stopped-writer operation.

Backup/restore verification compares physical schema, rowids and values plus
integrity/foreign keys. Operator acceptance also compares known reports and
credentials through the real Worker. Restore into a replacement DB, preserve the
current source and every newer accepted write, and switch bindings only after
verification under maintenance. App rollback must understand the current schema;
a stale backup never silently replaces current analytics. See operations.md.
