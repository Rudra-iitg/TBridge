# T-Bridge CLI

Phase 1 starts with a local PTY prototype.

```bash
npm install
npm run dev:local
```

The `local` command starts an interactive shell through `node-pty` and streams
PTY output directly to the current terminal.

Controls:

- `Ctrl+]`: close the prototype
- `Ctrl+C`: forwarded to the shell

The goal is to prove terminal streaming behavior before adding the relay server.

## Phase 2 Relay Prototype

Start the local relay:

```bash
npm run dev:relay
```

Share a shell:

```bash
npm run dev:share
```

Connect as a guest:

```bash
npm run dev:connect
```

The default dev share code is `123-456`.
