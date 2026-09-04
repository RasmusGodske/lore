# Deploying on a VM

One small virtual machine runs everything: the orchestrator, the sandboxes it spawns under
gVisor, and Caddy for HTTPS. These steps were written against Hetzner Cloud and are the
literal commands used for the first deployment; only the server-creation step is
provider-specific.

What you need: a domain name you can add a record to, an SSH key, and an Ubuntu 24.04
server with at least 2 vCPU and 4 GB of memory.

## 1. Create the server

**At Hetzner**, with an API token for an empty project:

```bash
export HETZNER_API_TOKEN=...            # or put it in .env, which is gitignored
deploy/create-server.sh lore.example.com ~/.ssh/id_ed25519.pub cx33 fsn1
```

The script registers your key, creates a firewall that allows only ports 22, 80 and 443,
and creates the server with `deploy/cloud-init.yml` as first-boot configuration. It prints
the IP address.

**Anywhere else**: create an Ubuntu 24.04 server, substitute `__DOMAIN__` and `__SSH_KEY__`
in `deploy/cloud-init.yml`, and pass it as user data (cloud-init). Open ports 22, 80, 443.

On first boot, cloud-init installs Docker, gVisor, Caddy and sqlite3, registers `runsc` as a
Docker runtime and runs one container under it as a check, enables a firewall, and creates a
`deploy` user with your key and passwordless sudo.

## 2. Point DNS at it

Create an `A` record for your name, `lore.example.com`, with the server's IP. Caddy needs the
name to resolve before it can obtain a certificate, so do this before step 4.

## 3. Wait for first boot

```bash
ssh deploy@<ip> 'cloud-init status --wait && cat /var/log/lore-runsc-check.log'
```

Expect `status: done` and the `hello-world` text in the log. If the gVisor check failed,
stop here; the deployment must not run sandboxes under `runc` on a public host.

## 4. Install the application

The server only needs the compose file, the seed directory, and the deploy scripts; the images
are published to the GitHub Container Registry by the release workflow.

```bash
ssh deploy@<ip>
git clone https://github.com/RasmusGodske/lore.git /srv/lore
cd /srv/lore
cp /etc/lore/compose.env .env            # binds to 127.0.0.1, selects runsc, pins LORE_VERSION
docker compose pull
docker compose up -d
curl -s http://127.0.0.1:8480/health     # {"ok":true}
curl -s https://lore.example.com/health  # the same, through Caddy with a real certificate
```

To run unreleased code instead, sync a checkout with `deploy/sync.sh deploy@<ip>` and start it
with `docker compose up -d --build`; expect the build to take ten minutes on a small server.

Create the first admin and their token:

```bash
docker compose exec orchestrator lore-admin user create <you> --admin
docker compose exec orchestrator lore-admin token create <you> laptop
```

From your laptop:

```bash
lore login https://lore.example.com --token <token>
claude mcp add --transport http lore https://lore.example.com/mcp --header "Authorization: Bearer <token>"
```

## 5. Mirror the knowledge to GitHub

lore can push `main` to a GitHub repository after every landing, on boot, and every few
minutes as a sweep. That gives you two things: a continuously current off-site copy of the
knowledge, and GitHub's file browser, search, history and blame as a read-only way to look at
what the team has written. It is one-way: edits made on GitHub are not pulled back, writes go
through sessions.

### 5.1 Create the repository

On GitHub, create a new repository, for example `your-org/knowledge`. Private or public is
your choice; it only decides who can read the mirror. Leave it empty: no README, no licence,
no `.gitignore`. lore pushes the first commit.

### 5.2 Create a token that may write to that one repository

Use a fine-grained personal access token, so the credential cannot touch anything else you own.

1. GitHub, top-right avatar, **Settings**.
2. Left sidebar, bottom: **Developer settings**.
3. **Personal access tokens**, then **Fine-grained tokens**, then **Generate new token**.
4. Token name: `lore mirror`. Expiration: your policy; a year is reasonable, and the server's
   status page tells you when pushes start failing.
5. **Resource owner**: your account, or the organisation that owns the repository.
6. **Repository access**: *Only select repositories*, and pick the mirror repository.
7. **Permissions**, under *Repository permissions*: set **Contents** to *Read and write*.
   That is the only permission needed. Leave everything else at *No access*; **Metadata** is
   added automatically as read-only.
8. Generate, and copy the token. It starts with `github_pat_` and is shown once.

For an organisation-owned repository, an organisation admin may need to approve fine-grained
tokens under the organisation's settings, *Personal access tokens*.

### 5.3 Configure the server

Add two lines to the server's `.env` (at `/srv/lore/.env` on the VM), then restart:

```
LORE_MIRROR_URL=https://github.com/your-org/knowledge.git
LORE_MIRROR_TOKEN=github_pat_...
```

```bash
cd /srv/lore && docker compose up -d
```

The token is handed to git through a credential helper at push time; it never appears in a
URL, a log line, the database, a backup, or the API.

### 5.4 Check it

```bash
lore admin status          # includes the mirror line
lore admin mirror status   # remote, last success, last error
lore admin mirror log      # recent attempts, newest first
lore admin mirror sync     # push now
```

Then open the repository on GitHub: `main` should show the knowledge base's files. If a push
fails, the server retries with backoff (one minute, two, four, up to fifteen) and the sweep
tries again every fifteen minutes; `lore admin mirror status` shows the last error verbatim.

Other git hosts that accept a push over HTTPS with a token work the same way; only the token
creation differs. Set `LORE_MIRROR_USERNAME` if the host requires a specific username.

## 6. Backups

The mirror above covers the knowledge itself. The database (users, tokens, audit) still needs
an archive: `deploy/backup.sh` takes a consistent copy of the database and the knowledge
repository, keeps a rotation locally, and optionally copies it off the machine. Enable the nightly timer:

```bash
sudo cp deploy/lore-backup.service deploy/lore-backup.timer /etc/systemd/system/
sudo systemctl enable --now lore-backup.timer
sudo -u deploy deploy/backup.sh           # run one now and check /var/backups/lore
```

For off-machine copies, edit `/etc/lore/backup.env`: set `LORE_BACKUP_TARGET` to an rsync
destination such as a Hetzner Storage Box (`u123456@u123456.your-storagebox.de:lore-backups`,
after adding the server's `deploy` key to the box), and `LORE_MIRROR_REMOTE` to a private git
repository the server can push to with a deploy key. Restore with `deploy/restore.sh <archive>`.

## 7. Updating

Set `LORE_VERSION` in `.env` to the new release, then:

```bash
cd /srv/lore && git pull && docker compose pull && docker compose up -d
```

Rolling back is the same with the previous version number.

Sessions that are active during the restart keep their containers; the orchestrator
reconciles them at boot.

## If you lock yourself out

The host firewall is ufw with default deny. If a rule change ever removes the SSH allow, use
the provider's rescue system: boot into it (at Hetzner, "enable rescue" with your key and reset
the server), mount the root partition, set `ENABLED=no` in `/etc/ufw/ufw.conf`, disable rescue,
reset again. The provider-level firewall still limits the server to 22, 80 and 443 meanwhile.
Then rebuild the rules in order: `ufw --force reset`, defaults, `deny in on lore-net`, the
three allows, `enable`. Never delete rules by number in a loop; numbers shift after each delete.

## What is exposed

Only Caddy listens on the internet, on 80 and 443. The orchestrator binds to localhost.
Sandboxes sit on an internal Docker network with no route out, and the firewall refuses
anything arriving from that bridge (`lore-net`) at the host itself, so a sandbox cannot reach
the host's SSH or Caddy through the bridge gateway either. Verified from inside a session:
the internet, the public address, and the gateway are all unreachable. Every request carries a
bearer token; the git endpoint carries a per-session token in its URL. The orchestrator
itself runs with the Docker socket mounted, which is root-equivalent on the host; this is
the documented trade-off in `spec/01-architecture.md`, acceptable because only your own
agents can reach it and nothing they run executes outside a sandbox.
