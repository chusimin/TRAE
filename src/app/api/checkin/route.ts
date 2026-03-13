import { supabaseAdmin } from "@/lib/supabase-server";
import { saveMemories } from "@/lib/memory";

export async function POST(req: Request) {
  const { userId, score, summary, action, memory, memories, conversation } =
    await req.json();

  if (!userId || !score) {
    return Response.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Save check-in record
  const { data, error } = await supabaseAdmin
    .from("check_ins")
    .insert({
      user_id: userId,
      score,
      summary: summary || "",
      action: action || "",
      memory: memory || "",
      conversation: conversation || [],
    })
    .select("id")
    .single();

  if (error) {
    console.error("Check-in save error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }

  // Save individual memory entries
  const memoryEntries = memories && Array.isArray(memories) ? memories : [];

  // Fallback: if only legacy single memory string, convert to entry
  if (memoryEntries.length === 0 && memory) {
    memoryEntries.push({ content: memory, category: "event" });
  }

  if (memoryEntries.length > 0) {
    await saveMemories(userId, memoryEntries, data.id);
  }

  return Response.json({ id: data.id });
}
