# Git Workflow Best Practices for Soroban Playground

## 🎯 Problem We're Solving
Multiple merge conflicts occurred because:
- Long-lived feature branches diverged from main
- Multiple contributors modified same files (package.json, routes, etc.)
- Branches weren't updated with latest main before PR submission
- Duplicate features being developed in parallel

## 📋 New Workflow Rules

### 1️⃣ Before Starting Work
```bash
# Always start from updated main
git checkout main
git pull origin main

# Create feature branch from latest main
git checkout -b feat/your-feature-name
```

### 2️⃣ While Working
- **Keep branches short-lived** (max 1-2 weeks)
- **Pull main regularly** (at least every 2-3 days)
- **Communicate early** if working on shared files (package.json, server.js, routes)

### 3️⃣ Before Pushing to Remote
```bash
# Update your branch with latest main
git checkout main
git pull origin main
git checkout your-feature-branch
git merge main

# Resolve conflicts locally BEFORE creating PR
# Test everything still works
npm test
npm run lint
```

### 4️⃣ PR Creation Checklist
- [ ] Branch is based on recent main (< 3 days old)
- [ ] All conflicts resolved locally
- [ ] Tests pass locally
- [ ] No duplicate functionality (check open PRs first!)
- [ ] Small, focused changes (one feature per PR)

### 5️⃣ During PR Review
- **Respond quickly** to review comments
- **Rebase/merge main** if your PR stays open > 3 days
- **Keep PR updated** with latest main branch

---

## 🚀 Recommended: Use Rebase Instead of Merge

For cleaner history, use rebase when updating your branch:

```bash
# Instead of: git merge main
git fetch origin
git rebase origin/main

# If conflicts occur during rebase:
# 1. Fix conflicts
# 2. git add <files>
# 3. git rebase --continue
# 4. git push --force-with-lease
```

---

## 📢 Communication Guidelines

### Before Creating PR:
1. **Check existing PRs** - https://github.com/StellarDevHub/soroban-playground/pulls
2. **Announce in team chat**: "Working on X feature, will modify package.json"
3. **Look for similar work** - avoid duplicates

### When Reviewing:
- Review within 24 hours
- Be constructive and specific
- Request changes only if truly necessary

---

## 🛠️ Git Configuration (Recommended)

Add to your `.gitconfig`:

```ini
[fetch]
    prune = true
    
[pull]
    rebase = false  # or true if you prefer rebase workflow
    
[merge]
    conflictstyle = diff3
    
[init]
    defaultBranch = main
```

---

## 📊 Visual Workflow

```
main:    A-----B-----C-----D-----E
                 \           /
feature:          G-----H-----I

1. Start from B (git checkout -b feature)
2. Work on G, H
3. Before PR: pull main (now at E)
4. Merge/rebase: create I (resolve conflicts)
5. Create PR: feature -> main
```

---

## ⚠️ Red Flags to Avoid

❌ Branch older than 1 week without merge
❌ Package.json has conflict markers
❌ Multiple PRs modifying same route files
❌ "WIP" PRs staying open for weeks
❌ Not testing after merge conflicts resolved

✅ Branch merged within 3-5 days
✅ Clean merges with no conflicts
✅ Regular communication about shared files
✅ Small, focused PRs (< 400 lines)
✅ All tests passing before merge

---

## 🎓 Quick Reference: Conflict Prevention

| Situation | What to Do |
|-----------|------------|
| Starting new feature | Pull main first |
| Been working 3+ days | Pull main again |
| About to create PR | Merge main, test locally |
| PR open 3+ days | Rebase/merge latest main |
| See similar PR | Contact author, collaborate |
| Large conflict in package.json | Coordinate with other authors |

---

## 📞 Need Help?

If you encounter complex merge conflicts:
1. Don't panic
2. Use `git checkout --ours` for critical files you want to preserve
3. Manually merge dependency updates
4. Test thoroughly before committing
5. Ask for help if unsure!

Remember: **Good communication prevents 90% of merge conflicts!**
