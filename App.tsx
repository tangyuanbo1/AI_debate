
import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown'; 

import { STUDENT_TEAM, AI_TEAM, DEBATE_SEQUENCE } from './constants';
import { DebateSession, Argument, DebateSide } from './types';
import { generateDebateResponseStream, generateJudgeVerdict, transcribeAudio } from './services/geminiService';
import DebaterCard from './components/DebaterCard';

const App: React.FC = () => {
  const [session, setSession] = useState<DebateSession>({
    topic: '',
    currentTurn: 0,
    history: [],
    isStarted: false,
  });
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
      alert("无法访问麦克风，请检查权限设置。(Cannot access microphone)");
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
      alert("语音转写失败，请重试。(Transcription failed)");
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
        currentHistory
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
    const verdict = await generateJudgeVerdict(session.topic, session.history);
    setJudgeVerdict(verdict || "Judge unavailable.");
    setIsJudgeThinking(false);
  };

  if (!session.isStarted) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-slate-900 text-white font-lexend">
        <div className="max-w-2xl w-full space-y-8 bg-slate-800 p-10 rounded-3xl shadow-2xl border border-slate-700">
          <div className="text-center space-y-4">
            <h1 className="text-5xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
              Classroom Debate
            </h1>
            <p className="text-slate-400 text-lg">Humans vs. Artificial Intelligence</p>
          </div>
          
          <form onSubmit={handleStart} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Debate Topic</label>
              <textarea
                value={session.topic}
                onChange={(e) => setSession({ ...session, topic: e.target.value })}
                placeholder="e.g., Should social media platforms be responsible for policing fake news?"
                className="w-full h-32 px-4 py-3 bg-slate-700 border border-slate-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-white resize-none transition-all"
                required
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-blue-900/20 border border-blue-500/30 rounded-xl">
                <p className="font-bold text-blue-400 mb-2">Team Humans (Pro)</p>
                <ul className="text-xs text-blue-200/70 space-y-1">
                  <li>• 1st: Opening</li>
                  <li>• 2nd: Rebuttal</li>
                  <li>• 3rd: Conclusion</li>
                </ul>
              </div>
              <div className="p-4 bg-red-900/20 border border-red-500/30 rounded-xl">
                <p className="font-bold text-red-400 mb-2">Team Gemini (Con)</p>
                <ul className="text-xs text-red-200/70 space-y-1">
                  <li>• 1st: Opening</li>
                  <li>• 2nd: Rebuttal</li>
                  <li>• 3rd: Conclusion</li>
                </ul>
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-all shadow-lg shadow-blue-900/20 active:scale-[0.98]"
            >
              Enter the Arena
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
            <h2 className="font-bold text-sm text-slate-400 uppercase tracking-widest">Debate Arena</h2>
            <p className="text-lg font-bold truncate max-w-md">{session.topic}</p>
          </div>
        </div>
        <div className="flex items-center gap-6">
            <div className="text-right">
                <div className="text-[10px] text-slate-500 uppercase font-bold">Status</div>
                <div className="text-sm font-bold text-emerald-400 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                    Live
                </div>
            </div>
            <button 
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-sm font-bold border border-slate-700 transition-colors"
            >
                Reset
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
                <p className="text-lg">Waiting for the opening statement from {STUDENT_TEAM[0].name}...</p>
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
                                <h3 className="text-yellow-500 font-bold text-lg uppercase tracking-widest">Chief Justice Verdict</h3>
                                <p className="text-xs text-yellow-500/60">Final Evaluation & Scoring</p>
                            </div>
                        </div>
                        <div className="p-8 text-slate-300 leading-relaxed font-light whitespace-pre-wrap">
                            {judgeVerdict}
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
                    <h3 className="text-2xl font-bold mb-2 text-white">Debate Concluded</h3>
                    <p className="text-slate-400 mb-6 italic">The speakers have rested their cases. It is time for judgment.</p>
                    <div className="flex justify-center gap-4">
                        <button 
                            onClick={handleCallJudge}
                            className="px-8 py-4 bg-yellow-600 hover:bg-yellow-500 text-slate-900 font-bold rounded-xl transition-all shadow-lg shadow-yellow-900/20 active:scale-[0.98] flex items-center gap-2 text-lg"
                        >
                            <span className="text-xl">⚖️</span> Call for Verdict
                        </button>
                    </div>
                    </div>
                )}

                {isJudgeThinking && (
                    <div className="text-center p-8 bg-slate-800 border border-slate-700 rounded-2xl flex flex-col items-center justify-center gap-4">
                         <div className="w-16 h-16 border-4 border-yellow-600 border-t-transparent rounded-full animate-spin"></div>
                         <p className="text-yellow-500 font-bold animate-pulse">The Chief Justice is reviewing the transcript...</p>
                    </div>
                )}

                {judgeVerdict && (
                     <div className="text-center p-6 bg-slate-800/50 border border-slate-700 rounded-2xl flex justify-between items-center">
                        <div className="text-left">
                            <h4 className="font-bold text-slate-300">Session Closed</h4>
                            <p className="text-xs text-slate-500">The verdict has been delivered.</p>
                        </div>
                        <button 
                            onClick={() => window.location.reload()}
                            className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-bold transition-all text-sm"
                        >
                            Start New Debate
                        </button>
                     </div>
                )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex justify-between items-center text-sm">
                <span className="flex items-center gap-2 text-slate-400">
                    <span className="w-3 h-3 bg-yellow-500 rounded-full animate-ping"></span>
                    Current Phase: <strong className="text-white ml-1">{currentStep.label}</strong>
                </span>
                <span className="text-slate-500">
                    Turn {session.currentTurn + 1} of {DEBATE_SEQUENCE.length}
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
                        title={isRecording ? "Stop recording" : "Click to record voice"}
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
                            {isRecording ? "Recording..." : "Transcribing..."}
                         </span>
                      )}
                    </div>

                    <div className="absolute bottom-4 right-4 text-xs text-slate-500">
                      Markdown supported
                    </div>
                  </div>
                  <button
                    onClick={() => submitArgument(inputText)}
                    disabled={!inputText.trim() || isRecording || isTranscribing}
                    className="px-10 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-2xl transition-all shadow-lg shadow-blue-900/20 active:scale-95 flex items-center justify-center gap-2"
                  >
                    Send Argument
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
                    {currentStep.debater.name} is synthesizing counter-arguments...
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
