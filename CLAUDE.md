# Workflow rules (mandatory)

- **Always merge via a GitHub pull request.** Every branch lands on `main` through a PR — never a local `git merge` pushed to `main`. The PR is the merge record.
- **Merge only when all green.** Merge to `main` only when: review findings are resolved, all tests/CI pass, and the ticket's acceptance criteria are met. No self-merge over open findings.
