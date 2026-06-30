export interface User {
  telegram_id: number;
  username?: string;
  consent_granted: boolean;
  created_at: number;
  last_active: number;
}

export interface Place {
  name: string;
  city: string;
  lat: number;
  lng: number;
  category: string;
}

export interface Group {
  telegram_id: number;
  name: string;
  description: string;
  category: string;
  member_count: number;
}

export interface PersonaChunk {
  user_id: number;
  text: string;
  embedding: number[];
  category: "interest" | "location" | "social" | "sentiment";
  created_at: number;
  decay_weight: number;
}

export interface ExtractionResult {
  intents: string[];
  entities: string[];
  sentiment: string;
  location_hint: string | null;
}
