# CI/CD

## GitHub Actions

### CI (`.github/workflows/ci.yml`)
Runs on every push and PR to main:
- Frontend: pnpm install, lint, build
- Backend: uv sync, ruff check, ruff format --check

### Deploy (`.github/workflows/deploy.yml`)
Runs on push to main:
- SSH into Hetzner server
- git pull, pnpm install, next build
- Restart Next.js process

## Setup Required

### 1. Add deploy SSH key to GitHub
Generate a deploy key on the server:
```bash
ssh-keygen -t ed25519 -f ~/.ssh/deploy_key -N ""
cat ~/.ssh/deploy_key  # copy private key
```

Add as GitHub secret:
- Go to repo → Settings → Secrets and variables → Actions
- Add secret named `DEPLOY_SSH_KEY` with the private key content

Add public key to authorized_keys:
```bash
cat ~/.ssh/deploy_key.pub >> ~/.ssh/authorized_keys
```

### 2. Branch protection (requires public repo or GitHub Pro)
- Require PR for main (no direct push)
- Require CI status checks to pass
- Squash merge only (already configured)
- Delete branch on merge (already configured)

## GitHub Repo Settings (already applied)
- Squash merge only (merge commit and rebase disabled)
- Squash commit message: PR title + description
- Auto-delete head branches after merge
- Auto-merge enabled
