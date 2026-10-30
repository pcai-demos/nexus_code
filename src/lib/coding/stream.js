/**
 * src/lib/coding/stream.js — reading a streamed model reply (Machinery PR 1, design §4 steps 6–7; decision D6).
 *
 * Pure (no I/O). Two wire forms, measured on Ollama 0.33.3 on 2026-10-06
 * (inputs/demo-design/evidence/machinery-pr1-design/stream_probe_out.txt):
 *   - OpenAI-compatible (`text/event-stream`): `data: {json}` lines and a final `data: [DONE]`; each delta carries
 *     `content` and, while the model thinks, `reasoning` (some engines name it `reasoning_content`); one frame
 *     carries `finish_reason`; a usage frame carries `usage` when `stream_options.include_usage` was sent.
 *   - Ollama's own `/api/chat` (`application/x-ndjson`): one JSON object per line with `message.content` and, while
 *     thinking, `message.thinking`; the last line has `done: true`, `done_reason`, `prompt_eval_count`, `eval_count`.
 *
 * createStreamFold(form) reads lines as they arrive (returning each line's content / reasoning delta for the caller to
 * forward) and rebuilds the NON-streamed reply that form's provider would have sent, so the frozen
 * readGenerationOutcome (src/lib/rag/generation.js) reads a streamed turn exactly as it reads a JSON one: the same
 * finish reason, the same answer / reasoning split, the same provider-reported usage.
 */

const STREAM_FORMS = Object.freeze({ OPENAI: "openai-compatible", OLLAMA: "ollama-native" });

/** Split a growing buffer into complete lines: `{ lines, rest }` (a trailing partial line stays in `rest`). */
function splitLines(buffer) {
  const text = String(buffer || "");
  const parts = text.split(/\r?\n/);
  const rest = parts.pop();
  return { lines: parts, rest: rest === undefined ? "" : rest };
}

const str = (v) => (typeof v === "string" ? v : "");
const count = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function createStreamFold(form) {
  if (form !== STREAM_FORMS.OPENAI && form !== STREAM_FORMS.OLLAMA) throw new Error(`createStreamFold: unknown form ${form}`);
  const state = {
    form,
    content: "",
    reasoning: "",
    finishReason: null,
    usage: null,
    promptEvalCount: null,
    evalCount: null,
    done: false,
    frames: 0,
    errors: [],
  };

  /** One wire line → `{ content, reasoning, done }` (deltas), or null for a line that carries nothing. */
  function pushLine(rawLine) {
    const line = String(rawLine || "").trim();
    if (!line) return null;
    if (form === STREAM_FORMS.OPENAI) {
      if (!line.startsWith("data:")) return null; // comments, event names, keep-alives
      const data = line.slice(5).trim();
      if (data === "[DONE]") {
        state.done = true;
        return { content: "", reasoning: "", done: true };
      }
      let j;
      try {
        j = JSON.parse(data);
      } catch {
        state.errors.push("an unreadable stream frame");
        return null;
      }
      state.frames += 1;
      if (j && j.error) state.errors.push(typeof j.error === "string" ? j.error : str(j.error.message) || "the provider reported an error");
      const choice = j && Array.isArray(j.choices) && j.choices[0] && typeof j.choices[0] === "object" ? j.choices[0] : null;
      const delta = choice && choice.delta && typeof choice.delta === "object" ? choice.delta : {};
      const content = str(delta.content);
      const reasoning = str(delta.reasoning) || str(delta.reasoning_content);
      if (choice && typeof choice.finish_reason === "string") state.finishReason = choice.finish_reason;
      if (j && j.usage && typeof j.usage === "object") state.usage = j.usage;
      state.content += content;
      state.reasoning += reasoning;
      return { content, reasoning, done: false };
    }
    let j;
    try {
      j = JSON.parse(line);
    } catch {
      state.errors.push("an unreadable stream line");
      return null;
    }
    state.frames += 1;
    if (j && j.error) state.errors.push(typeof j.error === "string" ? j.error : "the provider reported an error");
    const m = j && j.message && typeof j.message === "object" ? j.message : {};
    const content = str(m.content);
    const reasoning = str(m.thinking);
    state.content += content;
    state.reasoning += reasoning;
    if (j && j.done === true) {
      state.done = true;
      state.finishReason = typeof j.done_reason === "string" ? j.done_reason : null;
      state.promptEvalCount = count(j.prompt_eval_count);
      state.evalCount = count(j.eval_count);
    }
    return { content, reasoning, done: Boolean(j && j.done === true) };
  }

  /** The non-streamed reply the provider would have sent, for readGenerationOutcome. */
  function reply() {
    if (form === STREAM_FORMS.OPENAI) {
      const message = { role: "assistant", content: state.content };
      if (state.reasoning) message.reasoning = state.reasoning;
      return {
        object: "chat.completion",
        choices: [{ index: 0, message, finish_reason: state.finishReason }],
        ...(state.usage ? { usage: state.usage } : {}),
      };
    }
    const message = { role: "assistant", content: state.content };
    if (state.reasoning) message.thinking = state.reasoning;
    return {
      message,
      done: state.done,
      done_reason: state.finishReason,
      ...(state.promptEvalCount !== null ? { prompt_eval_count: state.promptEvalCount } : {}),
      ...(state.evalCount !== null ? { eval_count: state.evalCount } : {}),
    };
  }

  return { pushLine, reply, state };
}

/** Fold a whole stream body held in memory (tests and replays): every line through one fold. */
function foldStreamText(form, text) {
  const fold = createStreamFold(form);
  const { lines, rest } = splitLines(text);
  for (const l of lines) fold.pushLine(l);
  if (rest) fold.pushLine(rest);
  return fold;
}

module.exports = { STREAM_FORMS, splitLines, createStreamFold, foldStreamText };
