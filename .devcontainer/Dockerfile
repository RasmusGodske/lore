# Development container for the knowledge-base orchestrator.
# Everything a contributor needs is baked here from public sources; nothing personal.
# Docker itself comes from the docker-in-docker feature in devcontainer.json (a nested
# daemon is not practical in a Dockerfile). gVisor is not available inside that daemon,
# so sandboxes run under runc here; the VM uses runsc.
FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

ARG NODE_MAJOR=22

USER vscode
# The base image already ships zsh + oh-my-zsh for vscode; add the usual plugins (idempotent).
RUN [ -d ~/.oh-my-zsh ] || sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended; \
    for p in zsh-completions zsh-syntax-highlighting zsh-autosuggestions; do \
      [ -d ~/.oh-my-zsh/custom/plugins/$p ] || git clone --depth 1 https://github.com/zsh-users/$p ~/.oh-my-zsh/custom/plugins/$p; \
    done \
    && sed -i 's/^plugins=(.*)$/plugins=(git zsh-completions zsh-syntax-highlighting zsh-autosuggestions)/' ~/.zshrc \
    && grep -q zsh-autosuggestions ~/.zshrc

USER root
# node 22 (the server uses node:sqlite, which needs >= 22.13), GitHub CLI, and the shell tools
# the sandbox image also has, so poking at data/main and lore.db feels the same as inside a session.
RUN curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash - \
    && install -d -m 0755 /etc/apt/keyrings \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends nodejs gh sqlite3 ripgrep jq python3 python3-pip ca-certificates git curl \
    && apt-get clean && rm -rf /var/lib/apt/lists/* \
    && node --version && npm --version && gh --version && sqlite3 --version && rg --version && jq --version && python3 --version

USER vscode
# uv for python tooling; claude (native installer) and omp (official installer, ships its own runtime).
RUN curl -LsSf https://astral.sh/uv/install.sh | sh \
    && curl -fsSL https://claude.ai/install.sh | bash \
    && curl -fsSL https://omp.sh/install | sh

USER root
RUN printf '%s\n' \
      'export PATH="$HOME/.local/bin:$PATH"' \
      'export LORE_URL="http://localhost:8480"' \
      >> /home/vscode/.zshrc \
    && chown -R vscode:vscode /home/vscode \
    && su - vscode -c 'export PATH="$HOME/.local/bin:$PATH"; uv --version && claude --version && omp --version'

USER vscode
WORKDIR /workspaces
