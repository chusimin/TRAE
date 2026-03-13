export interface CheckIn {
  id: string;
  user_id: string;
  score: number;
  summary: string;
  action: string;
  messages: ChatMessage[];
  created_at: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface Memory {
  id: string;
  user_id: string;
  content: string;
  source_checkin_id: string;
  created_at: string;
}

export interface MoodDataPoint {
  date: string;
  score: number;
  summary?: string;
}

export interface CheckInEndData {
  score: number;
  summary: string;
  action: string;
  memory?: string;
  memories?: { content: string; category: string }[];
}

export interface UserProfile {
  id: string;
  nickname: string;
  occupation: string;
  mbti: string;
  zodiac: string;
}
