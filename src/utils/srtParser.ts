export interface SrtSegment {
  index: number;
  startTime: number;
  endTime: number;
  text: string;
}

function parseSrtTime(time: string): number {
  const match = time.trim().match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/);
  if (!match) return 0;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const seconds = parseInt(match[3], 10);
  const ms = parseInt(match[4], 10);
  return hours * 3600 + minutes * 60 + seconds + ms / 1000;
}

export function parseSrt(content: string): SrtSegment[] {
  const segments: SrtSegment[] = [];
  const blocks = content.trim().replace(/\r\n/g, "\n").split(/\n\n+/);

  for (const block of blocks) {
    const lines = block.split("\n");
    if (lines.length < 2) continue;

    const index = parseInt(lines[0].trim(), 10);
    if (isNaN(index)) continue;

    const timeMatch = lines[1].match(
      /(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/
    );
    if (!timeMatch) continue;

    const startTime = parseSrtTime(timeMatch[1]);
    const endTime = parseSrtTime(timeMatch[2]);
    const text = lines.slice(2).join(" ").trim();

    if (text && endTime > startTime) {
      segments.push({ index, startTime, endTime, text });
    }
  }

  return segments;
}

export function srtSegmentsToScriptText(segments: SrtSegment[]): string {
  return segments.map((s) => s.text).join("\n");
}
