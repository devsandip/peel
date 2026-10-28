# GitHub Project tracking

## Purpose and plan before changes

Sandip asked for GitHub Projects visibility on 28 October. Existing tracking uses repository Issues and Milestones; no Project is linked to the clean public devsandip/peel repository. Add one linked Peel Project and backfill existing public-repository work so it is visible in one place. This changes delivery tracking, not product behavior or v0.7 acceptance.

Use Backlog, Ready, In progress, Blocked and Done statuses. Issues remain the deliverables and milestone-progress source; PRs are linked implementation/review work and must not double-count completed scope. Reflect existing issue labels/open-closed state and PR open/merged-closed state. Keep the current milestone prominent and later phases unexpanded. Include existing concrete backlog bugs and previously merged work for context, with no draft feature claims.

Inspect for an existing linked/account Peel Project before creating a duplicate. Add only existing items from devsandip/peel; do not import private archive history/items or expand speculative phases. Use supported GitHub CLI/API capabilities for fields/items, and the normal GitHub UI if a board layout requires it. Verify project linkage, statuses and item counts after backfill. Record the permanent URL and ongoing upkeep in AGENTS.md and WORKLOG, through a separate single-purpose PR with the relevant gates. The separate Cognito-domain plan stays on its own branch.

## Evidence

[Issue 73](https://github.com/devsandip/peel/issues/73) tracks this delivery. Created private account Project 12, linked to the public repository, with all 38 existing issues and 35 PRs (73 unique items) backfilled. API verification matches every expected item/status and the four saved views: Current milestone (board, deliverable issues filtered to M2.2), Issues, Pull requests and Backlog. No unrelated/private archive items were added. Future issue/PR additions must also be added and status-verified before session end.

The saved layout/filter and status data are API-verified. Chrome browser control timed out and then reported that its debugger was unattached, so the visual column-rendering check is unavailable; it is not claimed as passing. No Chrome permission, security or unrelated user-tab setting was changed. The project data and links remain usable independently of browser automation.
