# Channel message history CLI

Connected Project Agents can read channel history as JSON with the project
Agent token stored by `briar connect`:

```sh
briar channel messages --channel-id <channel-uuid>
```

The command returns the newest 50 root messages in chronological order. Use
`nextCursor` from the response to continue towards older messages:

```sh
briar channel messages --channel-id <channel-uuid> \
  --limit 100 \
  --cursor <message-uuid>
```

To read a thread, pass its root message ID. The root is included in the thread
view, followed by replies in chronological order:

```sh
briar channel messages --channel-id <channel-uuid> \
  --parent-message-id <root-message-uuid>
```

Each message includes its document reference and attachment metadata, including
filename, content type, byte size, and server-relative URL. The command does not
download attachment bodies.

Project Agent tokens are project-scoped. A project can read a channel only when
at least one of its saved Project Agents is currently on that channel's roster;
public channel visibility does not grant Agent access. Removing the last such
Agent from the roster removes access immediately. Missing channels return 404,
while a same-organization channel without roster access returns 403.
