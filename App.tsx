
import React, { useState, useEffect, useMemo, useRef } from 'react';
import ReactMarkdown from 'react-markdown'; 

import { STUDENT_TEAM, AI_TEAM, DEBATE_SEQUENCE } from './constants';
import { DebateSession, Argument, DebateSide } from './types';
import { generateDebateResponseStream, generateJudgeVerdict, transcribeAudio } from './services/qwenService';
import DebaterCard from './components/DebaterCard';

const App: React.FC = () => {
  type Language = 'zh-CN' | 'en-US';
  const [lang, setLang] = useState<Language>(() => {
    const saved = window.localStorage.getItem('lang');
    return saved === 'en-US' || saved === 'zh-CN' ? saved : 'en-US';
  });

  useEffect(() => {
    window.localStorage.setItem('lang', lang);
  }, [lang]);

  const t = useMemo(() => {
    const dict: Record<Language, Record<string, string>> = {
      'zh-CN': {
        appTitle: '课堂辩论',
        appSubtitle: '人类 vs 人工智能',
        debateTopicLabel: '辩题',
        debateTopicPlaceholder: '例如：社交媒体平台是否应该为打击假新闻负责？',
        teamHumans: '人类队（正方）',
        teamAI: 'AI队（反方）',
        opening: '开篇陈词',
        rebuttal: '反驳',
        conclusion: '总结',
        enterArena: '进入辩论场',
        status: '状态',
        live: '进行中',
        reset: '重置',
        waitingOpening: '等待 {name} 的开篇陈词…',
        debateConcluded: '辩论结束',
        timeForJudgment: '双方陈词已完毕，现在进入裁决。',
        callForVerdict: '请求判决',
        judgeThinking: '首席法官正在审阅逐字稿…',
        sessionClosed: '本场已结束',
        verdictDelivered: '判决已发布。',
        startNewDebate: '开始新辩题',
        currentPhase: '当前阶段：',
        turnOf: '回合 {cur}/{total}',
        markdownSupported: '支持 Markdown',
        sendArgument: '发送观点',
        aiSynthesizing: '{name} 正在组织反驳…',
        judgeUnavailable: '裁判暂不可用。',
        micNoAccess: '无法访问麦克风，请检查权限设置。',
        transcriptionFailed: '语音转写失败，请重试。',
        stopRecording: '停止录音',
        clickToRecord: '点击录音',
        recording: '录音中…',
        transcribing: '转写中…',
        verdictTitle: '首席法官判词',
        verdictSubtitle: '最终评估与评分',
        debateArena: '辩论竞技场',
      },
      'en-US': {
        appTitle: 'Classroom Debate',
        appSubtitle: 'Humans vs. Artificial Intelligence',
        debateTopicLabel: 'Debate Topic',
        debateTopicPlaceholder: 'e.g., Should social media platforms be responsible for policing fake news?',
        teamHumans: 'Team Humans (Pro)',
        teamAI: 'Team AI (Con)',
        opening: 'Opening',
        rebuttal: 'Rebuttal',
        conclusion: 'Conclusion',
        enterArena: 'Enter the Arena',
        status: 'Status',
        live: 'Live',
        reset: 'Reset',
        waitingOpening: 'Waiting for the opening statement from {name}...',
        debateConcluded: 'Debate Concluded',
        timeForJudgment: 'The speakers have rested their cases. It is time for judgment.',
        callForVerdict: 'Call for Verdict',
        judgeThinking: 'The Chief Justice is reviewing the transcript...',
        sessionClosed: 'Session Closed',
        verdictDelivered: 'The verdict has been delivered.',
        startNewDebate: 'Start New Debate',
        currentPhase: 'Current Phase: ',
        turnOf: 'Turn {cur} of {total}',
        markdownSupported: 'Markdown supported',
        sendArgument: 'Send Argument',
        aiSynthesizing: '{name} is synthesizing counter-arguments...',
        judgeUnavailable: 'Judge unavailable.',
        micNoAccess: 'Cannot access microphone. Please check permissions.',
        transcriptionFailed: 'Transcription failed. Please try again.',
        stopRecording: 'Stop recording',
        clickToRecord: 'Click to record voice',
        recording: 'Recording...',
        transcribing: 'Transcribing...',
        verdictTitle: 'Chief Justice Verdict',
        verdictSubtitle: 'Final Evaluation & Scoring',
        debateArena: 'Debate Arena',
      },
    };

    const tr = (key: string, vars?: Record<string, string | number>) => {
      const template = dict[lang][key] ?? key;
      if (!vars) return template;
      return Object.keys(vars).reduce((acc, k) => acc.replaceAll(`{${k}}`, String(vars[k])), template);
    };

    return tr;
  }, [lang]);

  const [session, setSession] = useState<DebateSession>({
    topic: '',
    currentTurn: 0,
    history: [],
    isStarted: false,
  });

  // Knowledge Base (minimal UI)
  const [kbEnabled, setKbEnabled] = useState<boolean>(() => window.localStorage.getItem('kbEnabled') === 'true');
  const [kbDocs, setKbDocs] = useState<Array<{ docId: string; filename: string; type: string; status: string }>>([]);
  const [kbSelectedDocIds, setKbSelectedDocIds] = useState<string[]>(() => {
    try {
      const raw = window.localStorage.getItem('kbSelectedDocIds');
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    window.localStorage.setItem('kbEnabled', String(kbEnabled));
  }, [kbEnabled]);

  useEffect(() => {
    window.localStorage.setItem('kbSelectedDocIds', JSON.stringify(kbSelectedDocIds));
  }, [kbSelectedDocIds]);

  const refreshKbDocs = async () => {
    try {
      const resp = await fetch('/api/kb/docs');
      const json = (await resp.json()) as { docs?: any[] };
      setKbDocs(Array.isArray(json.docs) ? json.docs : []);
    } catch {
      setKbDocs([]);
    }
  };

  const startPdfOcr = async (docId: string) => {
    const resp = await fetch(`/api/kb/docs/${docId}/ocr/start`, { method: 'POST' });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(`OCR start failed: ${resp.status} ${detail}`);
    }
    await refreshKbDocs();
  };

  const pollPdfOcr = async (docId: string) => {
    const resp = await fetch(`/api/kb/docs/${docId}/ocr/status`);
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(`OCR status failed: ${resp.status} ${detail}`);
    }
    await refreshKbDocs();
  };

  const uploadKbFile = async (file: File) => {
    const form = new FormData();
    form.append('file', file);
    const resp = await fetch('/api/kb/upload', { method: 'POST', body: form });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(`Upload failed: ${resp.status} ${detail}`);
    }
    await refreshKbDocs();
  };
  const [inputText, setInputText] = useState('');
  const [isAiThinking, setIsAiThinking] = useState(false);
  
  // Voice Input State
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Judge State
  const [judgeVerdict, setJudgeVerdict] = useState<string | null>(null);
  const [isJudgeThinking, setIsJudgeThinking] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const verdictRef = useRef<HTMLDivElement>(null);

  const verdictMarkdownComponents = {
    h2: ({ children }: { children: React.ReactNode }) => (
      <h2 className="text-2xl font-black text-yellow-400 tracking-wide mb-4">{children}</h2>
    ),
    h3: ({ children }: { children: React.ReactNode }) => (
      <h3 className="text-lg font-bold text-slate-100 mt-6 mb-2">{children}</h3>
    ),
    p: ({ children }: { children: React.ReactNode }) => (
      <p className="text-slate-300 leading-relaxed mb-3 whitespace-pre-wrap">{children}</p>
    ),
    strong: ({ children }: { children: React.ReactNode }) => (
      <strong className="text-slate-100 font-bold">{children}</strong>
    ),
    ul: ({ children }: { children: React.ReactNode }) => (
      <ul className="list-disc pl-6 space-y-2 my-3">{children}</ul>
    ),
    ol: ({ children }: { children: React.ReactNode }) => (
      <ol className="list-decimal pl-6 space-y-2 my-3">{children}</ol>
    ),
    li: ({ children }: { children: React.ReactNode }) => (
      <li className="text-slate-300 leading-relaxed">{children}</li>
    ),
  } as const;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [session.history, isAiThinking]);

  useEffect(() => {
    if (judgeVerdict && verdictRef.current) {
        verdictRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [judgeVerdict]);

  const handleStart = (e: React.FormEvent) => {
    e.preventDefault();
    if (session.topic.trim()) {
      setSession(prev => ({ ...prev, isStarted: true }));
    }
  };

  // --- New Voice Input Logic (Gemini API) ---
  const toggleRecording = async () => {
    if (isRecording) {
      stopRecording();
    } else {
      await startRecording();
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        await processAudio(audioBlob, mimeType);
        
        // Stop all tracks to release microphone
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      alert(t('micNoAccess'));
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const processAudio = async (audioBlob: Blob, mimeType: string) => {
    setIsTranscribing(true);
    try {
      const reader = new FileReader();
      reader.readAsDataURL(audioBlob);
      reader.onloadend = async () => {
        const base64String = reader.result as string;
        // Remove the data URL prefix (e.g., "data:audio/webm;base64,")
        const base64Audio = base64String.split(',')[1];
        
        const transcript = await transcribeAudio(base64Audio, mimeType);
        if (transcript) {
          setInputText((prev) => (prev ? `${prev} ${transcript}` : transcript));
        }
        setIsTranscribing(false);
      };
    } catch (error) {
      console.error("Transcribing failed", error);
      setIsTranscribing(false);
      alert(t('transcriptionFailed'));
    }
  };
  // -------------------------

  const currentStep = DEBATE_SEQUENCE[session.currentTurn];
  const isStudentTurn = !currentStep?.debater.isAI;

  const submitArgument = async (text: string) => {
    if (!text.trim()) return;

    const newArg: Argument = {
      id: Math.random().toString(36).substr(2, 9),
      speakerId: currentStep.debater.id,
      speakerName: currentStep.debater.name,
      side: currentStep.debater.isAI ? DebateSide.CON : DebateSide.PRO,
      text: text,
      timestamp: Date.now(),
    };

    const nextTurn = session.currentTurn + 1;
    setSession(prev => ({
      ...prev,
      history: [...prev.history, newArg],
      currentTurn: nextTurn,
    }));
    setInputText('');

    // If next turn is AI, trigger AI response
    if (nextTurn < DEBATE_SEQUENCE.length && DEBATE_SEQUENCE[nextTurn].debater.isAI) {
      triggerAi(nextTurn, [...session.history, newArg]);
    }
  };

  const triggerAi = async (turnIndex: number, currentHistory: Argument[]) => {
    setIsAiThinking(true);
    const step = DEBATE_SEQUENCE[turnIndex];
    
    try {
      const streamResponse = await generateDebateResponseStream(
        session.topic,
        step.debater.role,
        DebateSide.CON,
        currentHistory,
        lang,
        { enabled: kbEnabled, selectedDocIds: kbSelectedDocIds, topK: 8 }
      );

      const aiArgId = Math.random().toString(36).substr(2, 9);
      let fullText = "";
      let isFirstChunk = true;

      for await (const chunk of streamResponse) {
        const text = chunk.text;
        if (text) {
          fullText += text;
          
          if (isFirstChunk) {
            setIsAiThinking(false); // Stop thinking animation, show bubble
            // Initialize the AI argument in the history
            const aiArg: Argument = {
              id: aiArgId,
              speakerId: step.debater.id,
              speakerName: step.debater.name,
              side: DebateSide.CON,
              text: fullText, 
              timestamp: Date.now(),
            };
            
            setSession(prev => ({
              ...prev,
              history: [...prev.history, aiArg]
            }));
            isFirstChunk = false;
          } else {
            // Update the existing argument with new text
            setSession(prev => ({
              ...prev,
              history: prev.history.map(arg => 
                arg.id === aiArgId ? { ...arg, text: fullText } : arg
              )
            }));
          }
        }
      }

      // Advance turn after stream completes
      setSession(prev => ({
        ...prev,
        currentTurn: prev.currentTurn + 1,
      }));

    } catch (error) {
      console.error("AI Generation Error", error);
      setIsAiThinking(false);
      // Optional: Add a system message or error bubble here
    }
  };

  const handleCallJudge = async () => {
    setIsJudgeThinking(true);
    const verdict = await generateJudgeVerdict(session.topic, session.history, lang, {
      enabled: kbEnabled,
      selectedDocIds: kbSelectedDocIds,
      topK: 8,
    });
    setJudgeVerdict(verdict || t('judgeUnavailable'));
    setIsJudgeThinking(false);
  };

  if (!session.isStarted) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-slate-900 text-white font-lexend">
        <div className="max-w-2xl w-full space-y-8 bg-slate-800 p-10 rounded-3xl shadow-2xl border border-slate-700">
          <div className="text-center space-y-4">
            <h1 className="text-5xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
              {t('appTitle')}
            </h1>
            <p className="text-slate-400 text-lg">{t('appSubtitle')}</p>
            <div className="flex justify-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setLang('zh-CN')}
                className={`px-4 py-2 rounded-lg text-sm font-bold border transition-colors ${
                  lang === 'zh-CN'
                    ? 'bg-slate-700 border-slate-500 text-white'
                    : 'bg-slate-900/40 border-slate-700 text-slate-300 hover:bg-slate-700/40'
                }`}
              >
                中文
              </button>
              <button
                type="button"
                onClick={() => setLang('en-US')}
                className={`px-4 py-2 rounded-lg text-sm font-bold border transition-colors ${
                  lang === 'en-US'
                    ? 'bg-slate-700 border-slate-500 text-white'
                    : 'bg-slate-900/40 border-slate-700 text-slate-300 hover:bg-slate-700/40'
                }`}
              >
                English
              </button>
            </div>
          </div>
          
          <form onSubmit={handleStart} className="space-y-6">
            <div className="bg-slate-900/40 border border-slate-700 rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="font-bold text-slate-200">Knowledge Base</div>
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={kbEnabled}
                    onChange={(e) => setKbEnabled(e.target.checked)}
                  />
                  Enable
                </label>
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="file"
                  accept=".md,.markdown,.pdf"
                  onChange={async (e) => {
                    const input = e.currentTarget;
                    const file = e.target.files?.[0];
                    try {
                      if (file) await uploadKbFile(file);
                    } catch (err: any) {
                      alert(err?.message || 'Upload failed');
                    } finally {
                      // 避免异步后 currentTarget 失效导致报错
                      input.value = '';
                    }
                  }}
                  className="block w-full text-sm text-slate-300 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-bold file:bg-slate-700 file:text-white hover:file:bg-slate-600"
                />
                <button
                  type="button"
                  onClick={refreshKbDocs}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-bold border border-slate-600"
                >
                  Refresh
                </button>
              </div>

              <div className="space-y-2 max-h-40 overflow-auto pr-2">
                {kbDocs.length === 0 ? (
                  <div className="text-xs text-slate-500">No documents uploaded yet.</div>
                ) : (
                  kbDocs.map((d) => {
                    const checked = kbSelectedDocIds.includes(d.docId);
                    return (
                      <label key={d.docId} className="flex items-center gap-2 text-sm text-slate-300">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            setKbSelectedDocIds((prev) =>
                              e.target.checked ? Array.from(new Set([...prev, d.docId])) : prev.filter((x) => x !== d.docId),
                            );
                          }}
                        />
                        <span className="truncate flex-1">{d.filename}</span>
                        <span className="text-[10px] text-slate-500 uppercase">{d.type}</span>
                        <span className="text-[10px] text-slate-500 uppercase">{d.status}</span>
                        {d.type === 'pdf' && d.status !== 'converted' && (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  await startPdfOcr(d.docId);
                                } catch (e: any) {
                                  alert(e?.message || 'OCR start failed');
                                }
                              }}
                              className="px-2 py-1 text-[10px] font-bold bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded"
                              title="Run PaddleOCR and convert PDF to Markdown"
                            >
                              Convert
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  await pollPdfOcr(d.docId);
                                } catch (e: any) {
                                  alert(e?.message || 'OCR status failed');
                                }
                              }}
                              className="px-2 py-1 text-[10px] font-bold bg-slate-900/50 hover:bg-slate-700 border border-slate-700 rounded"
                              title="Poll OCR status"
                            >
                              Poll
                            </button>
                          </div>
                        )}
                      </label>
                    );
                  })
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">{t('debateTopicLabel')}</label>
              <textarea
                value={session.topic}
                onChange={(e) => setSession({ ...session, topic: e.target.value })}
                placeholder={t('debateTopicPlaceholder')}
                className="w-full h-32 px-4 py-3 bg-slate-700 border border-slate-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-white resize-none transition-all"
                required
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-blue-900/20 border border-blue-500/30 rounded-xl">
                <p className="font-bold text-blue-400 mb-2">{t('teamHumans')}</p>
                <ul className="text-xs text-blue-200/70 space-y-1">
                  <li>• 1st: {t('opening')}</li>
                  <li>• 2nd: {t('rebuttal')}</li>
                  <li>• 3rd: {t('conclusion')}</li>
                </ul>
              </div>
              <div className="p-4 bg-red-900/20 border border-red-500/30 rounded-xl">
                <p className="font-bold text-red-400 mb-2">{t('teamAI')}</p>
                <ul className="text-xs text-red-200/70 space-y-1">
                  <li>• 1st: {t('opening')}</li>
                  <li>• 2nd: {t('rebuttal')}</li>
                  <li>• 3rd: {t('conclusion')}</li>
                </ul>
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-all shadow-lg shadow-blue-900/20 active:scale-[0.98]"
            >
              {t('enterArena')}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const isDebateOver = session.currentTurn >= DEBATE_SEQUENCE.length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-lexend">
      {/* Header */}
      <header className="bg-slate-900 border-b border-slate-800 py-4 px-6 flex justify-between items-center sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center font-bold text-xl italic shadow-inner">C</div>
          <div>
            <h2 className="font-bold text-sm text-slate-400 uppercase tracking-widest">{t('debateArena')}</h2>
            <p className="text-lg font-bold truncate max-w-md">{session.topic}</p>
          </div>
        </div>
        <div className="flex items-center gap-6">
            <div className="text-right">
                <div className="text-[10px] text-slate-500 uppercase font-bold">{t('status')}</div>
                <div className="text-sm font-bold text-emerald-400 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                    {t('live')}
                </div>
            </div>
            <button 
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-sm font-bold border border-slate-700 transition-colors"
            >
                {t('reset')}
            </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex overflow-hidden">
        
        {/* Stages View */}
        <div className="flex-1 flex flex-col p-8 overflow-y-auto">
          
          {/* Debaters Row */}
          <div className="flex justify-between items-center mb-12">
            <div className="flex gap-4">
              {STUDENT_TEAM.map((d) => (
                <DebaterCard 
                  key={d.id} 
                  debater={d} 
                  isActive={currentStep?.debater.id === d.id} 
                  side="PRO"
                />
              ))}
            </div>

            <div className="text-4xl font-black text-slate-700 px-8 italic">VS</div>

            <div className="flex gap-4">
              {AI_TEAM.map((d) => (
                <DebaterCard 
                  key={d.id} 
                  debater={d} 
                  isActive={currentStep?.debater.id === d.id} 
                  side="CON"
                />
              ))}
            </div>
          </div>

          {/* Transcript/Argument Display */}
          <div 
            ref={scrollRef}
            className="flex-1 bg-slate-900/50 rounded-3xl border border-slate-800 p-8 overflow-y-auto space-y-6 shadow-inner"
          >
            {session.history.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-slate-500 space-y-4">
                <div className="w-16 h-16 border-2 border-dashed border-slate-700 rounded-full flex items-center justify-center">
                    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                </div>
                <p className="text-lg">{t('waitingOpening', { name: STUDENT_TEAM[0].name })}</p>
              </div>
            )}
            
            {session.history.map((arg) => (
              <div 
                key={arg.id} 
                className={`flex flex-col ${arg.side === DebateSide.PRO ? 'items-start' : 'items-end'}`}
              >
                <div className={`max-w-[80%] rounded-2xl p-5 ${
                  arg.side === DebateSide.PRO 
                    ? 'bg-blue-900/20 border-l-4 border-blue-500 rounded-tl-none' 
                    : 'bg-red-900/20 border-r-4 border-red-500 rounded-tr-none' 
                }`}>
                  <div className={`flex items-center gap-2 mb-2 text-xs font-bold text-slate-400 uppercase tracking-tighter ${
                      arg.side === DebateSide.CON ? 'justify-end' : ''
                    }`}>
                    <span>{arg.speakerName}</span>
                    <span className="opacity-30">•</span>
                    <span>{new Date(arg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <p className="leading-relaxed text-slate-200 italic whitespace-pre-wrap">{arg.text}</p>
                </div>
              </div>
            ))}

            {isAiThinking && (
              <div className="flex flex-col items-end animate-pulse">
                <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 w-1/2">
                    <div className="flex items-center gap-3 flex-row-reverse">
                        <div className="w-8 h-8 bg-slate-700 rounded-full"></div>
                        <div className="space-y-2 flex-1 flex flex-col items-end">
                            <div className="h-3 bg-slate-700 rounded w-1/4"></div>
                            <div className="h-3 bg-slate-700 rounded w-full"></div>
                            <div className="h-3 bg-slate-700 rounded w-3/4"></div>
                        </div>
                    </div>
                </div>
              </div>
            )}

            {/* Verdict Display Section - Scrolls into view when ready */}
            {judgeVerdict && (
                <div ref={verdictRef} className="mt-8 animate-fade-in-up">
                    <div className="bg-slate-800 rounded-3xl border-2 border-yellow-600/50 overflow-hidden shadow-2xl shadow-yellow-900/20">
                        <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 p-4 border-b border-yellow-600/30 flex items-center gap-3">
                            <div className="w-12 h-12 bg-yellow-600 rounded-full flex items-center justify-center text-slate-900 font-bold text-2xl shadow-lg">⚖️</div>
                            <div>
                                <h3 className="text-yellow-500 font-bold text-lg uppercase tracking-widest">{t('verdictTitle')}</h3>
                                <p className="text-xs text-yellow-500/60">{t('verdictSubtitle')}</p>
                            </div>
                        </div>
                        <div className="p-8">
                            <ReactMarkdown components={verdictMarkdownComponents}>
                              {judgeVerdict}
                            </ReactMarkdown>
                        </div>
                    </div>
                </div>
            )}
          </div>
        </div>
      </main>

      {/* Persistent Control Bar */}
      <footer className="bg-slate-900 border-t border-slate-800 p-6">
        <div className="max-w-5xl mx-auto">
          {isDebateOver ? (
            <div className="transition-all duration-500">
                {!judgeVerdict && !isJudgeThinking && (
                    <div className="text-center p-8 bg-gradient-to-r from-slate-800 to-slate-800 border border-slate-700 rounded-2xl">
                    <h3 className="text-2xl font-bold mb-2 text-white">{t('debateConcluded')}</h3>
                    <p className="text-slate-400 mb-6 italic">{t('timeForJudgment')}</p>
                    <div className="flex justify-center gap-4">
                        <button 
                            onClick={handleCallJudge}
                            className="px-8 py-4 bg-yellow-600 hover:bg-yellow-500 text-slate-900 font-bold rounded-xl transition-all shadow-lg shadow-yellow-900/20 active:scale-[0.98] flex items-center gap-2 text-lg"
                        >
                            <span className="text-xl">⚖️</span> {t('callForVerdict')}
                        </button>
                    </div>
                    </div>
                )}

                {isJudgeThinking && (
                    <div className="text-center p-8 bg-slate-800 border border-slate-700 rounded-2xl flex flex-col items-center justify-center gap-4">
                         <div className="w-16 h-16 border-4 border-yellow-600 border-t-transparent rounded-full animate-spin"></div>
                         <p className="text-yellow-500 font-bold animate-pulse">{t('judgeThinking')}</p>
                    </div>
                )}

                {judgeVerdict && (
                     <div className="text-center p-6 bg-slate-800/50 border border-slate-700 rounded-2xl flex justify-between items-center">
                        <div className="text-left">
                            <h4 className="font-bold text-slate-300">{t('sessionClosed')}</h4>
                            <p className="text-xs text-slate-500">{t('verdictDelivered')}</p>
                        </div>
                        <button 
                            onClick={() => window.location.reload()}
                            className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-bold transition-all text-sm"
                        >
                            {t('startNewDebate')}
                        </button>
                     </div>
                )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex justify-between items-center text-sm">
                <span className="flex items-center gap-2 text-slate-400">
                    <span className="w-3 h-3 bg-yellow-500 rounded-full animate-ping"></span>
                    {t('currentPhase')} <strong className="text-white ml-1">{currentStep.label}</strong>
                </span>
                <span className="text-slate-500">
                    {t('turnOf', { cur: session.currentTurn + 1, total: DEBATE_SEQUENCE.length })}
                </span>
              </div>

              {isStudentTurn ? (
                <div className="flex gap-4">
                  <div className="flex-1 relative">
                    <textarea
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      placeholder={`Enter argument as ${currentStep.debater.name}...`}
                      className="w-full bg-slate-800 border-2 border-blue-500/30 focus:border-blue-500 rounded-2xl py-4 px-6 pr-24 outline-none text-white resize-none h-24 transition-all"
                      disabled={isRecording || isTranscribing}
                    />
                    
                    {/* Microphone / Voice Input Trigger */}
                    <div className="absolute bottom-4 left-4 z-10 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={toggleRecording}
                        disabled={isTranscribing}
                        className={`p-2 rounded-full transition-all duration-300 flex items-center justify-center ${
                          isRecording 
                            ? 'bg-red-500 text-white ring-4 ring-red-500/30 animate-pulse' 
                            : isTranscribing
                                ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                                : 'bg-slate-700 text-slate-400 hover:bg-slate-600 hover:text-white'
                        }`}
                        title={isRecording ? t('stopRecording') : t('clickToRecord')}
                      >
                         {isRecording ? (
                           <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                             <rect x="6" y="6" width="12" height="12" rx="1" />
                           </svg>
                         ) : isTranscribing ? (
                            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                         ) : (
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                            </svg>
                         )}
                      </button>
                      
                      {(isRecording || isTranscribing) && (
                         <span className="text-xs font-bold text-slate-400 animate-pulse">
                            {isRecording ? t('recording') : t('transcribing')}
                         </span>
                      )}
                    </div>

                    <div className="absolute bottom-4 right-4 text-xs text-slate-500">
                      {t('markdownSupported')}
                    </div>
                  </div>
                  <button
                    onClick={() => submitArgument(inputText)}
                    disabled={!inputText.trim() || isRecording || isTranscribing}
                    className="px-10 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-2xl transition-all shadow-lg shadow-blue-900/20 active:scale-95 flex items-center justify-center gap-2"
                  >
                    {t('sendArgument')}
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                  </button>
                </div>
              ) : (
                <div className="bg-slate-800 border border-slate-700 rounded-2xl py-8 flex flex-col items-center justify-center gap-4">
                  <div className="flex gap-2">
                    <div className="w-2 h-2 bg-red-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                    <div className="w-2 h-2 bg-red-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                    <div className="w-2 h-2 bg-red-500 rounded-full animate-bounce"></div>
                  </div>
                  <p className="text-slate-400 text-sm font-medium tracking-wide italic">
                    {t('aiSynthesizing', { name: currentStep.debater.name })}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </footer>
    </div>
  );
};

export default App;
