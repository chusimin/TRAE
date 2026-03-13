"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ChatMessage } from "@/components/ChatMessage";
import { ChatInput } from "@/components/ChatInput";
import { MoodScoreSlider } from "@/components/MoodScoreSlider";
import { MicroActionCard } from "@/components/MicroActionCard";
import { useAuth } from "@/components/AuthProvider";
import type { CheckInEndData } from "@/types";

interface DisplayMessage {
  role: "user" | "assistant";
  content: string;
  thinking?: string;
}

function parseCheckInEnd(text: string): CheckInEndData | null {
  const match = text.match(/<!--CHECKIN_END:([\s\S]*?)-->/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

// Extract thinking content from <!--T:...--> markers
function extractThinking(raw: string): { content: string; thinking: string } {
  let thinking = "";
  const content = raw.replace(/<!--T:([\s\S]*?)-->/g, (_, t) => {
    thinking += t;
    return "";
  });
  return { content, thinking };
}

// Hidden trigger message sent to API but not shown in UI
const TRIGGER_MSG = { role: "user" as const, content: "（用户打开了签到页面）" };

// Compress old messages into a summary when conversation gets long
const MAX_ROUNDS_BEFORE_COMPRESS = 30;

function compressHistory(
  history: { role: string; content: string }[]
): { role: string; content: string }[] {
  // Count user messages (rounds)
  const userMsgCount = history.filter((m) => m.role === "user").length;
  if (userMsgCount < MAX_ROUNDS_BEFORE_COMPRESS) return history;

  // Keep the trigger message + first exchange, compress middle, keep last 10 messages
  const keepRecent = 20; // last 10 rounds = 20 messages
  const toCompress = history.slice(1, history.length - keepRecent);
  const recent = history.slice(history.length - keepRecent);

  // Build summary of compressed messages
  const summaryParts = toCompress
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .slice(0, 10);

  const compressionMsg = {
    role: "system" as const,
    content: `[以下是之前对话的摘要：用户聊到了这些话题：${summaryParts.join("；")}。请基于这些上下文继续对话。]`,
  };

  return [history[0], compressionMsg, ...recent];
}

export default function ChatPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showScoring, setShowScoring] = useState(false);
  const [scored, setScored] = useState(false);
  const [confirmedScore, setConfirmedScore] = useState<number | null>(null);
  const [checkInData, setCheckInData] = useState<CheckInEndData | null>(null);
  const [streamingThinking, setStreamingThinking] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const hasInitRef = useRef(false);
  const fullHistoryRef = useRef<{ role: string; content: string }[]>([TRIGGER_MSG]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, showScoring, scored, streamingThinking]);

  const streamAIResponse = useCallback(async (apiMessages: { role: string; content: string }[]) => {
    setIsLoading(true);
    setStreamingThinking("");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: apiMessages.map((m) => ({ role: m.role, content: m.content })),
          userId: user?.id || null,
          userName: user?.user_metadata?.full_name || "",
        }),
      });

      if (!res.ok) throw new Error(`API error: ${res.status}`);

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No reader");

      const decoder = new TextDecoder();
      let rawText = "";

      // Add empty assistant message for streaming
      setMessages((prev) => [...prev, { role: "assistant", content: "", thinking: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        rawText += chunk;

        const { content, thinking } = extractThinking(rawText);
        setStreamingThinking(thinking);

        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: "assistant",
            content,
            thinking,
          };
          return updated;
        });
      }

      // Finalize
      const { content: finalContent, thinking: finalThinking } = extractThinking(rawText);
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: "assistant",
          content: finalContent,
          thinking: finalThinking,
        };
        return updated;
      });
      setStreamingThinking("");

      // Update full history (content only, no thinking markers)
      fullHistoryRef.current = [
        ...apiMessages,
        { role: "assistant", content: finalContent },
      ];

      // Check for CHECKIN_END signal
      const endData = parseCheckInEnd(finalContent);
      if (endData) {
        setCheckInData(endData);
        setTimeout(() => setShowScoring(true), 500);
      }
    } catch (error) {
      console.error("Chat error:", error);
      const errorMsg: DisplayMessage = {
        role: "assistant",
        content: "抱歉，我走神了一下。可以再跟我说一次吗？",
      };
      setMessages((prev) => [...prev, errorMsg]);
      fullHistoryRef.current = [...apiMessages, { role: "assistant", content: errorMsg.content }];
    } finally {
      setIsLoading(false);
      setStreamingThinking("");
    }
  }, []);

  // Initialize
  useEffect(() => {
    if (hasInitRef.current) return;
    hasInitRef.current = true;
    streamAIResponse([TRIGGER_MSG]);
  }, [streamAIResponse]);

  const handleSend = (content: string) => {
    const userMsg: DisplayMessage = { role: "user", content };
    setMessages((prev) => [...prev, userMsg]);
    const apiMessages = compressHistory([...fullHistoryRef.current, { role: "user", content }]);
    streamAIResponse(apiMessages);
  };

  const handleScoreConfirm = async (score: number) => {
    setConfirmedScore(score);
    setScored(true);
    setShowScoring(false);

    // Save check-in to Supabase
    if (user && checkInData) {
      try {
        const conversation = messages
          .filter((m) => m.content)
          .map((m) => ({ role: m.role, content: m.content }));

        await fetch("/api/checkin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: user.id,
            score,
            summary: checkInData.summary,
            action: checkInData.action,
            memory: checkInData.memory,
            memories: checkInData.memories,
            conversation,
          }),
        });
      } catch (err) {
        console.error("Failed to save check-in:", err);
      }
    }

    const followUp: DisplayMessage = {
      role: "assistant",
      content: "好的，今天的签到完成了。如果你还想继续聊聊，我一直都在。想结束的话可以随时点返回。",
    };
    setMessages((prev) => [...prev, followUp]);
    fullHistoryRef.current = [...fullHistoryRef.current, { role: "assistant", content: followUp.content }];
  };

  const userRounds = messages.filter((m) => m.role === "user").length;
  const lastMsg = messages[messages.length - 1];
  const isStreamingEmpty = isLoading && lastMsg?.role === "assistant" && !lastMsg.content;

  return (
    <div className="flex flex-col h-screen bg-[var(--yj-bg-primary)] pb-14">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-[var(--yj-divider)] bg-[var(--yj-bg-secondary)]">
        <h1 className="text-base font-medium text-[var(--yj-text-primary)]">
          {scored ? "对话" : "今日签到"}
        </h1>
        {confirmedScore !== null ? (
          <span className="ml-auto text-xs text-[var(--yj-success)] font-medium">
            已签到 · {confirmedScore}分
          </span>
        ) : (
          <span className="ml-auto text-xs text-[var(--yj-text-muted)]">
            {userRounds}/5轮
          </span>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-6">
        {messages.map((msg, i) => (
          <ChatMessage
            key={i}
            role={msg.role}
            content={msg.content}
            thinking={msg.thinking}
            isStreaming={isLoading && i === messages.length - 1}
          />
        ))}

        {/* Initial loading (no messages yet) */}
        {isLoading && messages.length === 0 && (
          <div className="flex justify-start mb-4">
            <div className="bg-[var(--yj-bg-secondary)] border border-[var(--yj-border)] rounded-[4px_20px_20px_20px] px-5 py-4 shadow-[var(--yj-shadow-sm)]">
              <span className="text-sm text-[var(--yj-text-muted)] animate-pulse">
                正在思考...
              </span>
            </div>
          </div>
        )}

        {/* Scoring UI */}
        {showScoring && !scored && checkInData && (
          <div className="space-y-4 mt-6">
            <MoodScoreSlider
              suggestedScore={checkInData.score}
              onConfirm={handleScoreConfirm}
            />
            <MicroActionCard action={checkInData.action} />
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      {!showScoring && (
        <ChatInput
          onSend={handleSend}
          disabled={isLoading}
          placeholder={
            scored ? "想继续聊聊也可以..." : "说说你现在的感受..."
          }
        />
      )}
    </div>
  );
}
