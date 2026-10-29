# Local means this device

2026-10-29 12:34 IST. Previous: [Two tiers, no peer sync](2026-10-29-1215-two-tiers-no-peer-sync.md).

I integrated the v0.8 contract in PR149 after all three exact-source gates. The documentation-only main push triggered no new workflow; tested-tree/runtime equality and the passing prior main are recorded separately. I then made the first visible alignment under issue150: Local storage is named as the current tier, its independence is explicit, and the obsolete Device sync row is gone. Cloud is clearly unavailable and explains server-first confirmation with pending offline drafts.

All11 existing browser/local and synthetic native-bridge cases pass on an owned server. A separate fresh two-context browser check preserves a note after reload in one profile while the other stays empty. It sees the revised settings, no peer copy or Cloud activation, no note network write and no page error. I inspected the screenshot and closed both owned browser/server runs. Type/format/build pass; the existing chunk warning remains. Only copy changes, with no schema, stored identifier, Local save logic or Cloud activation. Exact-head hosted review/gates still precede integration.

## Decisions

- I make Local independence clear in the active UI while keeping the unavailable Cloud tier honest.

## Direction changes

None. This implements the already confirmed v0.8 tier contract.

## Needs revisit

- Issue150 closes visible tier-copy alignment only. Real Cloud login/authoritative save/status, full web/live delivery, iPhone and M2.2 managed/teardown/native acceptance remain. Existing stopped probes and expired allowances are unchanged.
