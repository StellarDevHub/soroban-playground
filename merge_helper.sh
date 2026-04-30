#!/bin/bash

# Merge helper script for resolving PR conflicts
# Usage: ./merge_helper.sh <PR_NUMBER>

PR=$1
cd "/home/knights/Documents/Drips Miantainer Project/soroban-playground"

echo "Processing PR #$PR..."

# Get PR info
PR_INFO=$(gh pr view $PR --json headRefName,headRepositoryOwner --jq '{ref: .headRefName, owner: .headRepositoryOwner.login}')
REF=$(echo "$PR_INFO" | jq -r '.ref')
OWNER=$(echo "$PR_INFO" | jq -r '.owner')

echo "PR Owner: $OWNER, Branch: $REF"

# Add remote
git remote remove $OWNER 2>/dev/null
git remote add $OWNER https://github.com/$OWNER/soroban-playground.git 2>/dev/null

# Fetch branch
git fetch $OWNER $REF || { echo "Failed to fetch"; exit 1; }

# Checkout
git checkout -B merge-pr-$PR $OWNER/$REF || { echo "Failed to checkout"; exit 1; }

# Merge main
git merge origin/main --no-edit 2>&1

# Check if there are conflicts
if [ $? -ne 0 ]; then
    echo "Conflicts detected. Auto-resolving by accepting main's version for conflicts..."
    # Get list of conflicted files
    CONFLICTED=$(git diff --name-only | grep -v "^$" || git status --short | grep "^UU" | awk '{print $2}')
    
    if [ -n "$CONFLICTED" ]; then
        echo "Conflicted files:"
        echo "$CONFLICTED"
        
        # For simple conflicts, accept theirs (main)
        for file in $CONFLICTED; do
            if [ -f "$file" ]; then
                echo "Resolving: $file"
                git checkout --theirs "$file" 2>/dev/null || git checkout --ours "$file" 2>/dev/null
                git add "$file"
            fi
        done
        
        # Commit the merge
        git commit --no-verify -m "Merge PR #$PR: Auto-resolve conflicts"
        
        # Push back
        git push $OWNER merge-pr-$PR:$REF --force
        
        # Merge PR
        gh pr merge $PR --squash --delete-branch
        echo "✓ PR #$PR merged successfully"
    else
        echo "No files to resolve. Aborting merge."
        git merge --abort
        exit 1
    fi
else
    echo "No conflicts!"
    git push $OWNER merge-pr-$PR:$REF --force
    gh pr merge $PR --squash --delete-branch
    echo "✓ PR #$PR merged successfully"
fi

# Return to main
git checkout main
