# PR Merge Status & Instructions

## ✅ Successfully Merged (13 PRs)
These PRs have been successfully merged into main:
- #378, #379, #381, #382, #383, #384, #385, #387, #389, #399, #402, #405, #406

## ⏳ Remaining PRs with Merge Conflicts (16 PRs)

### PR List:
1. **#380** - feat: implement DAO Treasury system (Owner: Chidubemkingsley, Branch: impl/autono-org-multisig)
2. **#386** - Develop Lottery Contract (Owner: Jeyvers, Branch: feat/lottery-system)
3. **#388** - Create Decentralized Freelancer Escrow (Owner: ?, Branch: feat/escrow-tracking)
4. **#390** - add decentralized bug bounty contract (Owner: ?, Branch: feat/bug-bounty-contract-305)
5. **#391** - Feat/nft amm dynamic pricing 327 (Owner: ?, Branch: feat/nft-amm-dynamic-pricing-327)
6. **#392** - Build Decentralized Social Media Contract (Owner: ?, Branch: feat/social-media-content-monetization)
7. **#393** - implement decentralized file notary contract (Owner: ?, Branch: feat/file-notary-contract)
8. **#394** - implement decentralized sports prediction market (Owner: ?, Branch: feature/issue-343-sports-prediction)
9. **#395** - implement algorithmic stablecoin (Owner: ?, Branch: main)
10. **#396** - add decentralized loyalty rewards program (Owner: ?, Branch: feat/loyalty-rewards-program)
11. **#397** - Add patent registry marketplace demo (Owner: ?, Branch: kensamuel)
12. **#398** - Updated my task (Owner: ?, Branch: soro-task)
13. **#400** - implement yield optimizer (Owner: kenesamuel2, Branch: kenesamuel2)
14. **#403** - Decentralized Cloud Storage #290 (Owner: ?, Branch: main)
15. **#404** - Decentralized Cloud Storage #310 (Owner: ?, Branch: feat/decentralized-cloud-storage-310)
16. **#407** - build subscription management system (Owner: ?, Branch: feat/subscription-management-system)
17. **#408** - Feat/carbon credits trading 298 (Owner: ?, Branch: feat/carbon-credits-trading-298)

## 🔧 Manual Merge Instructions

For each PR, run these commands:

```bash
# 1. Fetch the PR branch
git remote add <OWNER> https://github.com/<OWNER>/soroban-playground.git
git fetch <OWNER> <BRANCH_NAME>

# 2. Checkout the PR branch
git checkout -b merge-pr-<NUMBER> <OWNER>/<BRANCH_NAME>

# 3. Merge main
git merge origin/main

# 4. If conflicts occur, resolve them:
#    Option A: Accept main's version (theirs)
git checkout --theirs <conflicted_file>
git add <conflicted_file>

#    Option B: Accept PR's version (ours)  
git checkout --ours <conflicted_file>
git add <conflicted_file>

#    Option C: Manually edit the file to combine both versions

# 5. Commit the merge
git commit --no-verify -m "Merge PR #<NUMBER>: Resolve conflicts"

# 6. Push back to the PR
git push <OWNER> merge-pr-<NUMBER>:<BRANCH_NAME> --force

# 7. Merge the PR
gh pr merge <NUMBER> --squash --delete-branch

# 8. Return to main
git checkout main
git pull origin main
```

## ⚡ Quick Merge Alternative

If you want to force merge without resolving conflicts locally:

```bash
# For each PR number
gh pr checkout <NUMBER>
git merge -s ours origin/main --no-edit
git push
gh pr merge <NUMBER> --squash --delete-branch
```

**Warning**: This approach keeps the PR's version of all conflicting files.

## 📝 Notes

- All conflicted PRs have been commented asking authors to resolve conflicts
- Most conflicts are in `backend/package.json`, `backend/src/server.js`, and contract files
- The main branch has received many new features from the successfully merged PRs
- Consider reviewing critical PRs manually before merging

## 🎯 Recommendation

For production code, I recommend:
1. Review each PR individually
2. Test the merged code locally
3. Resolve conflicts carefully to preserve important changes
4. Merge one at a time and test after each merge
