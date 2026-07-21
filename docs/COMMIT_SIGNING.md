# Coding job commit signing

Registered coding repositories can opt into host-side commit signing through
the `/api/agents/coding/repos/:owner/:name/commit-signing` endpoint.

Policies are:

- `off` (default): commits are created unsigned.
- `prefer`: NanoCrab attempts a host-keyring signature and records a sanitized
  warning if it must fall back to an unsigned commit.
- `require`: publication fails closed unless a host signing key is configured
  and the resulting commit passes `git verify-commit`.

Set `NANOCRAB_GIT_SIGNING_KEY` to a key id, not a private key. The private key
must remain in the host's signing-agent/keyring. NanoCrab never mounts signing
keys into agent containers or coding workspaces. The signing operation runs in
the approved host-side Git publication path after the normal PR approval gate.

The job and PR evidence include the policy, signed/unsigned result, and a
sanitized warning when applicable.
