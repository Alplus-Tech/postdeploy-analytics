# PostDeploy Analytics

Analytics for an owner's websites, with access shared across an installation.

## Language

**Installation**: One independently operated copy of the product. Its users share access to every website it contains.
_Avoid_: Tenant, client account

**Organisation**: A named group containing multiple projects, with an overview of their combined traffic. Organisation grouping does not change installation-wide user access.
_Avoid_: Tenant, client account

**Project**: One tracked reporting destination within an organisation, with its own traffic, goals and explicitly allowed domains. A website and its domain aliases belong to one project.
_Avoid_: Property

**Website**: The web destination tracked by a project. Existing website identifiers continue to identify the same reporting destination.

**Administrator**: A user who can manage users, websites and settings, and inspect and export analytics.

**Viewer**: A user who can inspect and export analytics for every website but cannot change the installation.

**Daily unique visitor**: An estimated visitor counted once per website's local day. Longer ranges count daily uniques, not distinct people across days.

**Project visitor-days**: The sum of each project’s daily visitor identities observed within a reporting window. A person can count in multiple projects and on multiple days.

**Visit**: A sequence of activity ending after 30 minutes without activity or at the website's local midnight.
_Avoid_: Visitor-day

**Bounce**: A visit with one pageview and no completed conversion goal.

**Measured visit**: A visit with an accepted visible-page activity observation. Visits without observations have unknown visible duration.

**Visit duration**: Estimated visible-page time during a visit. Hidden-tab time is excluded; single-page visits can have measured duration.

**Goal**: A website-defined conversion triggered by a page visit or named event.

**Goal completion rate**: The share of visitor-days in a selected event population that completed a goal. Repeat completions on the same day count once in the numerator. An overall rate counts each converted visitor-day once across goals.
_Avoid_: Completions divided by people

**Canonical hostname**: The primary hostname of a project’s website.

**Domain alias**: An explicitly allowed additional hostname belonging to the same project.

**Excluded path prefix**: A path and its descendants whose future collection requests are ignored for privacy.

**Goal rule**: A project's fixed condition for completing a goal: one exact normalised page path or one explicit named action. Labels may change; archiving stops future completions while keeping history.

**Goal completion**: One accepted occurrence matching an active goal rule. Repeated occurrences remain separate completions.

**Assignment eligibility**: A visit's ability to accept further activity before its inactivity timeout, local midnight or a website timezone change. Ending eligibility does not remove the visit's analytics history.
