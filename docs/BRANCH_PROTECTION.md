# Branch protection & merge policy — `main`

**Goal:** changes reach `main` only through reviewed pull requests; **merge authority
rests with `@thetrademarkk`** (the repo owner). Contributors (e.g. `@raashish1601`)
open PRs but cannot land a change without `@thetrademarkk`'s review.

> **Who can apply this:** only a repo **admin** — i.e. `@thetrademarkk` (the owner).
> On a personal-account repo, collaborators max out at `write`, so `raashish1601`
> cannot set these rules. Apply them while signed in as `thetrademarkk`, or hand a
> fine-grained `thetrademarkk` PAT (Administration: read/write) to apply via API.

## Apply via the GitHub UI (as `thetrademarkk`)

`Settings → Rules → Rulesets → New branch ruleset` (or `Settings → Branches → Add rule`):

- **Target:** `main` (default branch)
- ✅ **Require a pull request before merging**
  - Required approvals: **1**
  - ✅ **Require review from Code Owners** ← with `.github/CODEOWNERS` (= `@thetrademarkk`), this makes `@thetrademarkk`'s approval mandatory on every PR
  - ✅ Dismiss stale approvals on new commits
- ✅ **Require status checks to pass** → add **`verify`** (the CI job)
  - ✅ Require branches to be up to date before merging
- ✅ **Require conversation resolution before merging**
- ✅ **Require linear history**
- ✅ **Block force pushes**
- ✅ **Restrict deletions**
- **Bypass list:** leave empty for contributors. (Keep `@thetrademarkk` able to
  merge — do **not** enable "Do not allow bypassing" / enforce-admins, or the owner
  can't merge its own PRs without a second reviewer.)

Net effect: no direct pushes to `main` by contributors; every PR needs green CI +
`@thetrademarkk`'s code-owner approval; no force-push or deletion of `main`.

## Apply via API (equivalent — needs an admin token)

```bash
# Run with a thetrademarkk admin token: GH_TOKEN=<pat> bash this
gh api --method PUT repos/thetrademarkk/trademarkk/branches/main/protection \
  --input - <<'JSON'
{
  "required_status_checks": { "strict": true, "contexts": ["verify"] },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "require_code_owner_reviews": true,
    "dismiss_stale_reviews": true
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true
}
JSON
```

## The one rule that needs an Organization

A hard *"`thetrademarkk` is the only account that may click **Merge**"* (rather than
"every PR needs `@thetrademarkk`'s approval") requires **push/merge restrictions**,
which GitHub only offers on **organization-owned** repos. To get that: create an org
you own → transfer `trademarkk` into it → add other accounts as `write` members →
add a ruleset restriction allowing merge only for `@thetrademarkk`.
