# Share website access within an installation

Use invitation-only email/password accounts with Administrator and Viewer roles. Every active user can read every website; only administrators can manage users, websites and settings. Client labels do not create security boundaries. This keeps the initial internal-use model simple; client-specific permissions require a separate design.

Use Cloudflare Email for invitations and password resets, expiring single-use links, and installer-authorized first-administrator setup. Retain an operator recovery command independent of email. Dashboard sessions may use secure cookies; the visitor tracker must not use persistent browser identifiers.
