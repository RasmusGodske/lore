# The agent's environment. Whatever is installed here is what the agent can use.
# Build context is the repository root (see docker-compose.yml and the release workflow).
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ripgrep jq python3 coreutils sed gawk grep findutils less tree file ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 1000 --create-home --shell /bin/sh agent
# The knowledge format's specification, readable from any session without a network.
COPY vendor/okf/SPEC.md /usr/share/lore/OKF-SPEC.md
USER agent
WORKDIR /workspace
CMD ["sleep", "infinity"]
