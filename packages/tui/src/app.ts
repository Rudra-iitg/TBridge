/**
 * App — the main TBridge TUI application.
 *
 * Wires together Screen, StatusBar, Sidebar, PaneManager, CommandBar,
 * CommandPalette, Toast, and ExecutionEngine into a cohesive
 * full-screen terminal workspace.
 *
 * Keyboard model:
 *   - Ctrl+B is the prefix key (like tmux)
 *   - Ctrl+P opens the command palette
 *   - / activates the command bar
 *   - All other keys forward to the focused terminal pane
 */

import { ExecutionEngine, type Session } from "@tbridge/engine";
import { Screen, type KeyEvent } from "./screen.js";
import { StatusBar } from "./components/status-bar.js";
import { Sidebar, type SidebarEntry } from "./components/sidebar.js";
import { PaneManager } from "./components/pane-manager.js";
import { CommandBar } from "./components/command-bar.js";
import { CommandPalette, type PaletteAction } from "./components/command-palette.js";
import { Toast } from "./components/toast.js";

export type AppOptions = {
  userId?: string;
  deviceName?: string;
  shell?: string;
};

export class App {
  readonly screen: Screen;
  readonly engine: ExecutionEngine;
  readonly statusBar: StatusBar;
  readonly sidebar: Sidebar;
  readonly paneManager: PaneManager;
  readonly commandBar: CommandBar;
  readonly palette: CommandPalette;
  readonly toast: Toast;

  private _shell: string;
  private _userId: string;
  private _deviceName: string;
  private _prefixMode = false;
  private _sidebarFocused = false;
  private _paneCounter = 0;

  constructor(options: AppOptions = {}) {
    this._shell = options.shell ?? ExecutionEngine.detectShell();
    this._userId = options.userId ?? process.env.USER ?? "local";
    this._deviceName = options.deviceName ?? "local";

    this.screen = new Screen();
    this.engine = new ExecutionEngine(this._userId);

    this.statusBar = new StatusBar(this.screen, {
      userId: this._userId,
      deviceName: this._deviceName,
      version: "2.0.0",
    });

    this.sidebar = new Sidebar(this.screen, { top: 2 });
    this.paneManager = new PaneManager(this.screen);
    this.commandBar = new CommandBar(this.screen);
    this.palette = new CommandPalette(this.screen);
    this.toast = new Toast(this.screen);

    this._registerPaletteActions();
  }

  // ─── Lifecycle ────────────────────────────────────────────

  async start(): Promise<void> {
    this.screen.start();
    this.screen.on("key", (key: KeyEvent) => this._handleKey(key));
    this.screen.on("resize", () => this._onResize());
    this.screen.on("redraw", () => this._fullRedraw());

    // Engine events
    this.engine.on("session:exit", (sessionId: string, code: number | null) => {
      this.toast.show(
        `Session exited (code ${code ?? "?"})`,
        code === 0 ? "info" : "warning"
      );
      this._updateSidebar();
      this._updateStatusBar();
    });

    this.paneManager.setOffset(this.sidebar.width + 1);
    this._fullRedraw();
    this._createLocalSession();
    this.toast.show("Welcome to TBridge v2", "success", 2000);
  }

  stop(): void {
    this.engine.shutdown().catch(() => {});
    this.screen.stop();
  }

  // ─── Session Management ───────────────────────────────────

  private _createLocalSession(title?: string): void {
    const shellName = this._shell.split("/").pop() ?? "sh";

    try {
      const session = this.engine.createSession({
        shell: this._shell,
        title: title ?? `${this._deviceName}:${shellName}`,
      });

      // Handle session-level errors gracefully
      session.on("error", (err: Error) => {
        this.toast.show(`Session error: ${err.message}`, "error", 3000);
      });

      this._paneCounter++;
      const paneId = `pane-${this._paneCounter}`;
      this.paneManager.createPane(paneId, session);

      this._updateSidebar();
      this._updateStatusBar();

      if (this._paneCounter > 1) {
        this.toast.show(
          `Pane ${this._paneCounter} created`,
          "success",
          1500
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.toast.show(`Failed to create session: ${msg}`, "error", 4000);
    }
  }

  private _closeCurrentPane(): void {
    const focused = this.paneManager.focusedPane;
    if (!focused) return;

    const session = focused.session;
    const paneId = focused.id;

    if (session) {
      this.engine.closeSession(session.id).catch(() => {});
    }

    this.paneManager.removePane(paneId);
    this._updateSidebar();
    this._updateStatusBar();

    if (this.paneManager.paneCount === 0) {
      this.stop();
      return;
    }

    this.toast.show("Pane closed", "info", 1500);
    this._fullRedraw();
  }

  private _renameCurrentSession(newTitle: string): void {
    const focused = this.paneManager.focusedPane;
    if (!focused?.session) return;
    focused.session.title = newTitle;
    this._updateSidebar();
    focused.render();
    this.toast.show(`Renamed to "${newTitle}"`, "success", 1500);
  }

  // ─── Command Palette ─────────────────────────────────────

  private _registerPaletteActions(): void {
    const actions: PaletteAction[] = [
      {
        id: "new-pane",
        label: "New Terminal Pane",
        description: "Create a new local terminal session",
        shortcut: "Ctrl+B, N",
        category: "Session",
        handler: () => this._createLocalSession(),
      },
      {
        id: "close-pane",
        label: "Close Current Pane",
        description: "Close the focused terminal pane",
        shortcut: "Ctrl+B, W",
        category: "Session",
        handler: () => this._closeCurrentPane(),
      },
      {
        id: "next-pane",
        label: "Focus Next Pane",
        description: "Switch to the next pane",
        shortcut: "Ctrl+B, →",
        category: "Navigation",
        handler: () => {
          this.paneManager.focusNext();
          this._updateSidebar();
        },
      },
      {
        id: "prev-pane",
        label: "Focus Previous Pane",
        description: "Switch to the previous pane",
        shortcut: "Ctrl+B, ←",
        category: "Navigation",
        handler: () => {
          this.paneManager.focusPrev();
          this._updateSidebar();
        },
      },
      {
        id: "toggle-sidebar",
        label: "Toggle Sidebar",
        description: "Show or hide the session sidebar",
        shortcut: "Ctrl+B, S",
        category: "Layout",
        handler: () => this._toggleSidebar(),
      },
      {
        id: "rename-session",
        label: "Rename Session",
        description: "Rename the current terminal session",
        category: "Session",
        handler: () => {
          this.commandBar.enterInput(
            (title) => this._renameCurrentSession(title),
            () => {}
          );
        },
      },
      {
        id: "kill-process",
        label: "Kill Process",
        description: "Send SIGKILL to the current session",
        category: "Session",
        handler: () => {
          const s = this.paneManager.focusedPane?.session;
          if (s) {
            s.kill();
            this.toast.show("Process killed", "warning");
          }
        },
      },
      {
        id: "interrupt-process",
        label: "Interrupt Process (Ctrl+C)",
        description: "Send SIGINT to the current session",
        category: "Session",
        handler: () => {
          const s = this.paneManager.focusedPane?.session;
          if (s) s.cancel();
        },
      },
      {
        id: "scroll-up",
        label: "Scroll Up",
        description: "Scroll the current pane up",
        shortcut: "Ctrl+B, PgUp",
        category: "Navigation",
        handler: () => this.paneManager.focusedPane?.scrollUp(10),
      },
      {
        id: "scroll-down",
        label: "Scroll Down",
        description: "Scroll the current pane down",
        shortcut: "Ctrl+B, PgDn",
        category: "Navigation",
        handler: () => this.paneManager.focusedPane?.scrollDown(10),
      },
      {
        id: "clear-pane",
        label: "Clear Terminal",
        description: "Clear the current pane's scrollback",
        category: "Session",
        handler: () => {
          const pane = this.paneManager.focusedPane;
          if (pane?.session) {
            pane.session.write("clear\n");
          }
        },
      },
      {
        id: "connect-peer",
        label: "Connect to Peer",
        description: "Start a new peer connection",
        shortcut: "/connect",
        category: "Network",
        handler: () => {
          this.toast.show("Networking coming in Phase 4", "info");
        },
      },
      {
        id: "send-message",
        label: "Send Message",
        description: "Send a message to a connected peer",
        shortcut: "/msg",
        category: "Network",
        handler: () => {
          this.toast.show("Messaging coming in Phase 5", "info");
        },
      },
      {
        id: "quit",
        label: "Quit TBridge",
        description: "Close all sessions and exit",
        shortcut: "Ctrl+B, Q",
        category: "System",
        handler: () => this.stop(),
      },
    ];

    this.palette.registerActions(actions);
  }

  // ─── Key Handling ─────────────────────────────────────────

  private _handleKey(key: KeyEvent): void {
    // Command palette takes absolute priority
    if (this.palette.visible) {
      this.palette.handleKey(key);
      return;
    }

    // Command bar input mode
    if (this.commandBar.mode === "input") {
      const handled = this.commandBar.handleKey(key.name, key.ch, key.raw);
      if (handled) return;
    }

    // Ctrl+P opens palette
    if (key.name === "ctrl-p") {
      this.palette.open(() => this._fullRedraw());
      return;
    }

    // Ctrl+B prefix mode (tmux-style)
    if (key.name === "ctrl-b") {
      this._prefixMode = true;
      this.statusBar.update({}); // Could show "PREFIX" indicator
      return;
    }

    if (this._prefixMode) {
      this._prefixMode = false;
      this._handlePrefixKey(key);
      return;
    }

    // "/" activates command bar input
    if (key.ch === "/" && this.commandBar.mode === "hints") {
      this.commandBar.enterInput(
        (cmd) => this._handleCommand(cmd),
        () => {}
      );
      return;
    }

    // Tab switches between sidebar and panes
    if (key.name === "tab") {
      this._sidebarFocused = !this._sidebarFocused;
      if (this._sidebarFocused) {
        this.sidebar.render();
      }
      return;
    }

    // Sidebar navigation
    if (this._sidebarFocused) {
      this._handleSidebarKey(key);
      return;
    }

    // Forward to focused pane
    const focused = this.paneManager.focusedPane;
    if (focused) {
      focused.handleInput(key.raw);
    }
  }

  private _handlePrefixKey(key: KeyEvent): void {
    switch (key.name) {
      case "n":
        this._createLocalSession();
        break;
      case "w":
        this._closeCurrentPane();
        break;
      case "right":
      case "l":
        this.paneManager.focusNext();
        this._updateSidebar();
        break;
      case "left":
      case "h":
        this.paneManager.focusPrev();
        this._updateSidebar();
        break;
      case "q":
        this.stop();
        break;
      case "s":
        this._toggleSidebar();
        break;
      case "pageup":
        this.paneManager.focusedPane?.scrollUp(10);
        break;
      case "pagedown":
        this.paneManager.focusedPane?.scrollDown(10);
        break;
      case "1": case "2": case "3": case "4":
      case "5": case "6": case "7": case "8": case "9":
        // Direct pane selection by number
        const idx = parseInt(key.name) - 1;
        const panes = this.paneManager.allPanes;
        if (idx < panes.length) {
          this.paneManager.focusPane(panes[idx]!.id);
          this._updateSidebar();
        }
        break;
      default:
        // Unknown prefix key — show hint
        this.toast.show(
          `Unknown: Ctrl+B, ${key.name}`,
          "warning",
          1500
        );
        break;
    }
  }

  private _handleSidebarKey(key: KeyEvent): void {
    switch (key.name) {
      case "up":
      case "k":
        this.sidebar.selectPrev();
        break;
      case "down":
      case "j":
        this.sidebar.selectNext();
        break;
      case "return": {
        const selectedId = this.sidebar.selectedId;
        if (selectedId) {
          for (const pane of this.paneManager.allPanes) {
            if (pane.session?.id === selectedId) {
              this.paneManager.focusPane(pane.id);
              break;
            }
          }
        }
        this._sidebarFocused = false;
        break;
      }
      case "escape":
        this._sidebarFocused = false;
        break;
      case "d":
      case "delete": {
        // Delete selected session from sidebar
        const selectedId = this.sidebar.selectedId;
        if (selectedId) {
          for (const pane of this.paneManager.allPanes) {
            if (pane.session?.id === selectedId) {
              this.engine.closeSession(selectedId).catch(() => {});
              this.paneManager.removePane(pane.id);
              break;
            }
          }
          this._updateSidebar();
          this._updateStatusBar();
          if (this.paneManager.paneCount === 0) {
            this.stop();
          } else {
            this._fullRedraw();
          }
        }
        break;
      }
    }
  }

  // ─── Commands ─────────────────────────────────────────────

  private _handleCommand(input: string): void {
    const parts = input.split(/\s+/);
    const cmd = parts[0]?.toLowerCase();
    const args = parts.slice(1);

    switch (cmd) {
      case "new":
      case "n":
        this._createLocalSession(args.join(" ") || undefined);
        break;

      case "close":
      case "c":
        this._closeCurrentPane();
        break;

      case "quit":
      case "q":
      case "exit":
        this.stop();
        break;

      case "split":
      case "sp":
        this._createLocalSession();
        break;

      case "rename":
      case "rn":
        if (args.length > 0) {
          this._renameCurrentSession(args.join(" "));
        } else {
          this.toast.show("Usage: /rename <title>", "warning");
        }
        break;

      case "kill":
        this.paneManager.focusedPane?.session?.kill();
        this.toast.show("Process killed", "warning");
        break;

      case "clear":
        this.paneManager.focusedPane?.session?.write("clear\n");
        break;

      case "sessions":
      case "ls": {
        const sessions = this.engine.listSessions();
        const info = sessions
          .map((s) => `${s.status === "active" ? "●" : "○"} ${s.title}`)
          .join(", ");
        this.toast.show(`${sessions.length} sessions: ${info}`, "info", 4000);
        break;
      }

      case "sidebar":
        this._toggleSidebar();
        break;

      case "connect":
        this.toast.show("Networking coming in Phase 4", "info");
        break;

      case "msg":
        this.toast.show("Messaging coming in Phase 5", "info");
        break;

      case "help":
      case "?":
        this.toast.show(
          "Commands: new, close, split, rename, kill, clear, sessions, sidebar, quit",
          "info",
          5000
        );
        break;

      default:
        this.toast.show(`Unknown command: /${cmd}`, "error", 2000);
        break;
    }
  }

  // ─── Layout Helpers ───────────────────────────────────────

  private _toggleSidebar(): void {
    this.sidebar.visible = !this.sidebar.visible;
    this.paneManager.setOffset(this.sidebar.visible ? this.sidebar.width + 1 : 1);
    this._fullRedraw();
    this.toast.show(
      this.sidebar.visible ? "Sidebar shown" : "Sidebar hidden",
      "info",
      1000
    );
  }

  // ─── UI Updates ───────────────────────────────────────────

  private _updateSidebar(): void {
    const entries: SidebarEntry[] = [];

    for (const session of this.engine.listSessions()) {
      entries.push({
        id: session.id,
        type: "session",
        label: session.title.split(":").pop() ?? "shell",
        sublabel: session.shell.split("/").pop() ?? "sh",
        status: session.status,
        isLocal: true,
      });
    }

    this.sidebar.setEntries(entries);

    const focused = this.paneManager.focusedPane;
    if (focused?.session) {
      this.sidebar.selectById(focused.session.id);
    }
  }

  private _updateStatusBar(): void {
    this.statusBar.update({
      activeSessions: this.engine.activeCount,
    });
  }

  private _onResize(): void {
    this.paneManager.setOffset(this.sidebar.visible ? this.sidebar.width + 1 : 1);
    this._fullRedraw();
  }

  private _fullRedraw(): void {
    this.statusBar.render();
    if (this.sidebar.visible) this.sidebar.render();
    this.paneManager.renderAll();
    this.commandBar.render();
    if (this.palette.visible) this.palette.render();
    this.toast.render();
    this.screen.flush();
  }
}
