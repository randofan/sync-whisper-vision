import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/setup")({
  component: SetupPage,
  head: () => ({ meta: [{ title: "Agent setup · Multimodal Scholar" }] }),
});

const VISUALIZE_SCHEMA = `{
  "name": "visualize",
  "description": "Generate a chart, math derivation, diagram, table, or callout on the user's canvas. Returns instantly; the actual visual streams in via a contextual update a few seconds later. Call frequently — whenever you mention numbers, formulas, architectures, or comparisons.",
  "parameters": {
    "type": "object",
    "properties": {
      "topic": { "type": "string", "description": "What to visualize, e.g. 'Simulated annealing energy landscape'" },
      "hint":  { "type": "string", "description": "Optional preferred form: 'line chart', 'flow diagram', 'derivation', etc." }
    },
    "required": ["topic"]
  }
}`;

const RESEARCH_SCHEMA = `{
  "name": "research",
  "description": "Fire a background web + citation search. Returns instantly; findings stream back via contextual update. Use whenever the answer is outside the paper.",
  "parameters": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "Search query, e.g. 'recent applications of simulated annealing in protein folding'" },
      "scope": { "type": "string", "enum": ["web", "citations", "both"], "description": "Optional source scope" }
    },
    "required": ["query"]
  }
}`;

const DEEP_THINK_SCHEMA = `{
  "name": "deep_think",
  "description": "Heavy reasoning over the full paper for derivations, proofs, or multi-step analysis. Returns instantly; the analysis streams back via contextual update.",
  "parameters": {
    "type": "object",
    "properties": {
      "question": { "type": "string", "description": "The reasoning task or question" }
    },
    "required": ["question"]
  }
}`;

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-border bg-card p-3 text-xs leading-relaxed">
      <code>{children}</code>
    </pre>
  );
}

function SetupPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <Link
        to="/"
        className="mb-6 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" /> Back
      </Link>
      <h1 className="text-3xl font-semibold tracking-tight">ElevenLabs agent setup</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        One-time configuration in your ElevenLabs dashboard.
      </p>

      <ol className="mt-8 space-y-8 text-sm">
        <li>
          <h2 className="font-semibold text-base">1. Create an agent</h2>
          <p className="mt-1 text-muted-foreground">
            In{" "}
            <a
              href="https://elevenlabs.io/app/conversational-ai"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-primary"
            >
              ElevenLabs Conversational AI
            </a>
            , create a new agent. Pick any voice. The system prompt and first message are
            overridden at runtime — you can leave defaults.
          </p>
        </li>

        <li>
          <h2 className="font-semibold text-base">2. Enable overrides</h2>
          <p className="mt-1 text-muted-foreground">
            Under <em>Security → Overrides</em>, enable <strong>System prompt</strong> and{" "}
            <strong>First message</strong>.
          </p>
        </li>

        <li>
          <h2 className="font-semibold text-base">3. Add three client tools</h2>
          <p className="mt-1 text-muted-foreground">
            Under <em>Tools</em>, add a <strong>Client tool</strong> for each of the following
            (paste the JSON when prompted, or fill the fields manually):
          </p>

          <div className="mt-4 space-y-4">
            <div>
              <p className="mb-1.5 text-xs uppercase tracking-wider text-primary">visualize</p>
              <CodeBlock>{VISUALIZE_SCHEMA}</CodeBlock>
            </div>
            <div>
              <p className="mb-1.5 text-xs uppercase tracking-wider text-primary">research</p>
              <CodeBlock>{RESEARCH_SCHEMA}</CodeBlock>
            </div>
            <div>
              <p className="mb-1.5 text-xs uppercase tracking-wider text-primary">deep_think</p>
              <CodeBlock>{DEEP_THINK_SCHEMA}</CodeBlock>
            </div>
          </div>
        </li>

        <li>
          <h2 className="font-semibold text-base">4. Copy the Agent ID</h2>
          <p className="mt-1 text-muted-foreground">
            From the agent overview page, copy the <strong>Agent ID</strong> and paste it on the
            home page. Then upload your PDF and click <em>Start</em>.
          </p>
        </li>
      </ol>
    </div>
  );
}
