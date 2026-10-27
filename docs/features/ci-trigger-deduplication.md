# One CI trigger per proposed update

## Scope and plan

Keep SPEC's implementation validation while avoiding duplicate hosted compute for one proposed change. The old `feat/**` push trigger and `pull_request` trigger can start two complete suites for the same branch update. This PR only routes proposed changes through PR events and integration checks through main pushes.

Limit push branches to main while retaining its existing path filter. Keep PR events, both jobs, every validation command and cancellation behavior unchanged. PRs work with any feature branch name. The main run after merging remains an independent integration check.

Verify YAML syntax and trigger semantics locally, then use hosted CI. This PR is stacked after the separate dependency-policy and temporary-directory fixes. Native build caching and selecting checks by changed paths remain separate work.

## Evidence

Parsed old/new YAML and compared the complete workflow structures after applying only the expected branch-list change: main pushes and PR events remain, and all jobs, commands and permissions are unchanged. Hosted PR verification remains pending. The only workflow change removes feature-branch pushes; PR and main integration coverage remains intact.
