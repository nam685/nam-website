# klaude Server Setup

Manual setup steps for the klaude agent sandbox on the VPS.

## 1. Create klaude user

```bash
sudo useradd -m -s /bin/bash klaude
sudo passwd -l klaude  # lock password (no direct login)
```

## 2. Create directory structure

```bash
sudo -u klaude mkdir -p /home/klaude/{workspace,traces,.ssh}
sudo chmod 700 /home/klaude/.ssh
```

## 3. Set up trace sharing

```bash
sudo groupadd klaude-traces
sudo usermod -aG klaude-traces klaude
sudo usermod -aG klaude-traces nam
sudo chown klaude:klaude-traces /home/klaude/traces
sudo chmod 750 /home/klaude/traces
```

## 4. Lock down nam's secrets

Secrets are stored in Bitwarden Secrets Manager, not `.env` — see
[`docs/infrastructure.md`](infrastructure.md#secrets-bitwarden-secrets-manager). Lock down the one
remaining bootstrap secret and SSH keys:

```bash
chmod 600 /etc/nam-website/bws-token
chmod 600 /home/nam/.ssh/*
chmod 700 /home/nam/.ssh
```

## 5. Install klaude

Install system dependencies first — klaude's `read_document` tool
shells out to `pdftotext` (poppler) for PDFs and `tesseract` for
image OCR. Required when `/slops` accepts PDF or image uploads.

```bash
sudo apt install -y poppler-utils tesseract-ocr
```

Then install klaude itself:

```bash
sudo -u klaude bash
pip install --user git+https://github.com/nam685/klaude.git
# or: uv tool install git+https://github.com/nam685/klaude.git
```

## 6. Configure klaude

Get a free key from [Google AI Studio](https://aistudio.google.com/apikey)
(no credit card required), then create `/home/klaude/.klaude.toml`:

```toml
[default]
model = "gemini-flash-latest"
base_url = "https://generativelanguage.googleapis.com/v1beta/openai/"
api_key_env = "GEMINI_API_KEY"
context_window = 1000000
```

```bash
sudo chown klaude:klaude /home/klaude/.klaude.toml
sudo chmod 600 /home/klaude/.klaude.toml
```

`GEMINI_API_KEY` itself lives in the `nam-website-prod` Bitwarden Secrets Manager project (see
[`docs/infrastructure.md`](infrastructure.md#secrets-bitwarden-secrets-manager)), not in a local
file. **History:** an earlier pass at this doc used a hardcoded `api_key = "..."` literal instead,
because `website/tasks.py` invokes klaude as `sudo -u klaude <bin> ...` (no login shell, no `-E`,
and — at the time — no matching `env_keep` in `/etc/sudoers.d/klaude`), so nothing in `.bashrc`
reached the process and an `api_key_env` pointing at an unset var silently failed in production
(verified back then with a fully stripped `env -i` test). The #296 Bitwarden migration closes that
exact gap instead of working around it: `celery.service` and `klaude-worker.service` (both
`User=nam`) now get `GEMINI_API_KEY` injected via their `bws run` wrapper, and
`/etc/sudoers.d/klaude` has a scoped `Defaults:nam env_keep += "GEMINI_API_KEY"` line so that one
var — and only that one — crosses the `sudo -u klaude` user-switch boundary. Re-verified against
the real invocation path (`sudo -u klaude env`, no `-i`/`-E`) with the var present. Don't reintroduce
a hardcoded literal here or in `.bashrc` — that's exactly the flat-file-secret problem this
migration exists to fix.

`gemini-flash-latest` is a moving alias (currently Gemini 3.6 Flash) rather than a dated model id,
so it keeps working across Google's model rotations without edits here. Switched from OpenRouter's
`openrouter/free` router 2026-07: that router picks a random free model per request (quality varied
wildly, sometimes landing on much weaker models), and its free tier caps out at 50 req/day unless
you've bought $10 in lifetime credits. Gemini's free tier gives a single consistent, capable model
at 1,500 req/day, 10 RPM, 250K TPM — no billing required.

Gemini Flash is natively multimodal, so the same key also covers klaude's `read_document` VLM path
(describes images) — no separate vision model/key needed, unlike the old OpenRouter setup. If you'd
rather use OCR-only, set `[vision].backend = "ocr"` in `.klaude.toml` — see the klaude USAGE docs
for the full `[vision]` block.

If Google's free tier isn't smart enough for a given task, `klaude
--profile pro` can point at a paid `gemini-3-pro`/`gemini-3.6-pro`
model (Pro was pulled from the free tier in April 2026) — add a
`[profiles.pro]` block with the same `base_url`/`api_key_env` and
billing enabled on the Google Cloud project backing the key.

## 7. GitHub deploy key for klaude-playground

```bash
sudo -u klaude ssh-keygen -t ed25519 -f /home/klaude/.ssh/klaude_playground -N ""
# Add the public key to github.com/nam685/klaude-playground as a deploy key (write access)
```

Configure SSH for klaude:
```bash
cat << 'EOF' | sudo tee /home/klaude/.ssh/config
Host github.com
    IdentityFile ~/.ssh/klaude_playground
    IdentitiesOnly yes
EOF
sudo chown klaude:klaude /home/klaude/.ssh/config
sudo chmod 600 /home/klaude/.ssh/config
```

## 8. sudoers rule (nam -> klaude)

Allow the Celery worker (running as nam) to invoke klaude as the klaude user, and let
`GEMINI_API_KEY` cross that boundary (see step 6):

```bash
cat << 'EOF' | sudo tee /tmp/klaude.sudoers.new
Defaults:nam env_keep += "GEMINI_API_KEY"
nam ALL=(klaude) NOPASSWD: /home/klaude/.local/bin/klaude
EOF
sudo visudo -cf /tmp/klaude.sudoers.new   # validate before installing
sudo install -m 440 /tmp/klaude.sudoers.new /etc/sudoers.d/klaude
rm /tmp/klaude.sudoers.new
```

## 9. Network restrictions (iptables)

Restrict klaude user to outbound HTTPS only (Gemini API):

```bash
# Allow established connections
sudo iptables -A OUTPUT -m owner --uid-owner klaude -m state --state ESTABLISHED,RELATED -j ACCEPT
# Allow DNS
sudo iptables -A OUTPUT -m owner --uid-owner klaude -p udp --dport 53 -j ACCEPT
# Allow HTTPS (443) outbound
sudo iptables -A OUTPUT -m owner --uid-owner klaude -p tcp --dport 443 -j ACCEPT
# Allow localhost (for DB access via Celery)
sudo iptables -A OUTPUT -m owner --uid-owner klaude -d 127.0.0.1 -j ACCEPT
# Drop everything else
sudo iptables -A OUTPUT -m owner --uid-owner klaude -j DROP

# Persist
sudo apt install iptables-persistent
sudo netfilter-persistent save
```

## 10. Celery worker systemd service

Create `/etc/systemd/system/klaude-worker.service`:

```ini
[Unit]
Description=klaude Celery Worker
After=network.target redis.service postgresql.service

[Service]
Type=simple
User=nam
Group=nam
WorkingDirectory=/home/nam/nam-website-deploy
ExecStart=/usr/local/bin/bws run --project-id <project-id> -- /home/nam/.local/bin/uv run celery -A config worker --loglevel=info --concurrency=1 -Q slops
EnvironmentFile=/etc/nam-website/bws-token
Restart=on-failure
RestartSec=10
Environment=DJANGO_SETTINGS_MODULE=config.settings

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable klaude-worker
sudo systemctl start klaude-worker
```

## 11. Create klaude-playground repo

On GitHub: create `nam685/klaude-playground` (public, with README).

Clone into klaude's workspace:
```bash
sudo -u klaude git clone git@github.com:nam685/klaude-playground.git /home/klaude/workspace/playground
```
