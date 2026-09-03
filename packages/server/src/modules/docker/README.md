# docker

Hides the host Docker daemon: how a sandbox container is created (image, runtime flag, internal
network, read-only root, dropped capabilities, uid 1000, resource limits), how a command is run
inside it with stdin streamed and stdout/stderr demultiplexed and capped, how a timeout is
enforced (coreutils `timeout` inside the container plus a backstop timer), and how containers are
listed and removed. Every daemon failure surfaces as a transport error 100.
