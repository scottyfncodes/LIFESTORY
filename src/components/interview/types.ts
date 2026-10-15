export type WorkspaceTurn = {
  id: string;
  sequenceNumber: number;
  speaker: "interviewer" | "narrator" | "system";
  inputMode: "text" | "voice" | "generated";
  originalText: string;
  correctedText: string | null;
  skipped: boolean;
  createdAt: string;
  processingStatus: string | null;
  media: Array<{ id: string; processingStatus: string; durationSeconds: number | null; deleted: boolean }>;
  /** Client-only: an answer that has not been confirmed by the server yet. */
  pending?: boolean;
};

export type Capabilities = {
  ai: boolean;
  transcription: boolean;
  storage: boolean;
  maxRecordingSeconds: number;
};

export type SessionInfo = {
  id: string;
  status: "active" | "paused" | "completed" | "abandoned";
  startedAt: string;
};
