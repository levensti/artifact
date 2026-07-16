/**
 * Podcast generation: turn a paper into a single-host audio episode.
 *
 * Two provider calls, both against OpenRouter's OpenAI-compatible API:
 *   1. Script — a chat completion with the podcast recipe's system prompt and
 *      the paper in context, producing spoken-word narration (also the
 *      on-screen transcript).
 *   2. Audio — the configured TTS model (`PODCAST_TTS_MODEL`, never hardcoded)
 *      synthesizing that script. The model streams back raw PCM, so we chunk
 *      the script (TTS calls have their own output ceiling), synthesize each
 *      chunk, concatenate the PCM, and wrap it in a single WAV container the
 *      browser can play directly.
 *
 * Like `generate.ts`, this is pure provider I/O — no auth, no DB, no
 * rate-limit metering, no HTTP framing. The route wraps these with per-user key
 * resolution and budget metering (each call returns its raw `usage` so the
 * route can meter both the script and the audio spend).
 */

import { parseApiErrorMessage } from "@/lib/api-utils";
import {
  OPENROUTER_BASE_URL,
  getOpenRouterModel,
  getPodcastTtsModel,
  type OpenRouterUsage,
} from "@/lib/openrouter";
import { fetchWithTimeout } from "@/lib/fetch-timeout";
import { promptFromRecipe } from "@/recipes/types";
import { PODCAST_PROMPTS, podcastRecipe } from "@/recipes/podcast";

const OPENROUTER_CHAT_COMPLETIONS_URL = `${OPENROUTER_BASE_URL}/chat/completions`;
// TTS is a dedicated OpenAI-compatible endpoint — NOT chat/completions. TTS
// models advertise a `text->speech` modality and reject `modalities:["audio"]`
// on chat/completions ("No endpoints found that support ... audio").
const OPENROUTER_SPEECH_URL = `${OPENROUTER_BASE_URL}/audio/speech`;

/**
 * Voice for the TTS model. The speech endpoint requires a voice; we use one
 * fixed prebuilt voice for a consistent host across every episode (not
 * configurable — a single voice keeps the product's sound identity stable).
 */
const TTS_VOICE = "Kore";

/** Script generation returns one whole completion; generous but bounded. */
const SCRIPT_TIMEOUT_MS = 120_000;
/** One TTS chunk. Audio synthesis is slower than text, so allow more headroom. */
const TTS_TIMEOUT_MS = 180_000;

/**
 * Approximate upper bound (characters) of script text sent to the TTS model in
 * one call. TTS models cap their audio output, so a long episode must be split.
 * A character budget is a deliberately rough proxy for that cap — we lack a
 * tokenizer here and erring small only means more (cheap-to-concatenate)
 * chunks, never a truncated call.
 */
const TTS_CHUNK_CHAR_BUDGET = 1_800;

/** PCM format the TTS model emits (Gemini-class TTS: 24 kHz / 16-bit / mono). */
const PCM_SAMPLE_RATE = 24_000;
const PCM_BITS_PER_SAMPLE = 16;
const PCM_CHANNELS = 1;

const SCRIPT_SYSTEM_PROMPT = promptFromRecipe(
  podcastRecipe,
  PODCAST_PROMPTS.script,
);

export interface PodcastScriptParams {
  paperTitle: string;
  /** Full paper text (or the best available summary) for context. */
  paperContext: string;
  /** Optional user steer from the pre-generation dialog. */
  instructions?: string | null;
}

/**
 * Build the messages for the script call: the podcast system prompt with the
 * paper wrapped in a `<paper>` block, and a user turn asking for the episode.
 * A non-empty `instructions` is injected as a clearly fenced, lower-authority
 * listener request so it shapes focus/tone without overriding the format or
 * faithfulness rules.
 */
function buildScriptMessages(params: PodcastScriptParams) {
  const { paperTitle, paperContext, instructions } = params;
  const system =
    `${SCRIPT_SYSTEM_PROMPT}\n\n<paper>\n` +
    (paperTitle ? `<title>${paperTitle}</title>\n` : "") +
    `${paperContext}\n</paper>`;

  const steer = instructions?.trim()
    ? `\n\n<listener_request>\n${instructions.trim()}\n</listener_request>\n` +
      `Honor the listener request where reasonable, but keep the single-host ` +
      `format and stay faithful to the paper.`
    : "";

  return [
    { role: "system", content: system },
    {
      role: "user",
      content:
        `Write the podcast episode script for this paper as instructed.${steer}`,
    },
  ];
}

/**
 * Generate the narration script. Returns the text plus raw provider usage so
 * the route can meter the spend.
 */
export async function generatePodcastScript(
  apiKey: string,
  params: PodcastScriptParams,
): Promise<{ transcript: string; usage?: OpenRouterUsage }> {
  const response = await fetchWithTimeout(
    OPENROUTER_CHAT_COMPLETIONS_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: getOpenRouterModel(),
        messages: buildScriptMessages(params),
      }),
    },
    SCRIPT_TIMEOUT_MS,
  );
  if (!response.ok) throw await parseError(response);

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: OpenRouterUsage;
  };
  const transcript = (data.choices?.[0]?.message?.content ?? "").trim();
  if (!transcript) throw new Error("Podcast script generation returned empty.");
  return { transcript, usage: data.usage };
}

/**
 * Split a script into TTS-sized chunks on natural boundaries (paragraphs, then
 * sentences) so no chunk exceeds the character budget. Never splits mid-word;
 * a single oversized sentence becomes its own chunk rather than being cut.
 */
export function splitScriptForTts(
  script: string,
  budget: number = TTS_CHUNK_CHAR_BUDGET,
): string[] {
  const units = script
    .split(/\n\s*\n/) // paragraphs first
    .flatMap((para) => {
      const p = para.trim();
      if (!p) return [];
      if (p.length <= budget) return [p];
      // Oversized paragraph: fall back to sentence boundaries.
      return p.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g)?.map((s) => s.trim()) ?? [p];
    });

  const chunks: string[] = [];
  let current = "";
  for (const unit of units) {
    if (!current) {
      current = unit;
    } else if (current.length + 1 + unit.length <= budget) {
      current += " " + unit;
    } else {
      chunks.push(current);
      current = unit;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Wrap raw little-endian PCM samples in a 44-byte canonical WAV (RIFF) header
 * so browsers can play the audio directly. No re-encoding — the PCM bytes are
 * copied through verbatim.
 */
export function pcm16ToWav(
  pcm: Buffer,
  sampleRate: number = PCM_SAMPLE_RATE,
  channels: number = PCM_CHANNELS,
  bitsPerSample: number = PCM_BITS_PER_SAMPLE,
): Buffer {
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4); // file size minus 8
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // PCM fmt chunk size
  header.writeUInt16LE(1, 20); // audio format 1 = PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

/** Duration in seconds implied by a PCM byte count at the given format. */
function pcmDurationSec(
  pcmBytes: number,
  sampleRate = PCM_SAMPLE_RATE,
  channels = PCM_CHANNELS,
  bitsPerSample = PCM_BITS_PER_SAMPLE,
): number {
  const bytesPerSecond = sampleRate * channels * (bitsPerSample / 8);
  return bytesPerSecond > 0 ? Math.round(pcmBytes / bytesPerSecond) : 0;
}

/**
 * Synthesize a single chunk via the dedicated speech endpoint, returning its
 * raw PCM bytes. `response_format: "pcm"` (24 kHz / 16-bit / mono for
 * Gemini-class TTS) so chunks concatenate cleanly before one WAV wrap — unlike
 * encoded formats, raw PCM joins without artifacts. The response is a binary
 * byte stream, not JSON, and carries no usage (only the script call is metered).
 */
async function synthesizeChunk(apiKey: string, text: string): Promise<Buffer> {
  const response = await fetchWithTimeout(
    OPENROUTER_SPEECH_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: getPodcastTtsModel(),
        input: text,
        voice: TTS_VOICE,
        response_format: "pcm",
      }),
    },
    TTS_TIMEOUT_MS,
  );
  if (!response.ok) throw await parseError(response);
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Synthesize a full script to a WAV buffer. Chunks are synthesized in order
 * (kept sequential so the audio concatenates in reading order and to stay well
 * under provider rate limits), their PCM concatenated, then WAV-wrapped once.
 */
export async function synthesizeSpeech(
  apiKey: string,
  script: string,
): Promise<{ audio: Buffer; durationSec: number }> {
  const chunks = splitScriptForTts(script);
  const pcmParts: Buffer[] = [];
  for (const chunk of chunks) {
    pcmParts.push(await synthesizeChunk(apiKey, chunk));
  }

  const pcm = Buffer.concat(pcmParts);
  return {
    audio: pcm16ToWav(pcm),
    durationSec: pcmDurationSec(pcm.length),
  };
}

/**
 * End-to-end: script then audio. Returns the transcript, the WAV audio, its
 * duration, and the combined usage of every provider call so the route meters
 * both the script and the synthesis spend.
 */
export async function generatePodcast(
  apiKey: string,
  params: PodcastScriptParams,
): Promise<{
  transcript: string;
  audio: Buffer;
  durationSec: number;
  usages: OpenRouterUsage[];
}> {
  const { transcript, usage } = await generatePodcastScript(apiKey, params);
  const { audio, durationSec } = await synthesizeSpeech(apiKey, transcript);
  // Only the script call reports usage; the speech endpoint returns raw bytes.
  return { transcript, audio, durationSec, usages: usage ? [usage] : [] };
}

async function parseError(response: Response) {
  const errorText = await response.text();
  const fallback = `OpenRouter API error: ${response.status}`;
  return new Error(parseApiErrorMessage(errorText, fallback));
}
