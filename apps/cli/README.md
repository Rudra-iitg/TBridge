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
