export type SseEvent = { event: string; data: string };

/** Incremental SSE decoder kept transport-agnostic for fragmented fetch streams. */
export class SseEventDecoder {
  private buffer = "";
  private event = "message";
  private data: string[] = [];

  push(chunk: string): SseEvent[] {
    this.buffer += chunk;
    const events: SseEvent[] = [];
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      let line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      const parsed = this.consumeLine(line);
      if (parsed) events.push(parsed);
      newline = this.buffer.indexOf("\n");
    }
    return events;
  }

  private consumeLine(line: string): SseEvent | null {
    if (line === "") {
      if (this.data.length === 0) {
        this.event = "message";
        return null;
      }
      const parsed = { event: this.event, data: this.data.join("\n") };
      this.event = "message";
      this.data = [];
      return parsed;
    }
    if (line.startsWith(":")) return null;
    const separator = line.indexOf(":");
    const field = separator < 0 ? line : line.slice(0, separator);
    let value = separator < 0 ? "" : line.slice(separator + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") this.event = value || "message";
    else if (field === "data") this.data.push(value);
    return null;
  }
}
