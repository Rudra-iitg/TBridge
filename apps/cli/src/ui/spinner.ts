/**
 * Animated terminal spinner for async operations.
 *
 * Uses braille dot patterns for a smooth animation that works in all
 * modern terminals.
 */

import { primary, success, error, warning, dim } from "./theme.js";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const INTERVAL_MS = 80;

export class Spinner {
  private frameIndex = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private message: string;
  private stream = process.stderr;

  constructor(message: string) {
    this.message = message;
  }

  /** Start the animation. */
  start(): this {
    this.frameIndex = 0;
    this.render();
    this.timer = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % FRAMES.length;
      this.render();
    }, INTERVAL_MS);
    return this;
  }

  /** Update the message while spinning. */
  update(message: string): this {
    this.message = message;
    return this;
  }

  /** Stop with a success message. */
  succeed(message?: string): void {
    this.stop();
    const text = message ?? this.message;
    this.stream.write(`\r\x1b[2K  ${success("✓")} ${text}\r\n`);
  }

  /** Stop with a failure message. */
  fail(message?: string): void {
    this.stop();
    const text = message ?? this.message;
    this.stream.write(`\r\x1b[2K  ${error("✗")} ${text}\r\n`);
  }

  /** Stop with a warning message. */
  warn(message?: string): void {
    this.stop();
    const text = message ?? this.message;
    this.stream.write(`\r\x1b[2K  ${warning("⚠")} ${text}\r\n`);
  }

  /** Stop with an info message (no animation residue). */
  info(message?: string): void {
    this.stop();
    const text = message ?? this.message;
    this.stream.write(`\r\x1b[2K  ${primary("ℹ")} ${text}\r\n`);
  }

  /** Stop the spinner without printing. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.stream.write("\r\x1b[2K");
  }

  private render(): void {
    const frame = primary(FRAMES[this.frameIndex]!);
    this.stream.write(`\r\x1b[2K  ${frame} ${this.message}`);
  }
}

/**
 * Convenience: create and start a spinner in one call.
 */
export function spin(message: string): Spinner {
  return new Spinner(message).start();
}
