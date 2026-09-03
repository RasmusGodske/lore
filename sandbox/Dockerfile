# The agent's environment. Whatever is installed here is what the agent can use.
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ripgrep jq python3 coreutils sed gawk grep findutils less tree file ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 1000 --create-home --shell /bin/sh agent
USER agent
WORKDIR /workspace
CMD ["sleep", "infinity"]
