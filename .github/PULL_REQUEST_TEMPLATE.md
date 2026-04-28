<!--
gh-pms PR template.
The Closes line is REQUIRED — the pre-pr-create hook blocks PR creation without it.
-->

Closes #_

## Summary
(1–3 sentences — what changed and why, not how)

## Quality
- [ ] Tests pass locally
- [ ] No new console.error / println / panic / unwrap added
- [ ] Lint / typecheck / format clean
- [ ] No secrets or credentials committed
- [ ] Backwards compat preserved (or breakage documented)

## Checklist (file paths)
- `path/to/file1.ext` — (what changed)
- `path/to/file2.ext` — (what changed)

## Verification
(how a reviewer can verify this works — commands, URLs, screenshots, test names)

## Risk
(what could break? mitigations? rollback plan if any?)

---
_Managed by gh-pms. Do not remove the Closes line._
