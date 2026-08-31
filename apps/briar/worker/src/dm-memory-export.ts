import { strToU8, Zip, ZipPassThrough } from "fflate";
import { corsHeaders } from "./http-response";

export function dmMemoryZipResponse(
  entries: AsyncGenerator<{ name: string; content: string }>,
  memorySpaceId: string,
): Response {
  let pending: Uint8Array[] = [];
  let zipError: Error | null = null;
  let finished = false;
  const zip = new Zip((error, data, final) => {
    if (error) zipError = error;
    else pending.push(data);
    finished = final;
  });
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (pending.length === 0 && !finished) {
          const next = await entries.next();
          if (next.done) zip.end();
          else {
            const entry = new ZipPassThrough(next.value.name);
            zip.add(entry);
            entry.push(strToU8(next.value.content), true);
          }
        }
        if (zipError) throw zipError;
        const chunk = pending.shift();
        if (chunk) controller.enqueue(chunk);
        if (finished && pending.length === 0) controller.close();
      } catch (error) {
        zip.terminate();
        await entries.return(undefined);
        controller.error(error);
      }
    },
    async cancel() {
      pending = [];
      zip.terminate();
      await entries.return(undefined);
    },
  });
  return new Response(body, { headers: {
    ...corsHeaders,
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="briar-memory-${memorySpaceId}.zip"`,
    "Cache-Control": "private, no-store",
  } });
}
