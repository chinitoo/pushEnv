# 📦 PushEnv — Secure, Encrypted .env Sync for Teams
### *Simple. Fast. Open Source.*

[![npm version](https://img.shields.io/npm/v/pushenv.svg)](https://www.npmjs.com/package/pushenv)
[![npm downloads](https://img.shields.io/npm/dw/pushenv.svg)](https://www.npmjs.com/package/pushenv)
[![license](https://img.shields.io/npm/l/pushenv.svg)](./LICENSE)

> **TL;DR:** Sync encrypted `.env` files across your team safely — no plaintext secrets in Git, no SaaS lock-in. Just encryption.

PushEnv solves the **core problem** developers face: **sharing `.env` files across teams without exposing secrets**. It's an open-source, end-to-end encrypted CLI that keeps your secrets safe — no plaintext in Git, Docker images, CI logs, or cloud storage.

Built for developers who want **Doppler-level power** with **zero SaaS lock‑in**.  
Runs fully local. No accounts. No dashboards. No subscriptions.

---

## 🚀 Features

- 🚀 **Zero-file execution** — run commands with secrets injected directly into memory, no `.env` files ever written to disk  
- 📜 **Built-in version history** — every push creates a new, timestamped version with an optional message (like Git for your `.env`)  
- ⏪ **Safe rollbacks** — restore any previous version of a stage with a single command (with extra guardrails for production)  
- 🔍 **Diff any version** — compare your local `.env` with the latest remote or with a specific historical version before you pull or roll back  
- 🔐 **AES-256-GCM end-to-end encryption** — secrets encrypted before leaving your machine  
- 🔑 **PBKDF2 passphrase-derived keys** — passphrase never stored, only derived key  
- 🌲 **Multi-environment support** — manage `development`, `staging`, `production` separately  
- 💾 **Works with any S3-compatible storage** — Cloudflare R2, AWS S3, MinIO, etc.  
- 🖥 **One-time passphrase per machine** — enter once, key stored securely  
- 📁 **Per-project configuration** — `.pushenv/config.json` (safe to commit)  
- 💻 **Per-device keyring** — `~/.pushenv/keys.json` (private, never commit)  
- 🔓 **Secrets never sent in plaintext** — encrypted end-to-end  
- 📝 **Fully open-source, no vendor lock-in**

---

## 🔧 Installation

```bash
npm install -g pushenv
```

OR for development:

```bash
npm link
```

---

## 🛠 Quick Start

### 🤝 Who is this for?

- **Solo developers** who want better secret hygiene without running another SaaS dashboard  
- **Small teams** who just want a **simple “push / pull” workflow** that works across laptops and CI  

You can get from “zero” to “secure `.env` synced for the whole team” in **under 5 minutes**:

### 1️⃣ Initialize

```bash
pushenv init
```

You'll choose:
- environments (dev, staging, prod)
- file paths for each env
- passphrase (team secret)

Creates:

```
.pushenv/config.json      # safe to commit
~/.pushenv/keys.json      # device keyring (private)
```

---

### 2️⃣ Push encrypted `.env` files

```bash
pushenv push
pushenv push --stage staging
pushenv push --stage production
```

PushEnv will:
- Read your `.env`
- Encrypt locally
- Upload the encrypted blob to cloud

Secrets **never** leave your machine unencrypted.

---

### 3️⃣ Teammates pull & decrypt

```bash
pushenv pull
pushenv pull -s production
```

After entering passphrase once:
- AES key is derived
- Encrypted blob downloaded
- Decrypted locally only
- `.env` file written to your configured path

**Note:** PushEnv will prompt for confirmation when pushing/pulling production environments for safety.

---

### 4️⃣ Compare local vs remote

See what's different between your local `.env` and the remote version **before pulling** or rolling back:

```bash
# Compare development (default)
pushenv diff

# Compare specific stage
pushenv diff --stage production
pushenv diff -s staging
```

Shows:
- **Added** variables (in remote, not local)
- **Removed** variables (in local, not remote)
- **Changed** values (same key, different value)
- **Unchanged** count

**Safety features:**
- Verifies local file stage matches command parameter
- Warns if stage mismatch detected
- Handles files without PushEnv headers

---

### 5️⃣ Browse history & roll back (versioning)

Every `pushenv push` creates a new version with a timestamp and message:

```bash
# Show version history for a stage
pushenv history
pushenv history --stage production

# Push with a custom message (great for rollouts)
pushenv push -m "Add STRIPE_WEBHOOK_SECRET for billing rollout"
pushenv push --stage staging -m "Rotate JWT_SECRET"

# Diff against a specific historical version before rolling back
pushenv diff --stage production --version 3

# Roll back production to a previous version (creates a new version with rollback message)
pushenv rollback --stage production --version 3
```

This makes it easy to:

- Track how your secrets changed across rollouts  
- Safely undo a bad deploy by restoring a known-good `.env`  
- Audit who changed what (when paired with Git history around `pushenv` usage)  

---

### 6️⃣ Generate example .env file

Create a safe example `.env` file with placeholder values that can be committed to Git:

```bash
# Generate example for development (default)
pushenv example

# Generate example for specific stage
pushenv example --stage production
pushenv example -s staging

# Specify custom output path
pushenv example --stage production -o .env.production.example
```

**What it does:**
- Downloads and decrypts remote stage
- Replaces all secret values with placeholders
- Creates `.env.{stage}.example` file
- Safe to commit to version control

**Use cases:**
- Document required environment variables
- Onboard new team members
- CI/CD setup documentation
- Share variable structure without secrets

---

## 🚀 Zero-File Execution (Advanced)

**Optional feature:** Run commands with secrets injected directly into process memory — no `.env` file written to disk.

```bash
# Run with development secrets (default)
pushenv run "npm start"

# Run with production secrets
pushenv run -s production "npm start"
pushenv run --stage production "npm start"

# Preview what would be injected (dry run)
pushenv run --dry-run -s production "npm start"

# Show variable names being injected
pushenv run -v "npm start"
pushenv run --verbose "npm start"

# Combine options
pushenv run -s production -v --dry-run "npm start"
```

**When to use:**
- CI/CD pipelines where you don't want `.env` files
- Docker containers for cleaner images
- Extra-paranoid security workflows
- When you want secrets to vanish when process exits

**Benefits:**
- No `.env` file to accidentally commit
- No residual secret files on disk
- Secrets only exist in process memory
- Perfect for production deployments

---

## 🔒 Security Model

✔ No plaintext secrets stored in Git  
✔ Passphrase never stored  
✔ Only derived AES key stored locally  
✔ AES-256-GCM authenticated encryption  
✔ PBKDF2 key derivation  
✔ Encrypted blobs stored in cloud
✔ Secrets decrypted locally only  
✔ Keyring stored per-user (`~/.pushenv/keys.json`)  

PushEnv follows modern cryptography and zero-trust local workflows.

---

## 📁 Project Structure

```
project/
  .env.development
  .env.staging
  .env.production
  .pushenv/
    config.json
~/.pushenv/
  keys.json
```

## 📖 Commands

| Command | Description |
|--------|-------------|
| `pushenv init` | Initialize project (configure stages and passphrase) |
| `pushenv push` | Encrypt & upload `.env` (default: `development` stage, creates a new version) |
| `pushenv push -s <stage>`<br/>`pushenv push --stage <stage>` | Encrypt & upload specific stage (creates a new version) |
| `pushenv push -m "<message>"` | Push with a custom version message |
| `pushenv pull` | Download & decrypt `.env` (default: `development` stage) |
| `pushenv pull -s <stage>`<br/>`pushenv pull --stage <stage>` | Download & decrypt specific stage |
| `pushenv run <command>` | Run command with secrets in memory (default: `development` stage) |
| `pushenv run -s <stage> <command>`<br/>`pushenv run --stage <stage> <command>` | Run with specific stage secrets |
| `pushenv run --dry-run <command>` | Preview what would be injected without running |
| `pushenv run -v <command>`<br/>`pushenv run --verbose <command>` | Show variable names being injected |
| `pushenv list-stages`<br/>`pushenv ls` | List all configured stages and their status |
| `pushenv diff` | Compare local `.env` with latest remote (default: `development` stage) |
| `pushenv diff -s <stage>`<br/>`pushenv diff --stage <stage>` | Compare specific stage (latest) |
| `pushenv diff --stage <stage> --version <N>` | Compare local `.env` with a specific historical version |
| `pushenv history` | Show version history for the default stage |
| `pushenv history -s <stage>`<br/>`pushenv history --stage <stage>` | Show version history for a specific stage |
| `pushenv rollback --stage <stage> --version <N>` | Create a new version that restores a previous one (safe rollback) |
| `pushenv example` | Generate example `.env` file with placeholders (default: `development` stage) |
| `pushenv example -s <stage>`<br/>`pushenv example --stage <stage>` | Generate example for specific stage |
| `pushenv example -o <path>`<br/>`pushenv example --output <path>` | Specify output file path |

---

## 🔥 Why PushEnv?

**Solves the real problem:** Sharing `.env` files across teams without exposing secrets.

- ✅ **No `.env` files in Git** — encrypted blobs only  
- ✅ **No plaintext exposure** — end-to-end encryption  
- ✅ **No SaaS lock-in** — use your own S3-compatible storage  
- ✅ **Simple workflow** — push, pull, done  
- ✅ **Team-friendly** — one passphrase, works everywhere  
- ✅ **Open-source** — no vendor lock-in, fully auditable  

Perfect for:
- **Teams** sharing secrets across developers  
- **CI/CD** pipelines needing secure env injection  
- **Local development** with secure secret management  
- **Docker** workflows without committing secrets  
- **Solo developers** wanting better security practices

---

## 🛣 Roadmap / Recent

### v0.2.x
- Versioned pushes with metadata (message + timestamp)  
- `history` command — browse per-stage `.env` history  
- Version-aware `diff` — compare against any historical version  
- `rollback` command — safe rollbacks that still preserve full history  

### v0.1.8
- Multi-env  
- `list-stages`  
- Zero-file execution  
- `diff` command - compare local vs remote  
- `example` command - generate safe example .env files

---

## ❤️ Contributing

PRs welcome!  

---

## 📜 License
MIT — open-source, commercially friendly.

---

## 🙋 Author
**Shahnoor Mujawar**  
Founder of Dtrue  
Backend + Infra + AI engineer  

---

⭐ **If you like PushEnv, star the repo!**  
Your star helps other developers discover it.