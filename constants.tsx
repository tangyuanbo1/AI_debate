
import { SpeakerRole, Debater } from './types';

export const STUDENT_TEAM: Debater[] = [
  { id: 's1', name: 'Student 1', role: SpeakerRole.FIRST, isAI: false, avatar: 'https://picsum.photos/seed/s1/100/100' },
  { id: 's2', name: 'Student 2', role: SpeakerRole.SECOND, isAI: false, avatar: 'https://picsum.photos/seed/s2/100/100' },
  { id: 's3', name: 'Student 3', role: SpeakerRole.THIRD, isAI: false, avatar: 'https://picsum.photos/seed/s3/100/100' },
];

export const AI_TEAM: Debater[] = [
  { id: 'a1', name: 'AI (Alpha)', role: SpeakerRole.FIRST, isAI: true, avatar: 'https://picsum.photos/seed/a1/100/100' },
  { id: 'a2', name: 'AI (Beta)', role: SpeakerRole.SECOND, isAI: true, avatar: 'https://picsum.photos/seed/a2/100/100' },
  { id: 'a3', name: 'AI (Gamma)', role: SpeakerRole.THIRD, isAI: true, avatar: 'https://picsum.photos/seed/a3/100/100' },
];

export const DEBATE_SEQUENCE = [
  { debater: STUDENT_TEAM[0], label: "Pro 1st: Opening" },
  { debater: AI_TEAM[0], label: "Con 1st: Opening" },
  { debater: STUDENT_TEAM[1], label: "Pro 2nd: Rebuttal" },
  { debater: AI_TEAM[1], label: "Con 2nd: Rebuttal" },
  { debater: STUDENT_TEAM[2], label: "Pro 3rd: Conclusion" },
  { debater: AI_TEAM[2], label: "Con 3rd: Conclusion" },
];

export const AI_INSTRUCTIONS = {
  [SpeakerRole.FIRST]: "You are the 1st speaker. Focus on defining the topic, presenting key logical pillars, and setting a firm foundation for your side. Be formal and structured.",
  [SpeakerRole.SECOND]: "You are the 2nd speaker. Focus on rebutting the opponent's points directly. Use logic and counter-examples to dismantle their arguments. Be sharp and critical.",
  [SpeakerRole.THIRD]: "You are the 3rd speaker. Your job is to summarize the entire debate, weigh the arguments, and show why your side has ultimately won the logic. Be persuasive and high-level.",
};
