
## Multimodal Scholar — build plan

A research assistant where the user uploads a PDF and talks to an ElevenLabs voice agent. While speaking, the agent delegates visualizations and slow research to background subagents that stream results into a shared canvas without blocking the conversation.

### Architecture (3-tier)

```
 ┌──────────────┐    client tools     ┌────────────────────┐
 │  Voice Agent │ ──────────────────► │  Frontend Bus      │
 │ (ElevenLabs) │ ◄────────────────── │ (Zustand store +   │
 └──────────────┘   contextual update │  event emitter)    │
                                      └─────────┬──────────┘
                                                │ fetch (non-blocking)
                                ┌───────────────┼────────────────┐
                                ▼               ▼                ▼
                       /api/illustrate   /api/research    /api/pdf-context
                       (Gemini Flash →   (gpt-5.4 +       (full-PDF Q&A,
                        A2UI JSON spec)  Perplexity +     citation lookup)
                                         arXiv/Crossref)
```

The voice agent never waits on heavy work. It fires a client tool, immediately keeps talking, and the result is pushed back into the conversation later via `sendContextualUpdate`.

### Stack

- TanStack Start (existing). Server routes under `src/routes/api/*`.
- ElevenLabs `@elevenlabs/react` `useConversation` (WebRTC) with server-minted token.
- Lovable AI Gateway (Vercel AI SDK) for PDF QA, illustration spec, research synthesis.
- Perplexity (sonar-reasoning) for grounded web search; arXiv + Crossref (no key) for citations.
- pdfjs-dist for in-browser PDF text extraction (session-only, no DB).
- Zustand for the cross-component event bus / canvas state.
- Recharts + KaTeX + Mermaid for rendered visualizations from the A2UI JSON spec.

### Secrets needed

- `ELEVENLABS_API_KEY` (request via add_secret)
- `PERPLEXITY_API_KEY` (request via add_secret — recommend connector)
- `LOVABLE_API_KEY` (auto-provisioned when Lovable AI is enabled)

### Routes / files

Server routes (`src/routes/api/`):
- `elevenlabs-token.ts` — POST, mints WebRTC conversation token. Accepts `{ agentId, pdfText, pdfTitle }` and returns `{ token }` plus a system-prompt override built from the PDF (sent back so client passes via `overrides`).
- `illustrate.ts` — POST `{ topic, context }` → returns A2UI JSON: `{ kind: 'chart'|'math'|'diagram'|'table'|'callout', spec, narration }`. Uses Gemini 3 Flash with structured output (Zod schema).
- `research.ts` — POST `{ query, pdfExcerpt }` → calls Perplexity (sonar-reasoning) + arXiv search in parallel, synthesizes via gpt-5.4-mini → `{ summary, citations[], sourceUrls[] }`.
- `pdf-qa.ts` — POST `{ question, pdfText }` → deep gpt-5.4 reasoning over full paper for math/derivations.

Frontend:
- `src/routes/index.tsx` — landing/upload + agent ID input.
- `src/routes/session.tsx` — main 3-pane workspace.
- `src/components/scholar/PdfDropzone.tsx` — file input, parses with pdfjs in a worker.
- `src/components/scholar/VoicePanel.tsx` — start/stop, status, mic VU meter, transcript stream.
- `src/components/scholar/CanvasPane.tsx` — renders the queue of A2UI cards (charts, math, diagrams) with subtle entrance animations.
- `src/components/scholar/ResearchFeed.tsx` — streamed research findings + citations.
- `src/components/scholar/TranscriptLog.tsx` — collapsible conversation log.
- `src/components/scholar/a2ui/` — `ChartCard`, `MathCard` (KaTeX), `DiagramCard` (Mermaid), `TableCard`, `CitationCard`.
- `src/lib/scholar/store.ts` — Zustand: `pdf`, `canvasItems`, `researchItems`, `transcript`, `pendingTasks`.
- `src/lib/scholar/agent-tools.ts` — wires `useConversation` `clientTools` to the bus (see below).
- `src/lib/scholar/pdf.ts` — pdfjs extraction.

### The 3 client tools (configured in ElevenLabs agent UI)

User must create these in the ElevenLabs dashboard for the agent — I'll provide exact JSON specs:

1. `visualize` — params `{ topic: string, hint?: string }`. Frontend handler: fires `/api/illustrate` (don't await), returns `"Generating visual now"` to the agent immediately. When the response arrives, push to canvas store + call `conversation.sendContextualUpdate("Visual ready: <one-line summary>")` so the agent can reference it.
2. `research` — params `{ query: string, scope?: 'web'|'citations'|'both' }`. Same fire-and-forget pattern → `/api/research`. On result: push to ResearchFeed and `sendContextualUpdate` with a 2-sentence summary + top citation.
3. `deep_think` — params `{ question: string }`. Fires `/api/pdf-qa` for heavy reasoning/math. Result streams back the same way.

This is what makes the workflow non-blocking: tool returns to the agent in <50ms ("on it"), real work continues in parallel, and findings re-enter context as contextual updates.

### PDF handling

- Parse client-side with pdfjs-dist → plain text + page map.
- Cap at ~250k chars (fits Gemini context). Store in Zustand only.
- Pass full text to `/api/elevenlabs-token` so the agent's system prompt is overridden with the paper as primary source of truth.
- For very long papers, the `deep_think` tool gets the full text server-side per call.

### UI layout (researcher-focused, dark, dense)

```
┌─────────────────────────────────────────────────────┐
│  Header: paper title · session timer · end call     │
├──────────────┬───────────────────────┬──────────────┤
│              │                       │              │
│  Voice       │   Canvas (A2UI)       │  Research    │
│  Panel       │   - chart cards       │  Feed        │
│  + transcript│   - math derivations  │  + citations │
│  + waveform  │   - diagrams          │              │
│              │   newest on top       │              │
└──────────────┴───────────────────────┴──────────────┘
```

Cards animate in (slide+fade) so the user sees the moment new context lands. Each card carries a subtle "Agent referenced this at 0:42" timestamp.

### Latency tactics

- WebRTC connection (lower latency than WS).
- Tool handlers return immediately; never await.
- Illustration uses `gemini-3-flash-preview` (fast); research synthesis uses `gpt-5.4-mini`; only `deep_think` uses `gpt-5.4`.
- Streamed responses where supported; otherwise progressive `sendContextualUpdate` chunks.

### Setup the user must do

1. Create an ElevenLabs agent and add the 3 client tools above (I'll provide the JSON to paste).
2. Enable "Tool calls" + "Conversation overrides (system prompt, first message)" in agent settings.
3. Provide ELEVENLABS_API_KEY and PERPLEXITY_API_KEY when prompted.
4. Lovable Cloud is **not** required (session-only, no auth). Lovable AI gateway will be auto-enabled.

### Out of scope (per your choices)

- No auth, no DB, no file storage. Refresh = new session.
- No RAG / embeddings. Full-PDF context only.

### Build order

1. Enable Lovable AI; request ELEVENLABS_API_KEY + PERPLEXITY_API_KEY.
2. Install deps: `@elevenlabs/react`, `ai`, `@ai-sdk/openai-compatible`, `zod`, `zustand`, `pdfjs-dist`, `katex`, `react-katex`, `mermaid`, `recharts`.
3. Build store + PDF parser + landing page upload flow.
4. Build server routes (token, illustrate, research, pdf-qa).
5. Build session workspace + voice panel + canvas + research feed.
6. Wire client tools, test fire-and-forget + contextual updates.
7. Provide ElevenLabs agent config JSON to paste into the dashboard.
