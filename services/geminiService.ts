
import { GoogleGenAI } from "@google/genai";
import { AI_INSTRUCTIONS } from "../constants";
import { SpeakerRole, DebateSide, Argument } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export async function generateDebateResponseStream(
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

  return await ai.models.generateContentStream({
    model: 'gemini-3-flash-preview',
    contents: prompt,
    config: {
      temperature: 0.8,
      topP: 0.9,
    }
  });
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
    Evaluate the debate fairly and strictly based on logic, rhetoric, and rebuttal effectiveness.
    
    **IMPORTANT: Please output the entire verdict in Simplified Chinese (简体中文).**
    
    Output Format (Use Markdown):
    
    ## 🏆 判决结果: [获胜方队伍名称]
    
    ### 🌟 全场最佳辩手 (MVP)
    **姓名:** [姓名]
    **理由:** [为什么他是最好的？请举例说明]

    ### 📉 待改进之处 (需努力)
    **姓名:** [姓名]
    **理由:** [逻辑漏洞或错失的机会]

    ### ⚖️ 最终深度分析
    [详细分析为什么获胜方赢得了辩论，总结双方的关键交锋点。]
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        temperature: 0.7,
      }
    });
    return response.text;
  } catch (error) {
    console.error("Judge Error:", error);
    return "## ⚖️ 程序错误\n由于连接问题，司法委员会无法达成判决。";
  }
}
