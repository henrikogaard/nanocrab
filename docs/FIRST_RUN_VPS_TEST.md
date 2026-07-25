# First-Run VPS Rehearsal

Use this checklist to rehearse a clean NanoCrab install on a disposable VPS.
Do not reuse production secrets.

## 1. Create A Disposable VPS

- Start a fresh Ubuntu LTS VPS with at least 2 vCPU, 4 GB RAM, and 30 GB disk.
- Add your SSH key, disable password SSH if the provider does not do so by default, and note the public IP.
- Open only SSH and the intended dashboard/Caddy ports in the provider firewall.
- On Linux with UFW, also allow the credential proxy port from the Docker agent network subnet (typically `172.19.0.0/16` → TCP `3001`). `docker0` (`172.17.0.0/16`) alone is not enough for `nanocrab-agent-net`.

## 2. Install Host Prerequisites

```bash
sudo apt-get update
sudo apt-get install -y git curl build-essential

# Install Node 22 using your preferred manager, then verify:
node --version
npm --version

# Install and start Docker:
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"
newgrp docker
docker info
```

## 3. Clone And Bootstrap

```bash
git clone https://github.com/henrikogaard/nanocrab.git
cd nanocrab
./setup.sh
npm run setup -- --dry-run
```

The dry run should print a preflight block. Missing admin, provider, or channel
credentials are expected until the next step. It must not print raw tokens,
passwords, cookies, authorization headers, or credential-proxy URLs.

## 4. Configure Credentials

```bash
npx tsx setup/index.ts --step admin -- \
  --username <admin-user> \
  --password <temporary-password> \
  --domain <vps-domain> \
  --port 9743
```

Add exactly one provider path for the rehearsal:

```bash
# Hosted API example
printf '\nDEFAULT_PROVIDER=openai-responses\nOPENAI_API_KEY=%s\n' '<test-key>' >> .env

# Or Codex OAuth example
CODEX_HOME="$PWD/data/codex" codex login --device-auth
npx tsx setup/index.ts --step provider -- --provider=codex --model=gpt-5.4
```

Configure one channel:

```bash
# Telegram example
printf '\nTELEGRAM_BOT_TOKEN=%s\n' '<test-bot-token>' >> .env
```

Run the preflight again:

```bash
npm run setup -- --dry-run
```

## 5. Run Setup And Verify

```bash
npm run setup:full
npm run build
npm run start
```

Verify:

- Dashboard loads on the configured admin port or through Caddy.
- Admin login works with the configured username and password.
- Settings -> First-Run Preflight shows required checks as OK.
- The configured channel connects or reports an actionable auth state.
- The selected provider preflight passes in Settings.
- A test message can trigger an agent response.

## 6. Collect Diagnostics

```bash
npm run setup -- --dry-run
cat .setup-state.json
tail -200 logs/setup.log
tail -200 logs/nanocrab.log
docker ps -a --format '{{.Names}} {{.Status}}'
```

Confirm `logs/setup.log` contains redacted placeholders instead of raw
passwords, API keys, cookies, bearer tokens, or credential-proxy material.

## 7. Discard The VPS

- Remove the VPS from the cloud provider console.
- Revoke any temporary provider/channel tokens used during rehearsal.
- Delete DNS records or firewall exceptions created for the rehearsal.
