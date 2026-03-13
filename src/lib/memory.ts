import { supabaseAdmin } from "./supabase-server";

export interface MemoryEntry {
  content: string;
  category: "event" | "person" | "emotion_pattern";
  daysAgo?: number;
}

/**
 * Get recent memories for a user, formatted with time context
 */
export async function getRecentMemories(userId: string): Promise<MemoryEntry[]> {
  const { data } = await supabaseAdmin
    .from("memories")
    .select("content, category, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(10);

  if (!data) return [];

  const now = new Date();
  return data.map((m) => ({
    content: m.content,
    category: m.category,
    daysAgo: Math.floor(
      (now.getTime() - new Date(m.created_at).getTime()) / 86400000
    ),
  }));
}

/**
 * Save multiple memory entries from a check-in
 */
export async function saveMemories(
  userId: string,
  memories: { content: string; category: string }[],
  sourceCheckinId?: string
): Promise<void> {
  if (!memories.length) return;

  const rows = memories
    .filter((m) => m.content.trim())
    .map((m) => ({
      user_id: userId,
      content: m.content.trim(),
      category: m.category || "event",
      source_checkin_id: sourceCheckinId || null,
    }));

  if (rows.length === 0) return;

  await supabaseAdmin.from("memories").insert(rows);
}

/**
 * Format memories for injection into system prompt
 */
export function formatMemoriesForPrompt(memories: MemoryEntry[]): string {
  if (memories.length === 0) return "";

  const lines = memories.map((m) => {
    const timeLabel =
      m.daysAgo === 0
        ? "今天"
        : m.daysAgo === 1
        ? "昨天"
        : `${m.daysAgo}天前`;

    const categoryIcon =
      m.category === "person"
        ? "👤"
        : m.category === "emotion_pattern"
        ? "💭"
        : "📌";

    return `${categoryIcon} (${timeLabel}) ${m.content}`;
  });

  return `\n\n[MEMORY]
以下是这位用户之前签到时的关键记忆。请像一个记性很好的老朋友一样自然引用，不要说"根据记录"或"上次你提到"这种生硬的话，而是像本来就记得一样：
${lines.join("\n")}
[/MEMORY]`;
}
