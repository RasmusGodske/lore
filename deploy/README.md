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

### 4.1 How people and agents sign in

**Tokens** are the default and always work. Every user mints their own (`lore token create
<label>`), an admin mints one for anybody (`lore admin user token <user> <label>`), and each is
revoked on its own. **claude.ai** uses a token too, sent as a custom header from Anthropic's
side; the steps are in the top-level README, *Connect claude.ai*.

**A login proxy** is the alternative when lore sits behind something that already signs
people in and passes their identity on in a request header: a single-sign-on proxy, an access
gateway, a mesh VPN that names the peer, or an MCP gateway. Tell lore which header carries the
identity and which addresses may set it, in `/srv/lore/.env`, and restart:

```
LORE_AUTH_TRUSTED_HEADER=X-Forwarded-Email
LORE_AUTH_TRUSTED_PROXIES=172.18.0.1
```

A request from a listed address that carries the header is the user it names (lowercased; an
e-mail address is a valid user name), created on first sight without admin rights, and every
session and command it runs is attributed to that user in the audit log, under a token labelled
`proxy`. Promote someone with `lore admin user ...` as usual; to shut one person out at lore's
end, revoke their `proxy` token. Requests without the header still need a bearer token, so
your agents' tokens and claude.ai keep working beside it. The header arriving from any address
not on the list is refused with 401, never trusted and never ignored.

The list is the address the orchestrator sees the proxy connect from, not the proxy's public
address. With the compose file, a proxy on the host (Caddy, say) arrives through Docker's port
mapping as the gateway of the compose network. To find it, send one request with the header
and read the refusal, which names the address:

```bash
curl -s http://127.0.0.1:8480/me -H 'X-Forwarded-Email: probe@example.com'
# {"error":{"code":101,"message":"the x-forwarded-email header is only accepted from a trusted proxy, and this request came from 172.18.0.1"}}
```

**The caveat: the proxy must be the only route in.** lore believes whatever a listed address
tells it, so anyone who can reach lore from that address, or reach lore some other way while
the header is honoured from somewhere they control, can be anybody. Concretely:

- Bind the orchestrator to localhost (`LORE_PUBLIC_BIND=127.0.0.1`, the default here) or to a
  network only the proxy is on, and make sure the proxy overwrites or strips the header on
  every request it forwards, so a client cannot supply its own.
- List exact addresses, not ranges. Never list the sandbox network (`lore-net`) or a range
  containing it: sandboxes can reach the orchestrator, and an agent could then claim to be
  anyone.
- Anything else on the host that can open a connection to port 8480 arrives from the same
  gateway address as the proxy. On this VM that is only you and the services you run; keep it
  that way, or put the proxy on its own Docker network and list its address there.

## 5. Use a GitHub repository as the source of truth

lore runs in one of two ways:

- **Standalone.** No remote configured; lore's own repository is the knowledge base. Nothing
  else is needed, and nothing leaves the server.
- **With a remote.** A git repository, for example on GitHub, is the source of truth. lore keeps
  a local copy current, every session starts from the remote's `main`, and landing a change
  means pushing it to the remote: an agent's push is only accepted once GitHub has taken it.

The second mode gives you a continuously current off-site copy and GitHub's file browser,
search, history and blame as a read-only way to look at the knowledge. It also makes the
repository editable on GitHub: a change made there is what the next session starts from, and
if it happens while a session is in progress, that session merges it exactly as it would merge
another session's work. What you give up is that such edits do not appear in lore's audit log;
they are visible in git history under their GitHub author instead.

### 5.1 Create the repository

On GitHub, create a repository, for example `your-org/knowledge`, private or public as you
prefer. It may be empty: lore pushes its bundle root on first boot. It may also already
contain a knowledge base: lore then takes it as its starting point. Do not have both lore
history and unrelated GitHub history; if lore already ran standalone and you now point it at a
non-empty repository, the two have diverged and lore refuses to guess (see 5.5).

### 5.2 Create a token that may write to that one repository

Use a fine-grained personal access token, so the credential cannot touch anything else.

1. GitHub, top-right avatar, **Settings**.
2. Left sidebar, bottom: **Developer settings**.
3. **Personal access tokens**, then **Fine-grained tokens**, then **Generate new token**.
4. Token name: `lore`. Expiration: your policy; a year is reasonable, and `lore admin status`
   tells you when fetches start failing.
5. **Resource owner**: your account, or the organisation that owns the repository.
6. **Repository access**: *Only select repositories*, and pick the repository.
7. **Permissions**, under *Repository permissions*: **Contents**, *Read and write*. That is the
   only permission needed; **Metadata** is added automatically as read-only.
8. Generate and copy the token. It starts with `github_pat_` and is shown once.

For an organisation-owned repository, an organisation admin may need to allow or approve
fine-grained tokens under the organisation's settings, *Personal access tokens*.

### 5.3 Configure the server

Add two lines to the server's `.env` (at `/srv/lore/.env` on the VM), then restart:

```
LORE_REMOTE_URL=https://github.com/your-org/knowledge.git
LORE_REMOTE_TOKEN=github_pat_...
```

```bash
cd /srv/lore && docker compose up -d
```

The token is handed to git through a credential helper at fetch and push time; it never
appears in a URL, a log line, the database, a backup, or the API.

**A token that rotates.** If something else keeps the token current, for example a GitHub App
installation token renewed every hour, or a secret your container platform mounts and
refreshes, give lore the file instead of the value:

```
LORE_REMOTE_URL=https://github.com/your-org/knowledge.git
LORE_REMOTE_TOKEN_FILE=/run/secrets/lore-remote-token
```

lore reads the file at every fetch and push, trims surrounding whitespace, and uses what is
there, so a renewed token takes effect at the next fetch without a restart. Set one of
`LORE_REMOTE_TOKEN` and `LORE_REMOTE_TOKEN_FILE`, not both; with both the server refuses to
start. The path is inside the orchestrator container, so mount the file there, for example
with a `docker-compose.override.yml` beside the compose file:

```yaml
services:
  orchestrator:
    volumes:
      - /etc/lore/remote-token:/run/secrets/lore-remote-token:ro
```

Keep it out of the data directory, which is backed up. If the file is missing or empty, that
fetch or push fails, `lore admin remote status` shows `no remote token: LORE_REMOTE_TOKEN_FILE
/run/secrets/lore-remote-token cannot be read` (or `is empty`) as the last error, and an
agent's push is refused with the same words; nothing lands until the file is back.

### 5.4 Check it

```bash
lore admin status          # includes the remote line
lore admin remote status   # remote, last success, last error, diverged or not
lore admin remote log      # recent fetches and landings, newest first
lore admin remote sync     # fetch now
```

Open the repository on GitHub: `main` should show the knowledge base. Land something through
a session and it appears within a second; edit a file on GitHub and the next session starts
with it.

### 5.5 If it diverges

lore never forces anything. If local `main` and the remote's `main` have both moved with
commits the other lacks, `lore admin remote status` reports *diverged*, sessions can still be
created but nothing can land until an operator picks a side: either push lore's `main` to the
remote with `--force` from the server, or reset lore's `main` to the remote's. In practice this
only happens when a server that ran standalone is pointed at a repository that already has its
own history.

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
bearer token, or, with a login proxy configured (4.1), the proxy's identity header from the
proxy's own address; the git endpoint carries a per-session token in its URL. The orchestrator
itself runs with the Docker socket mounted, which is root-equivalent on the host; this is
the documented trade-off in `spec/01-architecture.md`, acceptable because only your own
agents can reach it and nothing they run executes outside a sandbox.
