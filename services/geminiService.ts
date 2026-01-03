
import { GoogleGenAI } from "@google/genai";
import { AI_INSTRUCTIONS } from "../constants";
import { SpeakerRole, DebateSide, Argument } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export async function generateDebateResponse(
  topic: string,
  role: SpeakerRole,
  side: DebateSide,
  history: Argument[]
) {
  const historyText = history
    .map(arg => `${arg.side} (${arg.speakerName}): ${arg.text}`)
    .join("\n\n");

  const prompt = `
    Current Debate Topic: ${topic}
    Your Side: ${side}
    Your Role: ${role}
    Instruction: ${AI_INSTRUCTIONS[role]}

    Debate History:
    ${historyText}

    Please provide your argument. Stay in character as a world-class debater.
    Keep your response concise but powerful (around 150-200 words).
    Do not use meta-talk. Just provide the speech.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        temperature: 0.8,
        topP: 0.9,
      }
    });

    return response.text || "I am speechless at the strength of the opposing argument... (Error in AI response)";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "Error connecting to the debate intelligence. Please retry.";
  }
}

export async function generateJudgeVerdict(topic: string, history: Argument[]) {
  const historyText = history
    .map(arg => `[${arg.side}] ${arg.speakerName} (${arg.id}): ${arg.text}`)
    .join("\n\n");

  const prompt = `
    You are the Chief Justice of the High Debate Arena. The debate has concluded.
    Topic: "${topic}"

    Transcript:
    ${historyText}

    Your Task:
    Evaluate the debate fairly and strictly. You must decide who won based on logic, rhetoric, and rebuttal effectiveness.
    
    Output Format (Use Markdown):
    
    ## 🏆 Verdict: [Team Name] Wins
    
    ### 🌟 Star Debater (Who spoke best)
    **Name:** [Name]
    **Reasoning:** [Why were they the best? specific examples]

    ### 📉 Needs Improvement (Who spoke poorly)
    **Name:** [Name]
    **Reasoning:** [What logic was flawed or missed? specific examples]

    ### ⚖️ Final Analysis
    [A concise summary of why the winning team prevailed over the other.]
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview', // Using a smarter model context for judging if available, but flash is good for speed
      contents: prompt,
      config: {
        temperature: 0.7, // Slightly lower temperature for a more analytical judge
      }
    });
    return response.text;
  } catch (error) {
    console.error("Judge Error:", error);
    return "## ⚖️ Procedural Error\nThe judicial council could not reach a verdict due to a connection issue.";
  }
}
