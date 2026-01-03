
export enum DebateSide {
  PRO = 'PRO',
  CON = 'CON'
}

export enum SpeakerRole {
  FIRST = '1st Speaker',
  SECOND = '2nd Speaker',
  THIRD = '3rd Speaker'
}

export interface Debater {
  id: string;
  name: string;
  role: SpeakerRole;
  isAI: boolean;
  avatar: string;
}

export interface Argument {
  id: string;
  speakerId: string;
  speakerName: string;
  side: DebateSide;
  text: string;
  timestamp: number;
}

export interface DebateSession {
  topic: string;
  currentTurn: number; // 0 to 5 (S1, A1, S2, A2, S3, A3)
  history: Argument[];
  isStarted: boolean;
}
