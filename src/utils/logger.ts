import fs from "fs/promises";
import path from "path";
import type { Config } from "../config.js";

export class Logger {
  private logStream: fs.FileHandle | null = null;
  private logPath: string;
  public onLog?: (message: string) => void;

  constructor(config: Config, runId: string) {
    this.logPath = path.join(config.logDir, `${runId}.log`);
  }

  async init(): Promise<void> {
    await fs.mkdir(path.dirname(this.logPath), { recursive: true });
    this.logStream = await fs.open(this.logPath, "a");
  }

  async log(message: string): Promise<void> {
    const timestamp = new Date().toISOString().split("T")[1]?.slice(0, 12) ?? "";
    const line = `[${timestamp}] ${message}`;
    console.log(line);
    if (this.logStream) {
      await this.logStream.write(line + "\n");
    }
    this.onLog?.(line);
  }

  async warn(message: string): Promise<void> {
    await this.log(`⚠ WARNING: ${message}`);
  }

  async error(message: string): Promise<void> {
    await this.log(`✗ ERROR: ${message}`);
  }

  async close(): Promise<void> {
    if (this.logStream) {
      await this.logStream.close();
    }
  }
}
