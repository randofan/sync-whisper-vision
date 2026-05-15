import { useEffect, useMemo, useRef, useState } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { useServerFn } from "@tanstack/react-start";
import { useScholarStore } from "@/lib/scholar/store";
import { buildClientTools } from "@/lib/scholar/agent-tools";
import { getElevenLabsConversationSignedUrl } from "@/lib/elevenlabs.functions";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, Loader2, PhoneOff, Phone } from "lucide-react";
import { toast } from "sonner";

export function buildScholarPrompt(pdf: { name: string; pages: number; text: string }) {
  return `You are "Scholar", a peer-level technical research companion. The user uploaded the PDF "${pdf.name}" (${pdf.pages} pages). Use the extracted paper text below as the primary source of truth.

Speak naturally and concisely. Use client tools early whenever a visual, citation lookup, or deep derivation would help. If the paper text is insufficient, say what is missing.

PAPER CONTENT:
"""
${pdf.text.slice(0, 30_000)}
"""`;
}

export function VoicePanel() {
  return (
    <ConversationProvider>
      <VoicePanelContent />
    </ConversationProvider>
  );
}

function VoicePanelContent() {
  const pdf = useScholarStore((s) => s.pdf);
  const agentId = useScholarStore((s) => s.agentId);
  const appendTranscript = useScholarStore((s) => s.appendTranscript);
  const transcript = useScholarStore((s) => s.transcript);
  const [startRequested, setStartRequested] = useState(false);

  const conversationRef = useRef<ReturnType<typeof useConversation> | null>(null);
  const sentPdfContextRef = useRef<string | null>(null);

  const clientTools = useMemo(
    () =>
      buildClientTools({
        sendContextualUpdate: (text) => {
          conversationRef.current?.sendContextualUpdate(text);
        },
      }),
    [],
  );

  const conversation = useConversation({
    clientTools,
    onConnect: () => {
      setStartRequested(false);
      toast.success("Connected to Scholar");
    },
    onDisconnect: () => {
      setStartRequested(false);
      toast.message("Conversation ended");
    },
    onError: (message, error) => {
      setStartRequested(false);
      console.error("convo error", message, error);
      toast.error(typeof message === "string" ? message : "Voice agent error");
    },
    onMessage: (m: {
      type?: string;
      source?: string;
      message?: string;
      user_transcription_event?: { user_transcript?: string };
      agent_response_event?: { agent_response?: string };
      agent_response_correction_event?: { corrected_agent_response?: string };
    }) => {
      const userText = m.user_transcription_event?.user_transcript;
      const agentText =
        m.agent_response_event?.agent_response ??
        m.agent_response_correction_event?.corrected_agent_response;
      const text = userText ?? agentText ?? m.message;
      if (text) {
        appendTranscript({
          id: `${Date.now()}-${Math.random()}`,
          role: userText || m.source === "user" ? "user" : "agent",
          text,
          ts: Date.now(),
        });
      }
    },
  });
  conversationRef.current = conversation;

  const status = conversation.status;
  const isSpeaking = conversation.isSpeaking;
  const connected = status === "connected";
  const connecting = status === "connecting" || startRequested;

  const fetchSignedUrl = useServerFn(getElevenLabsConversationSignedUrl);

  const start = () => {
    const cleanedAgentId = agentId.trim();
    if (!cleanedAgentId) {
      toast.error("Set an ElevenLabs Agent ID first");
      return;
    }
    setStartRequested(true);
    void (async () => {
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        const { signedUrl } = await fetchSignedUrl({ data: { agentId: cleanedAgentId } });
        await conversation.startSession({
          signedUrl,
          connectionType: "websocket",
          overrides: pdf
            ? {
                agent: {
                  prompt: { prompt: buildScholarPrompt(pdf) },
                  firstMessage: `I've read "${pdf.name}". What would you like to dig into first?`,
                },
              }
            : undefined,
        });
      } catch (err) {
        setStartRequested(false);
        const msg = err instanceof Error ? err.message : "Failed to start";
        toast.error(msg);
      }
    })();
  };

  const stop = async () => {
    await conversation.endSession();
  };

  useEffect(() => {
    if (!connected || !pdf) return;
    if (sentPdfContextRef.current === pdf.name) return;
    sentPdfContextRef.current = pdf.name;
    conversation.sendContextualUpdate(
      `The user uploaded the PDF "${pdf.name}" (${pdf.pages} pages). Use this extracted paper text as the main context for the conversation:\n\n${pdf.text.slice(0, 30_000)}`,
    );
  }, [connected, conversation, pdf]);

  useEffect(() => () => { try { void conversation.endSession(); } catch { /* noop */ } }, []); // eslint-disable-line

  return (
    <div className="flex h-full flex-col">
      {/* Status card */}
      <div className="border-b border-border bg-card/60 p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
              {connected ? (
                <>
                  <span className="pulse-dot inline-block h-2 w-2 rounded-full bg-primary" />
                  Live
                </>
              ) : (
                <>
                  <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/40" />
                  Idle
                </>
              )}
            </div>
            <p className="mt-1 text-sm font-semibold">
              {connected ? (isSpeaking ? "Scholar is speaking" : "Listening…") : "Voice agent"}
            </p>
          </div>

          {connected ? (
            <Button size="sm" variant="destructive" onClick={stop}>
              <PhoneOff className="mr-1.5 h-3.5 w-3.5" /> End
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={start}
              disabled={connecting || !pdf || !agentId.trim()}
              className="ring-glow"
            >
              {connecting ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Phone className="mr-1.5 h-3.5 w-3.5" />
              )}
              {connecting ? "Connecting" : "Start"}
            </Button>
          )}
        </div>

        {connected && (
          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            {isSpeaking ? <Mic className="h-3 w-3 text-primary" /> : <MicOff className="h-3 w-3" />}
            <span>{isSpeaking ? "Agent voice active" : "Mic open — speak naturally"}</span>
          </div>
        )}
      </div>

      {/* Transcript */}
      <div className="scroll-fade-mask flex-1 overflow-y-auto p-4">
        {transcript.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Transcript will appear here as the conversation progresses.
          </p>
        ) : (
          <ul className="space-y-3">
            {transcript.map((t) => (
              <li key={t.id} className="text-xs">
                <div className="mb-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  {t.role === "user" ? "You" : "Scholar"}
                </div>
                <p
                  className={
                    t.role === "user"
                      ? "rounded-md bg-muted/40 p-2 text-foreground"
                      : "rounded-md bg-primary/10 p-2 text-foreground"
                  }
                >
                  {t.text}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
