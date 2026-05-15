import { useEffect, useMemo, useRef, useState } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { useScholarStore } from "@/lib/scholar/store";
import { buildClientTools } from "@/lib/scholar/agent-tools";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, Loader2, PhoneOff, Phone } from "lucide-react";
import { toast } from "sonner";

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
  const [starting, setStarting] = useState(false);

  const conversationRef = useRef<ReturnType<typeof useConversation> | null>(null);

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
    onConnect: () => toast.success("Connected to Scholar"),
    onDisconnect: () => toast.message("Conversation ended"),
    onError: (err) => {
      console.error("convo error", err);
      toast.error("Voice agent error");
    },
    onMessage: (m: { source?: string; message?: string }) => {
      if (m?.message) {
        appendTranscript({
          id: `${Date.now()}-${Math.random()}`,
          role: m.source === "user" ? "user" : "agent",
          text: m.message,
          ts: Date.now(),
        });
      }
    },
  });
  conversationRef.current = conversation;

  const status = conversation.status;
  const isSpeaking = conversation.isSpeaking;
  const connected = status === "connected";

  const start = async () => {
    if (!agentId) {
      toast.error("Set an ElevenLabs Agent ID first");
      return;
    }
    setStarting(true);
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const tokenRes = await fetch("/api/elevenlabs-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId,
          pdfTitle: pdf?.name ?? "Untitled paper",
          pdfText: pdf?.text ?? "",
        }),
      });
      const tokenJson = (await tokenRes.json()) as {
        token?: string;
        systemPrompt?: string;
        firstMessage?: string;
        error?: string;
      };
      if (!tokenJson.token) throw new Error(tokenJson.error ?? "token failed");

      await conversation.startSession({
        conversationToken: tokenJson.token,
        connectionType: "webrtc",
        overrides: {
          agent: {
            prompt: tokenJson.systemPrompt ? { prompt: tokenJson.systemPrompt } : undefined,
            firstMessage: tokenJson.firstMessage,
          },
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to start";
      toast.error(msg);
    } finally {
      setStarting(false);
    }
  };

  const stop = async () => {
    await conversation.endSession();
  };

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
              disabled={starting || !pdf || !agentId}
              className="ring-glow"
            >
              {starting ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Phone className="mr-1.5 h-3.5 w-3.5" />
              )}
              Start
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
