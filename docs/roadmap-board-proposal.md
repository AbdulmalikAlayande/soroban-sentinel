# GitHub Projects Board — Roadmap Proposal

## Summary

Create a GitHub Projects (v2) board for `AbdulmalikAlayande/sorokeep` that surfaces
all `phase-*`-labeled issues in a single grouped view, giving contributors and
maintainers an at-a-glance picture of progress across 15 phases (~300 issues).

---

## Prerequisites

- **GitHub account** with `admin` or `write` access to the repository.
- A personal access token (classic) with the `project` scope, **or** a GitHub
  App token with `Projects` permissions.

---

## Step 1 — Create the Project Board

1. Go to https://github.com/AbdulmalikAlayande/sorokeep
2. Click the **Projects** tab (top nav bar).
3. Click **Link a project** → **Create new project**.
4. Select the **Board** template (or start from scratch).
5. **Project name:** `Sorokeep Roadmap`
6. **Project description:**
   > Progress tracking across all 15 implementation phases. Issues are
   > auto-added when labelled with `phase-*`.
7. Click **Create**.

---

## Step 2 — Configure the Board Layout

### 2a — Add the repository

1. In the new project, click the **⋮** menu (top right) → **Settings**.
2. Under **Linked repositories**, click **Link a repository**.
3. Search for and select `AbdulmalikAlayande/sorokeep`.

### 2b — Configure the default view

1. Click back to the project board view.
2. Rename the default view tab to **"By Phase"**.
3. Click the **Group by** dropdown (top right of the board) and select
   **Labels**.
4. In the **Sort** dropdown, select **Label name** → **A → Z** (so phases
   appear in natural order).
5. The board will now show columns for every label that has at least one issue.
   If empty phase columns are desired:
   - Click the **+** button on the column header area.
   - Type the label name (e.g. `phase-1`) and select it to create an empty
     column.

### 2c — Add status tracking

Each card will show the issue status automatically. Ensure the **Status** field
is visible:

1. Click the **Fields** button (top right, near the views tab).
2. Make sure **Status** is enabled. The status values are:
   - `Open` — issue is open, not yet assigned / in progress
   - `In Progress` — assignee is actively working
   - `Closed` — issue is completed and closed
3. Optionally, add a **Labels** field as well.

---

## Step 3 — Automation (Auto-Add)

GitHub Projects v2 has built-in automation via **Workflows** (not to be confused
with GitHub Actions).

1. In the project board, click the **⋮** menu (top right) → **Workflows**.
2. Click **Add workflow** → select **"Item added to repo"** template.
3. Configure the trigger:
   - **Event:** `Issues`
   - **Labels:** `phase-1`, `phase-2`, `phase-3`, `phase-4`, `phase-5`,
     `phase-6`, `phase-7`, `phase-8`, `phase-9`, `phase-10`, `phase-11`,
     `phase-12`, `phase-13`, `phase-14`, `phase-15`
   - **Action:** Add the issue to this project.
4. Click **Save**.

> This workflow ensures any issue — new or existing — that gets a `phase-*`
> label will automatically appear on the board.

---

## Step 4 — Backfill Existing Issues

To pull in all existing `phase-*` issues at once:

**Option A — Manual (quick for a one-time sync)**
1. From the project board, click **Add item** → type `#` followed by an issue
   number → select the issue. Repeat for each phase-labeled issue.

**Option B — GraphQL API (bulk)**
```graphql
mutation {
  addProjectV2ItemById(input: {
    projectId: "<PROJECT_ID>"
    contentId: "<ISSUE_NODE_ID>"
  }) { item { id } }
}
```

Fetch all phase-labeled issue IDs with:
```
gh issue list --repo AbdulmalikAlayande/sorokeep \
  --label phase-1,phase-2,...,phase-15 \
  --state all \
  --json id --jq '.[].id'
```

> **Tip:** The workflow in Step 3 will *not* retroactively add existing issues;
> only newly-labelled ones. Use Option A or B for the initial backfill.

---

## Step 5 — Verify

1. Confirm the board displays issues grouped by `phase-1` through `phase-15`.
2. For each phase column, verify that open and closed counts match the
   repository's issue list for that label.
3. Create a test issue with a `phase-1` label (can be immediately closed):
   - The issue should appear on the board within ~30 seconds.
   - Remove or close the test issue afterward.

---

## Maintenance Notes

- **New phases:** If `phase-16` is ever added, update the workflow trigger in
  Step 3 to include the new label.
- **View duplication:** Interested contributors can create additional views
  (e.g. "By Assignee" or "My Tasks") without affecting the main layout.
- **Access control:** Any user with `read` access to the repo can view the
  board. `write` access is required to modify cards.