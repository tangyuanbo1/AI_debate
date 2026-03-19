
import React, { useState, useEffect, useMemo, useRef } from 'react';
import ReactMarkdown from 'react-markdown'; 

import { STUDENT_TEAM, AI_TEAM, DEBATE_SEQUENCE } from './constants';
import { DebateSession, Argument, DebateSide } from './types';
import { generateDebateResponseStream, generateJudgeVerdict, transcribeAudio, synthesizeSpeech } from './services/qwenService';
import DebaterCard from './components/DebaterCard';

declare global {
  interface Window {
    webkitSpeechRecognition?: any;
    SpeechRecognition?: any;
  }
}

const App: React.FC = () => {
  type Language = 'zh-CN' | 'en-US';
  const [lang, setLang] = useState<Language>(() => {
    const saved = window.localStorage.getItem('lang');
    if (saved === 'en-US' || saved === 'zh-CN') return saved;
    const browserLang = navigator.language?.toLowerCase();
    return browserLang?.startsWith('zh') ? 'zh-CN' : 'en-US';
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
        debateTopicPlaceholder: '例如：海洋浮游生物有什么？',
        flowTitle: '课堂辩论流程（说明）',
        flowTeacher: '老师开场说明：介绍规则与评分标准',
        flowSetup: '确定辩题：划分正反方与辩手（人方/AI 方各 1/2/3 辩）',
        flowStructured: '结构化发言：开篇 → 反驳 → 总结（按顺序）',
        flowFree: '自由辩论：可选择任意人方发言角色，指定任意 AI 回答角色，可连续攻防',
        flowEnd: '结束自由辩论后进入裁判：输出表格化优缺点 + 判决 + 深度分析，可下载保存',
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
        kbTitle: '知识库',
        kbEnable: '启用（对话前会检索并注入上下文）',
        kbDebug: '调试输出',
        kbUpload: '上传文件（.md / .pdf）',
        kbNoFile: '未选择文件',
        kbRefresh: '刷新列表',
        kbSearch: '搜索文件名…',
        kbClear: '清空',
        kbNoDocs: '还没有入库文件。支持上传 .md 或 .pdf',
        kbNeedOcr: '需先OCR',
        kbStartOcr: '开始OCR',
        kbPoll: '查询状态',
        kbReset: '重置',
        kbDelete: '删除',
        kbDeleteConfirm: '确定删除该文件及其转换产物？',
        kbCollapseOpen: '展开',
        kbCollapseClose: '收起',
        debateArchiveTitle: '历史辩论',
        debateArchiveSearch: '搜索历史辩论（标题/辩题）…',
        debateArchiveNoDocs: '暂无历史辩论存档',
        debateArchiveOpen: '预览',
        debateArchiveDownload: '下载',
        debateArchiveDelete: '删除',
        debateArchiveDeleteConfirm: '确定删除该辩论存档？',
        debateSave: '保存为 Markdown',
        debateSaveNamePlaceholder: '输入存档名称（可选）',
        debateSaving: '保存中…',
        freeDebateTitle: '自由辩论',
        freeDebateHint: '选择人方发言者与 AI 回答者，可连续攻防。点击“结束自由辩论”进入裁判。',
        freeDebateAttacker: '人方发言者',
        freeDebateResponder: 'AI 回答者',
        freeDebateEnd: '结束自由辩论',
        tts: '情感语音播报',
        enterArgumentAs: '以 {name} 的身份发言…',
        speaking: '发言中',
        selectedStudent: '选中的学生',
        student1: '学生 1',
        student2: '学生 2',
        student3: '学生 3',
        aiAlpha: 'AI（阿尔法）',
        aiBeta: 'AI（贝塔）',
        aiGamma: 'AI（伽马）',
        speaker1st: '一辩',
        speaker2nd: '二辩',
        speaker3rd: '三辩',
        stepPro1stOpening: '正方一辩：开篇',
        stepCon1stOpening: '反方一辩：开篇',
        stepPro2ndRebuttal: '正方二辩：反驳',
        stepCon2ndRebuttal: '反方二辩：反驳',
        stepPro3rdConclusion: '正方三辩：总结',
        stepCon3rdConclusion: '反方三辩：总结',
        aiAttacker: 'AI 攻方',
        humanTarget: '人方目标',
        autoTarget: '自动选择',
        aiAttack: 'AI 发起攻辩',
        aiAttackHint: 'AI 已发起攻辩，请以 {name} 的身份回复。发送后 AI 将自动反驳。',
        aiAttackButtonTitle: 'AI 向选定的人方辩手发起攻辩/提问',
        markdownPreview: 'Markdown 预览',
        close: '关闭',
        archiveTurns: '回合',
        archiveVerdict: '判决',
        readAloud: '朗读',
        stopReading: '停止朗读',
        thinkingExpand: '思考过程（点击展开）',
      },
      'en-US': {
        appTitle: 'Classroom Debate',
        appSubtitle: 'Humans vs. Artificial Intelligence',
        debateTopicLabel: 'Debate Topic',
        debateTopicPlaceholder: 'e.g., Should social media platforms be responsible for policing fake news?',
        flowTitle: 'Classroom Debate Flow (Guide)',
        flowTeacher: 'Teacher opening: explain rules and scoring',
        flowSetup: 'Confirm topic & assign teams (Humans/AI each have 1st/2nd/3rd speaker)',
        flowStructured: 'Structured rounds: Opening → Rebuttal → Conclusion (in order)',
        flowFree: 'Free debate: choose any Human speaker and any AI responder; you may attack continuously',
        flowEnd: 'End free debate → Judge produces table-based strengths/weaknesses + verdict + deep analysis; downloadable',
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
        kbTitle: 'Knowledge Base',
        kbEnable: 'Enable (retrieve & inject context)',
        kbDebug: 'Debug',
        kbUpload: 'Upload (.md / .pdf)',
        kbNoFile: 'No file selected',
        kbRefresh: 'Refresh',
        kbSearch: 'Search filename...',
        kbClear: 'Clear',
        kbNoDocs: 'No documents yet. Upload .md or .pdf',
        kbNeedOcr: 'OCR first',
        kbStartOcr: 'Start OCR',
        kbPoll: 'Poll',
        kbReset: 'Reset',
        kbDelete: 'Delete',
        kbDeleteConfirm: 'Delete this document and its artifacts?',
        kbCollapseOpen: 'Expand',
        kbCollapseClose: 'Collapse',
        debateArchiveTitle: 'Debate Archive',
        debateArchiveSearch: 'Search archive (title/topic)...',
        debateArchiveNoDocs: 'No archived debates yet',
        debateArchiveOpen: 'Preview',
        debateArchiveDownload: 'Download',
        debateArchiveDelete: 'Delete',
        debateArchiveDeleteConfirm: 'Delete this archived debate?',
        debateSave: 'Save as Markdown',
        debateSaveNamePlaceholder: 'Archive name (optional)',
        debateSaving: 'Saving...',
        freeDebateTitle: 'Free Debate',
        freeDebateHint: 'Pick a Human speaker and an AI responder. You may attack continuously. Click “End Free Debate” to go to judging.',
        freeDebateAttacker: 'Human speaker',
        freeDebateResponder: 'AI responder',
        freeDebateEnd: 'End Free Debate',
        tts: 'Emotional TTS',
        enterArgumentAs: 'Enter argument as {name}...',
        speaking: 'Speaking',
        selectedStudent: 'the selected student',
        student1: 'Student 1',
        student2: 'Student 2',
        student3: 'Student 3',
        aiAlpha: 'AI (Alpha)',
        aiBeta: 'AI (Beta)',
        aiGamma: 'AI (Gamma)',
        speaker1st: '1st Speaker',
        speaker2nd: '2nd Speaker',
        speaker3rd: '3rd Speaker',
        stepPro1stOpening: 'Pro 1st: Opening',
        stepCon1stOpening: 'Con 1st: Opening',
        stepPro2ndRebuttal: 'Pro 2nd: Rebuttal',
        stepCon2ndRebuttal: 'Con 2nd: Rebuttal',
        stepPro3rdConclusion: 'Pro 3rd: Conclusion',
        stepCon3rdConclusion: 'Con 3rd: Conclusion',
        aiAttacker: 'AI attacker',
        humanTarget: 'Human target',
        autoTarget: 'Auto target',
        aiAttack: 'AI Attack',
        aiAttackHint: 'AI has attacked. Please reply as {name}. After you send, the AI will automatically rebut.',
        aiAttackButtonTitle: 'AI initiates an attack/question to the selected human',
        markdownPreview: 'Markdown preview',
        close: 'Close',
        archiveTurns: 'turns',
        archiveVerdict: 'verdict',
        readAloud: 'Read aloud',
        stopReading: 'Stop reading',
        thinkingExpand: 'Thinking (click to expand)',
      },
    };

    const tr = (key: string, vars?: Record<string, string | number>) => {
      const template = dict[lang][key] ?? key;
      if (!vars) return template;
      return Object.keys(vars).reduce((acc, k) => acc.replaceAll(`{${k}}`, String(vars[k])), template);
    };

    return tr;
  }, [lang]);

  const getDebaterName = (id: string) => {
    const map: Record<string, string> = {
      s1: t('student1'), s2: t('student2'), s3: t('student3'),
      a1: t('aiAlpha'), a2: t('aiBeta'), a3: t('aiGamma'),
    };
    return map[id] ?? STUDENT_TEAM.find(d => d.id === id)?.name ?? AI_TEAM.find(d => d.id === id)?.name ?? id;
  };

  const getRoleName = (role: string) => {
    if (role.includes('1st')) return t('speaker1st');
    if (role.includes('2nd')) return t('speaker2nd');
    if (role.includes('3rd')) return t('speaker3rd');
    return role;
  };

  const STEP_LABEL_KEYS = ['stepPro1stOpening', 'stepCon1stOpening', 'stepPro2ndRebuttal', 'stepCon2ndRebuttal', 'stepPro3rdConclusion', 'stepCon3rdConclusion'] as const;
  const getStepLabel = (index: number) => t(STEP_LABEL_KEYS[index] ?? 'stepPro1stOpening');

  const [session, setSession] = useState<DebateSession>({
    topic: '',
    currentTurn: 0,
    history: [],
    isStarted: false,
    mode: 'structured',
  });

  // Knowledge Base (minimal UI)
  const [kbEnabled, setKbEnabled] = useState<boolean>(() => window.localStorage.getItem('kbEnabled') === 'true');
  const [kbDebug, setKbDebug] = useState<boolean>(() => window.localStorage.getItem('kbDebug') === 'true');
  const [kbCollapsed, setKbCollapsed] = useState<boolean>(() => window.localStorage.getItem('kbCollapsed') !== 'false');
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
    window.localStorage.setItem('kbDebug', String(kbDebug));
  }, [kbDebug]);

  useEffect(() => {
    window.localStorage.setItem('kbCollapsed', String(kbCollapsed));
  }, [kbCollapsed]);

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

  const [kbSearch, setKbSearch] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingFileName, setPendingFileName] = useState<string>('');

  // Debate archive (Markdown)
  const [debateDocs, setDebateDocs] = useState<
    Array<{ debateId: string; name: string; topic: string; createdAt: number; turnCount: number; hasVerdict: boolean }>
  >([]);
  const [debateSearch, setDebateSearch] = useState('');
  const [debateArchiveCollapsed, setDebateArchiveCollapsed] = useState<boolean>(true);
  const [debatePreview, setDebatePreview] = useState<{ open: boolean; title: string; markdown: string; debateId?: string }>(
    { open: false, title: '', markdown: '' }
  );
  const [debateSaveName, setDebateSaveName] = useState<string>('');
  const [isSavingDebate, setIsSavingDebate] = useState<boolean>(false);

  const refreshDebateDocs = async () => {
    try {
      const resp = await fetch('/api/debates');
      const json = (await resp.json()) as { docs?: any[] };
      setDebateDocs(Array.isArray(json.docs) ? json.docs : []);
    } catch {
      setDebateDocs([]);
    }
  };

  const fetchDebateMarkdown = async (debateId: string) => {
    const resp = await fetch(`/api/debates/${debateId}/markdown`);
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(`Load failed: ${resp.status} ${detail}`);
    }
    return await resp.text();
  };

  const downloadMarkdown = (filename: string, markdown: string) => {
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.endsWith('.md') ? filename : `${filename}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const deleteDebateDoc = async (debateId: string) => {
    const resp = await fetch(`/api/debates/${debateId}`, { method: 'DELETE' });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(`Delete failed: ${resp.status} ${detail}`);
    }
    await refreshDebateDocs();
  };

  useEffect(() => {
    if (!session.isStarted) {
      refreshKbDocs();
      refreshDebateDocs();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.isStarted]);

  const fixMojibake = (s: string) => {
    // 仅用于显示：尝试把 latin1 误解码的 UTF-8 还原
    try {
      if (!s) return s;
      if (/[\u4e00-\u9fff《》]/.test(s)) return s; // 已含中文则不处理
      if (!/[Ããâ]/.test(s)) return s; // 轻量启发式：常见乱码字符
      const bytes = Uint8Array.from(Array.from(s).map((c) => c.charCodeAt(0)));
      const decoded = new TextDecoder('utf-8').decode(bytes);
      return decoded || s;
    } catch {
      return s;
    }
  };

  const startPdfOcr = async (docId: string) => {
    const resp = await fetch(`/api/kb/docs/${docId}/ocr/start`, { method: 'POST' });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(`OCR start failed: ${resp.status} ${detail}`);
    }
    const json = await resp.json().catch(() => null);
    console.log('[OCR_START]', { docId, json });
    await refreshKbDocs();
  };

  const pollPdfOcr = async (docId: string) => {
    const resp = await fetch(`/api/kb/docs/${docId}/ocr/status`);
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(`OCR status failed: ${resp.status} ${detail}`);
    }
    const json = await resp.json().catch(() => null);
    console.log('[OCR_STATUS]', { docId, json });
    await refreshKbDocs();
  };

  const resetPdfOcr = async (docId: string) => {
    const resp = await fetch(`/api/kb/docs/${docId}/ocr/reset`, { method: 'POST' });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(`OCR reset failed: ${resp.status} ${detail}`);
    }
    await refreshKbDocs();
  };

  const deleteKbDoc = async (docId: string) => {
    const resp = await fetch(`/api/kb/docs/${docId}`, { method: 'DELETE' });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(`Delete failed: ${resp.status} ${detail}`);
    }
    setKbSelectedDocIds((prev) => prev.filter((x) => x !== docId));
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
  const speechRecRef = useRef<any>(null);
  const sttBaseTextRef = useRef<string>('');
  const sttAccumulatedRef = useRef<string>('');
  const [sttSupported] = useState<boolean>(() => Boolean(window.SpeechRecognition || window.webkitSpeechRecognition));

  // TTS (情感语音播报：阿里云 Qwen + 自动朗读 AI + 朗读时高亮)
  const [ttsEnabled, setTtsEnabled] = useState<boolean>(() => window.localStorage.getItem('ttsEnabled') !== 'false');
  const [speakingArgId, setSpeakingArgId] = useState<string | null>(null);
  const [ttsHighlightIndex, setTtsHighlightIndex] = useState<number>(-1);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsUrlRef = useRef<string | null>(null);
  const ttsQueueRef = useRef<{ argId: string; sentences: string[]; nextToPlay: number } | null>(null);

  useEffect(() => {
    window.localStorage.setItem('ttsEnabled', String(ttsEnabled));
  }, [ttsEnabled]);

  useEffect(() => () => stopTtsPlayback(), []);

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

  // 用于“历史辩论预览”的 Markdown 渲染样式（不依赖 Tailwind Typography 插件）
  const archiveMarkdownComponents = {
    h1: ({ children }: { children: React.ReactNode }) => (
      <h1 className="text-2xl sm:text-3xl font-black text-slate-100 tracking-tight mb-4">{children}</h1>
    ),
    h2: ({ children }: { children: React.ReactNode }) => (
      <h2 className="text-xl sm:text-2xl font-black text-slate-100 tracking-tight mt-8 mb-3">{children}</h2>
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
      <ul className="list-disc pl-6 space-y-2 my-3 text-slate-300">{children}</ul>
    ),
    ol: ({ children }: { children: React.ReactNode }) => (
      <ol className="list-decimal pl-6 space-y-2 my-3 text-slate-300">{children}</ol>
    ),
    li: ({ children }: { children: React.ReactNode }) => (
      <li className="leading-relaxed">{children}</li>
    ),
    blockquote: ({ children }: { children: React.ReactNode }) => (
      <blockquote className="border-l-4 border-slate-700 pl-4 my-4 text-slate-300 italic">{children}</blockquote>
    ),
    code: ({ children }: { children: React.ReactNode }) => (
      <code className="px-1 py-0.5 rounded bg-slate-950/50 border border-slate-800 text-slate-200 text-[12px]">
        {children}
      </code>
    ),
    pre: ({ children }: { children: React.ReactNode }) => (
      <pre className="my-4 p-4 rounded-xl bg-slate-950/40 border border-slate-700 overflow-auto text-[12px] text-slate-200">
        {children}
      </pre>
    ),
    table: ({ children }: { children: React.ReactNode }) => (
      <div className="my-4 overflow-auto rounded-xl border border-slate-700">
        <table className="w-full text-sm">{children}</table>
      </div>
    ),
    thead: ({ children }: { children: React.ReactNode }) => <thead className="bg-slate-900">{children}</thead>,
    th: ({ children }: { children: React.ReactNode }) => (
      <th className="text-left px-3 py-2 font-bold text-slate-200 border-b border-slate-700 whitespace-nowrap">{children}</th>
    ),
    td: ({ children }: { children: React.ReactNode }) => (
      <td className="px-3 py-2 text-slate-300 border-b border-slate-800 align-top">{children}</td>
    ),
  } as const;

  const parseThinkingSpeech = (raw: string) => {
    // 支持流式：即使结束标记还没到，也尽量把“已出现的部分”渲染出来
    const tOpen = '[[THINKING]]';
    const tClose = '[[/THINKING]]';
    const sOpen = '[[SPEECH]]';
    const sClose = '[[/SPEECH]]';

    const tStart = raw.indexOf(tOpen);
    const tEnd = raw.indexOf(tClose);
    const sStart = raw.indexOf(sOpen);
    const sEnd = raw.indexOf(sClose);

    const hasThinkingOpen = tStart >= 0;
    const hasSpeechOpen = sStart >= 0;

    const thinking = hasThinkingOpen
      ? raw.slice(tStart + tOpen.length, tEnd > tStart ? tEnd : raw.length).trim()
      : '';

    // 关键：如果已经进入 THINKING 阶段但 SPEECH 还没开始，
    // 不要把 raw 输出到正文区域（否则看起来“思考过程跑到外面”）
    const speech = hasSpeechOpen
      ? raw.slice(sStart + sOpen.length, sEnd > sStart ? sEnd : raw.length).trim()
      : hasThinkingOpen
        ? ''
        : raw;

    const isThinkingPhase = hasThinkingOpen && !hasSpeechOpen;
    return { thinking, speech, isThinkingPhase };
  };

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

  // 结构化 6 回合结束后，自动进入自由辩论（直到用户手动结束）
  useEffect(() => {
    if (!session.isStarted) return;
    if (session.mode !== 'structured') return;
    // 避免 TDZ：不要引用在文件更靠后声明的 const
    const structuredOver = session.currentTurn >= DEBATE_SEQUENCE.length;
    if (!structuredOver) return;
    setSession((prev) => ({ ...prev, mode: 'freeDebate' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.isStarted, session.mode, session.currentTurn]);

  const handleStart = (e: React.FormEvent) => {
    e.preventDefault();
    if (session.topic.trim()) {
      setSession(prev => ({ ...prev, isStarted: true, mode: 'structured', currentTurn: 0, history: [] }));
    }
  };

  // --- Voice Input (Streaming STT via Web Speech API; fallback to MediaRecorder->transcribe) ---
  const toggleRecording = async () => {
    if (isRecording) {
      stopRecording();
    } else {
      await startRecording();
    }
  };

  const startRecording = async () => {
    // Prefer Web Speech STT for real-time transcription (Edge/Chrome)
    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognitionCtor) {
      try {
        const rec = new SpeechRecognitionCtor();
        speechRecRef.current = rec;
        sttBaseTextRef.current = inputText ? `${inputText.trim()} ` : '';
        sttAccumulatedRef.current = '';
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = lang === 'zh-CN' ? 'zh-CN' : 'en-US';

        rec.onresult = (event: any) => {
          let interimText = '';
          for (let i = event.resultIndex; i < event.results.length; i += 1) {
            const res = event.results[i];
            const transcript = String(res?.[0]?.transcript ?? '');
            if (res.isFinal) {
              sttAccumulatedRef.current += transcript;
            } else {
              interimText += transcript;
            }
          }
          const merged = `${sttBaseTextRef.current}${sttAccumulatedRef.current}${interimText}`.trim();
          setInputText(merged);
        };

        rec.onerror = (e: any) => {
          console.error('SpeechRecognition error', e);
          setIsRecording(false);
          setIsTranscribing(false);
          alert(t('micNoAccess'));
        };

        rec.onend = () => {
          // Some browsers auto-stop; keep UI consistent
          setIsRecording(false);
          setIsTranscribing(false);
        };

        rec.start();
        setIsRecording(true);
        setIsTranscribing(true);
        return;
      } catch (e) {
        console.error('SpeechRecognition start failed', e);
        // fall through to MediaRecorder
      }
    }

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
    const rec = speechRecRef.current;
    if (rec && isRecording) {
      try {
        rec.stop();
      } catch {
        // ignore
      }
      speechRecRef.current = null;
      setIsRecording(false);
      setIsTranscribing(false);
      return;
    }
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

  const detectSpeakLang = (text: string): 'zh-CN' | 'en-US' => {
    return /[\u4e00-\u9fff]/.test(text || '') ? 'zh-CN' : 'en-US';
  };

  const stopTtsPlayback = () => {
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current.src = '';
      ttsAudioRef.current = null;
    }
    if (ttsUrlRef.current) {
      URL.revokeObjectURL(ttsUrlRef.current);
      ttsUrlRef.current = null;
    }
    const synth = window.speechSynthesis;
    if (synth) synth.cancel();
  };

  const splitSentences = (text: string): string[] => {
    return text.split(/(?<=[。！？.!?])\s*/).filter((s) => s.trim() && /[。！？.!?]\s*$/.test(s.trim()));
  };

  const playNextInQueue = async () => {
    const q = ttsQueueRef.current;
    if (!q || q.nextToPlay >= q.sentences.length) {
      setSpeakingArgId(null);
      setTtsHighlightIndex(-1);
      ttsQueueRef.current = null;
      return;
    }
    const sentence = q.sentences[q.nextToPlay];
    const url = await synthesizeSpeech(sentence, detectSpeakLang(sentence));
    if (!url) {
      const remaining = q.sentences.slice(q.nextToPlay);
      ttsQueueRef.current = null;
      if (remaining.length > 0 && window.speechSynthesis) {
        setSpeakingArgId(q.argId);
        const playNextBrowser = (idx: number) => {
          if (idx >= remaining.length) {
            setSpeakingArgId(null);
            setTtsHighlightIndex(-1);
            return;
          }
          setTtsHighlightIndex(q.nextToPlay + idx);
          const u = new SpeechSynthesisUtterance(remaining[idx]);
          u.lang = detectSpeakLang(remaining[idx]);
          u.onend = () => playNextBrowser(idx + 1);
          u.onerror = () => playNextBrowser(idx + 1);
          window.speechSynthesis.speak(u);
        };
        playNextBrowser(0);
      } else {
        setSpeakingArgId(null);
        setTtsHighlightIndex(-1);
      }
      return;
    }
    setTtsHighlightIndex(q.nextToPlay);
    const audio = new Audio(url);
    ttsAudioRef.current = audio;
    ttsUrlRef.current = url;
    audio.onended = () => {
      if (ttsUrlRef.current) URL.revokeObjectURL(ttsUrlRef.current);
      ttsUrlRef.current = null;
      ttsAudioRef.current = null;
      if (ttsQueueRef.current) ttsQueueRef.current.nextToPlay += 1;
      playNextInQueue();
    };
    audio.onerror = () => {
      if (ttsUrlRef.current) URL.revokeObjectURL(ttsUrlRef.current);
      ttsUrlRef.current = null;
      ttsAudioRef.current = null;
      if (ttsQueueRef.current) ttsQueueRef.current.nextToPlay += 1;
      playNextInQueue();
    };
    audio.play().catch(() => {
      if (ttsQueueRef.current) ttsQueueRef.current.nextToPlay += 1;
      playNextInQueue();
    });
  };

  const speakText = async (argId: string, text: string) => {
    if (!ttsEnabled) return;
    if (!text?.trim()) return;
    if (speakingArgId === argId) {
      stopTtsPlayback();
      setSpeakingArgId(null);
      setTtsHighlightIndex(-1);
      ttsQueueRef.current = null;
      return;
    }
    stopTtsPlayback();
    ttsQueueRef.current = null;
    setSpeakingArgId(argId);
    setTtsHighlightIndex(-1);

    const sentences = splitSentences(text);
    const onEnd = () => setSpeakingArgId((prev) => (prev === argId ? null : prev));

    if (sentences.length > 0) {
      ttsQueueRef.current = { argId, sentences, nextToPlay: 0 };
      playNextInQueue();
      return;
    }

    const url = await synthesizeSpeech(text, detectSpeakLang(text));
    if (url) {
      const audio = new Audio(url);
      ttsAudioRef.current = audio;
      ttsUrlRef.current = url;
      audio.onended = () => {
        if (ttsUrlRef.current) URL.revokeObjectURL(ttsUrlRef.current);
        ttsUrlRef.current = null;
        ttsAudioRef.current = null;
        onEnd();
      };
      audio.onerror = () => {
        if (ttsUrlRef.current) URL.revokeObjectURL(ttsUrlRef.current);
        ttsUrlRef.current = null;
        ttsAudioRef.current = null;
        onEnd();
      };
      audio.play().catch(() => onEnd());
      return;
    }

    const synth = window.speechSynthesis;
    if (synth) {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = detectSpeakLang(text);
      u.onend = onEnd;
      u.onerror = onEnd;
      synth.speak(u);
    } else {
      onEnd();
    }
  };

  const currentStep = session.mode === 'structured' ? DEBATE_SEQUENCE[session.currentTurn] : null;
  const isStudentTurn = Boolean(currentStep && !currentStep.debater.isAI);

  const submitArgument = async (text: string) => {
    if (!text.trim()) return;
    if (!currentStep) return;

    const newArg: Argument = {
      id: Math.random().toString(36).substr(2, 9),
      speakerId: currentStep.debater.id,
      speakerName: getDebaterName(currentStep.debater.id),
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

  // Free debate: choose any human speaker + any AI responder, and allow continuous attacks.
  const [freeAttackerId, setFreeAttackerId] = useState<string>(() => STUDENT_TEAM[0]?.id ?? 's1');
  const [freeResponderId, setFreeResponderId] = useState<string>(() => AI_TEAM[0]?.id ?? 'a1');
  const [freeAiAttackerId, setFreeAiAttackerId] = useState<string>(() => AI_TEAM[0]?.id ?? 'a1');
  const [freeHumanTargetId, setFreeHumanTargetId] = useState<string>(() => STUDENT_TEAM[0]?.id ?? 's1');
  const [pendingAiAttack, setPendingAiAttack] = useState<{ aiId: string; humanId: string } | null>(null);
  const [autoAiTarget, setAutoAiTarget] = useState<boolean>(true);

  const submitFreeDebate = async (text: string) => {
    if (!text.trim()) return;
    const attackerId = pendingAiAttack?.humanId ?? freeAttackerId;
    const responderId = pendingAiAttack?.aiId ?? freeResponderId;
    const attacker = STUDENT_TEAM.find((d) => d.id === attackerId) ?? STUDENT_TEAM[0];
    const responder = AI_TEAM.find((d) => d.id === responderId) ?? AI_TEAM[0];
    if (!attacker || !responder) return;

    const newArg: Argument = {
      id: Math.random().toString(36).substr(2, 9),
      speakerId: attacker.id,
      speakerName: getDebaterName(attacker.id),
      side: DebateSide.PRO,
      text,
      timestamp: Date.now(),
    };

    const nextHistory = [...session.history, newArg];
    setSession((prev) => ({ ...prev, history: nextHistory }));
    setInputText('');

    // trigger selected AI responder immediately (reply or rebut depending on who initiated)
    const kind: 'ai_reply' | 'ai_rebut' = pendingAiAttack ? 'ai_rebut' : 'ai_reply';
    setPendingAiAttack(null);
    triggerAiFreeDebate(responder, nextHistory, kind, getDebaterName(attacker.id));
  };

  const triggerAiFreeDebate = async (
    responder: (typeof AI_TEAM)[number],
    currentHistory: Argument[],
    kind: 'ai_attack' | 'ai_rebut' | 'ai_reply',
    targetSpeakerName?: string,
  ) => {
    setIsAiThinking(true);
    stopTtsPlayback();
    setSpeakingArgId(null);
    setTtsHighlightIndex(-1);
    ttsQueueRef.current = null;
    try {
      const streamResponse = await generateDebateResponseStream(
        session.topic,
        responder.role,
        DebateSide.CON,
        currentHistory,
        lang,
        { enabled: kbEnabled, selectedDocIds: kbSelectedDocIds, topK: 8, debug: kbDebug },
        {
          freeDebate: {
            kind,
            attackerName: getDebaterName(responder.id),
            targetSpeakerName,
            targetSide: 'PRO',
          },
        },
      );

      const aiArgId = Math.random().toString(36).substr(2, 9);
      let fullText = '';

      for await (const chunk of streamResponse as any) {
        if (chunk?.debug) {
          console.groupCollapsed('[KB_DEBUG]');
          console.log(chunk.debug);
          console.groupEnd();
          continue;
        }
        const textChunk = chunk?.text ?? '';
        if (!textChunk) continue;
        fullText += textChunk;

        setSession((prev) => {
          const existingIdx = prev.history.findIndex((x) => x.id === aiArgId);
          const aiArg: Argument = {
            id: aiArgId,
            speakerId: responder.id,
            speakerName: getDebaterName(responder.id),
            side: DebateSide.CON,
            text: fullText,
            timestamp: Date.now(),
          };
          const next = existingIdx >= 0 ? prev.history.map((x) => (x.id === aiArgId ? aiArg : x)) : [...prev.history, aiArg];
          return { ...prev, history: next };
        });
      }
      if (ttsEnabled) {
        const { speech } = parseThinkingSpeech(fullText);
        const toRead = (speech || fullText || '').trim();
        if (toRead) speakText(aiArgId, toRead);
      }
    } catch (error) {
      console.error('AI Generation Error', error);
    } finally {
      setIsAiThinking(false);
    }
  };

  const startAiAttack = async () => {
    const ai = AI_TEAM.find((d) => d.id === freeAiAttackerId) ?? AI_TEAM[0];
    const human = STUDENT_TEAM.find((d) => d.id === freeHumanTargetId) ?? STUDENT_TEAM[0];
    if (!ai || !human) return;
    let chosenHuman = human;
    if (autoAiTarget) {
      try {
        const resp = await fetch('/api/free-debate/choose-target', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            topic: session.topic,
            history: session.history,
            candidates: STUDENT_TEAM.map((d) => getDebaterName(d.id)),
            attackerName: getDebaterName(ai.id),
            lang,
          }),
        });
        const json = (await resp.json().catch(() => null)) as any;
        const name = String(json?.targetSpeakerName || '').trim();
        const found = STUDENT_TEAM.find((d) => getDebaterName(d.id) === name || d.name === name);
        if (found) {
          chosenHuman = found;
          setFreeHumanTargetId(found.id);
        }
      } catch {
        // ignore and fallback to manual selection
      }
    }

    // AI 发起攻击：生成一段“质询/攻击”发言，然后等待指定学生回应
    await triggerAiFreeDebate(ai, session.history, 'ai_attack', getDebaterName(chosenHuman.id));
    setPendingAiAttack({ aiId: ai.id, humanId: chosenHuman.id });
  };

  const triggerAi = async (turnIndex: number, currentHistory: Argument[]) => {
    setIsAiThinking(true);
    stopTtsPlayback();
    setSpeakingArgId(null);
    setTtsHighlightIndex(-1);
    ttsQueueRef.current = null;
    const step = DEBATE_SEQUENCE[turnIndex];
    
    try {
      const streamResponse = await generateDebateResponseStream(
        session.topic,
        step.debater.role,
        DebateSide.CON,
        currentHistory,
        lang,
        { enabled: kbEnabled, selectedDocIds: kbSelectedDocIds, topK: 8, debug: kbDebug }
      );

      const aiArgId = Math.random().toString(36).substr(2, 9);
      let fullText = "";
      let isFirstChunk = true;

      for await (const chunk of streamResponse as any) {
        if (chunk?.debug) {
          console.groupCollapsed('[KB_DEBUG]');
          console.log(chunk.debug);
          console.groupEnd();
        }
        const text = chunk.text;
        if (text) {
          fullText += text;

          if (isFirstChunk) {
            setIsAiThinking(false); // Stop thinking animation, show bubble
            // Initialize the AI argument in the history
            const aiArg: Argument = {
              id: aiArgId,
              speakerId: step.debater.id,
              speakerName: getDebaterName(step.debater.id),
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

      if (ttsEnabled) {
        const { speech } = parseThinkingSpeech(fullText);
        const toRead = (speech || fullText || '').trim();
        if (toRead) speakText(aiArgId, toRead);
      }

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

  const saveDebateArchive = async () => {
    if (!judgeVerdict) return;
    setIsSavingDebate(true);
    try {
      const resp = await fetch('/api/debates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: debateSaveName,
          topic: session.topic,
          history: session.history,
          judgeVerdict,
        }),
      });
      if (!resp.ok) {
        const detail = await resp.text().catch(() => '');
        throw new Error(`Save failed: ${resp.status} ${detail}`);
      }
      setDebateSaveName('');
      await refreshDebateDocs();
      alert('Saved');
    } catch (e: any) {
      alert(e?.message || 'Save failed');
    } finally {
      setIsSavingDebate(false);
    }
  };

  if (!session.isStarted) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 py-6 sm:p-6 bg-slate-900 text-white font-lexend">
        <div className="max-w-2xl w-full space-y-6 sm:space-y-8 bg-slate-800 p-5 sm:p-10 rounded-3xl shadow-2xl border border-slate-700">
          <div className="text-center space-y-4">
            <h1 className="text-4xl sm:text-5xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
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
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">{t('debateTopicLabel')}</label>
              <textarea
                value={session.topic}
                onChange={(e) => setSession({ ...session, topic: e.target.value })}
                placeholder={t('debateTopicPlaceholder')}
                className="w-full h-28 sm:h-32 px-4 py-3 bg-slate-700 border border-slate-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-white resize-none transition-all"
                required
              />
            </div>
            
            <div className="bg-slate-900/30 border border-slate-700 rounded-2xl p-4">
              <div className="font-bold text-slate-200 mb-2">{t('flowTitle')}</div>
              <ul className="text-sm text-slate-300 space-y-1">
                <li>- {t('flowTeacher')}</li>
                <li>- {t('flowSetup')}</li>
                <li>- {t('flowStructured')}</li>
                <li>- {t('flowFree')}</li>
                <li>- {t('flowEnd')}</li>
              </ul>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

            {/* Knowledge Base (collapsible, placed below teams) */}
            <div className="bg-slate-900/40 border border-slate-700 rounded-2xl overflow-hidden">
              <button
                type="button"
                onClick={() => setKbCollapsed((v) => !v)}
                className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-900/60 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="font-bold text-slate-200">{t('kbTitle')}</div>
                  <span className="text-[10px] text-slate-500 uppercase">
                    {kbCollapsed ? t('kbCollapseOpen') : t('kbCollapseClose')}
                  </span>
                </div>
                <div className={`transition-transform ${kbCollapsed ? '' : 'rotate-180'}`}>
                  <svg className="w-5 h-5 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>

              {!kbCollapsed && (
                <div className="px-5 pb-5 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="text-xs text-slate-500">
                      {t('kbEnable')}
                    </div>
                    <div className="flex flex-wrap items-center gap-4">
                      <label className="flex items-center gap-2 text-sm text-slate-300">
                        <input type="checkbox" checked={kbEnabled} onChange={(e) => setKbEnabled(e.target.checked)} />
                        Enable
                      </label>
                      <label className="flex items-center gap-2 text-sm text-slate-300">
                        <input type="checkbox" checked={kbDebug} onChange={(e) => setKbDebug(e.target.checked)} />
                        {t('kbDebug')}
                      </label>
                    </div>
                  </div>

                  {/* Custom file picker (avoid browser-native Chinese label in English mode) */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".md,.markdown,.pdf"
                    className="hidden"
                    onChange={async (e) => {
                      const input = e.currentTarget;
                      const file = e.target.files?.[0];
                      setPendingFileName(file?.name ?? '');
                      try {
                        if (file) await uploadKbFile(file);
                      } catch (err: any) {
                        alert(err?.message || 'Upload failed');
                      } finally {
                        input.value = '';
                        setPendingFileName('');
                      }
                    }}
                  />
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-bold border border-slate-600 shrink-0"
                    >
                      {t('kbUpload')}
                    </button>
                    <div className="flex-1 text-xs text-slate-400 truncate">
                      {pendingFileName ? pendingFileName : t('kbNoFile')}
                    </div>
                    <button
                      type="button"
                      onClick={refreshKbDocs}
                      className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-bold border border-slate-600 shrink-0"
                    >
                      {t('kbRefresh')}
                    </button>
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <input
                      value={kbSearch}
                      onChange={(e) => setKbSearch(e.target.value)}
                      placeholder={t('kbSearch')}
                      className="flex-1 bg-slate-800 border border-slate-700 rounded-xl py-2 px-3 text-sm outline-none focus:ring-2 focus:ring-blue-500/40"
                    />
                    <button
                      type="button"
                      onClick={() => setKbSearch('')}
                      className="px-4 py-2 bg-slate-900/50 hover:bg-slate-700 rounded-lg text-sm font-bold border border-slate-700 shrink-0"
                    >
                      {t('kbClear')}
                    </button>
                  </div>

                  <div className="space-y-2 max-h-40 overflow-auto pr-2">
                    {kbDocs.length === 0 ? (
                      <div className="text-xs text-slate-500">{t('kbNoDocs')}</div>
                    ) : (
                      kbDocs
                        .filter((d) => fixMojibake(d.filename).toLowerCase().includes(kbSearch.trim().toLowerCase()))
                        .map((d: any) => {
                          const checked = kbSelectedDocIds.includes(d.docId);
                          const selectable = d.type !== 'pdf' || d.status === 'converted';
                          return (
                            <label key={d.docId} className="flex items-center gap-2 text-sm text-slate-300">
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={!selectable}
                                onChange={(e) => {
                                  setKbSelectedDocIds((prev) =>
                                    e.target.checked ? Array.from(new Set([...prev, d.docId])) : prev.filter((x) => x !== d.docId),
                                  );
                                }}
                              />
                              <span className="truncate flex-1">{fixMojibake(d.filename)}</span>
                              <span className="text-[10px] text-slate-500 uppercase">{d.type}</span>
                              <span className="text-[10px] text-slate-500 uppercase">{d.status}</span>
                              {!selectable && <span className="text-[10px] text-slate-500">{t('kbNeedOcr')}</span>}
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
                                  >
                                    {t('kbStartOcr')}
                                  </button>
                                  {d.status === 'converting' && (
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
                                    >
                                      {t('kbPoll')}
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      try {
                                        await resetPdfOcr(d.docId);
                                      } catch (e: any) {
                                        alert(e?.message || 'Reset failed');
                                      }
                                    }}
                                    className="px-2 py-1 text-[10px] font-bold bg-slate-900/30 hover:bg-slate-700 border border-slate-700 rounded"
                                  >
                                    {t('kbReset')}
                                  </button>
                                </div>
                              )}
                              <button
                                type="button"
                                onClick={async () => {
                                  if (!confirm(t('kbDeleteConfirm'))) return;
                                  try {
                                    await deleteKbDoc(d.docId);
                                  } catch (e: any) {
                                    alert(e?.message || 'Delete failed');
                                  }
                                }}
                                className="px-2 py-1 text-[10px] font-bold bg-red-900/30 hover:bg-red-700/40 border border-red-800/60 rounded"
                              >
                                {t('kbDelete')}
                              </button>
                            </label>
                          );
                        })
                    )}
                  </div>

                </div>
              )}
            </div>

            {/* Debate Archive (collapsible) - same level as Knowledge Base */}
            <div className="bg-slate-900/40 border border-slate-700 rounded-2xl overflow-hidden">
              <button
                type="button"
                onClick={() => setDebateArchiveCollapsed((v) => !v)}
                className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-900/60 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="font-bold text-slate-200">{t('debateArchiveTitle')}</div>
                  <span className="text-[10px] text-slate-500 uppercase">
                    {debateArchiveCollapsed ? t('kbCollapseOpen') : t('kbCollapseClose')}
                  </span>
                </div>
                <div className={`transition-transform ${debateArchiveCollapsed ? '' : 'rotate-180'}`}>
                  <svg className="w-5 h-5 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>

              {!debateArchiveCollapsed && (
                <div className="px-5 pb-5 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <input
                      value={debateSearch}
                      onChange={(e) => setDebateSearch(e.target.value)}
                      placeholder={t('debateArchiveSearch')}
                      className="flex-1 bg-slate-800 border border-slate-700 rounded-xl py-2 px-3 text-sm outline-none focus:ring-2 focus:ring-blue-500/40"
                    />
                    <button
                      type="button"
                      onClick={refreshDebateDocs}
                      className="px-4 py-2 bg-slate-900/50 hover:bg-slate-700 rounded-lg text-sm font-bold border border-slate-700 shrink-0"
                    >
                      {t('kbRefresh')}
                    </button>
                  </div>

                  <div className="space-y-2 max-h-56 overflow-auto pr-2">
                    {debateDocs.length === 0 ? (
                      <div className="text-xs text-slate-500">{t('debateArchiveNoDocs')}</div>
                    ) : (
                      debateDocs
                        .filter((d) => {
                          const q = debateSearch.trim().toLowerCase();
                          if (!q) return true;
                          return `${d.name} ${d.topic}`.toLowerCase().includes(q);
                        })
                        .map((d) => (
                          <div key={d.debateId} className="flex items-center gap-2 text-sm text-slate-300">
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-bold text-slate-200">{d.name}</div>
                              <div className="truncate text-[11px] text-slate-500">
                                {new Date(d.createdAt).toLocaleString()} · {d.turnCount} {t('archiveTurns')}{d.hasVerdict ? ` · ${t('archiveVerdict')}` : ''}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  const md = await fetchDebateMarkdown(d.debateId);
                                  setDebatePreview({ open: true, title: d.name, markdown: md, debateId: d.debateId });
                                } catch (e: any) {
                                  alert(e?.message || 'Load failed');
                                }
                              }}
                              className="px-2 py-1 text-[10px] font-bold bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded shrink-0"
                            >
                              {t('debateArchiveOpen')}
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  const md = await fetchDebateMarkdown(d.debateId);
                                  downloadMarkdown(d.name || 'debate', md);
                                } catch (e: any) {
                                  alert(e?.message || 'Download failed');
                                }
                              }}
                              className="px-2 py-1 text-[10px] font-bold bg-slate-900/50 hover:bg-slate-700 border border-slate-700 rounded shrink-0"
                            >
                              {t('debateArchiveDownload')}
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                if (!confirm(t('debateArchiveDeleteConfirm'))) return;
                                try {
                                  await deleteDebateDoc(d.debateId);
                                } catch (e: any) {
                                  alert(e?.message || 'Delete failed');
                                }
                              }}
                              className="px-2 py-1 text-[10px] font-bold bg-red-900/30 hover:bg-red-700/40 border border-red-800/60 rounded shrink-0"
                            >
                              {t('debateArchiveDelete')}
                            </button>
                          </div>
                        ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <button
              type="submit"
              className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-all shadow-lg shadow-blue-900/20 active:scale-[0.98]"
            >
              {t('enterArena')}
            </button>
          </form>
        </div>

        {debatePreview.open && (
          <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-3xl bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden shadow-2xl">
              <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-black text-slate-100 truncate">{debatePreview.title}</div>
                  <div className="text-[11px] text-slate-500 truncate">{t('markdownPreview')}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {debatePreview.debateId && (
                    <button
                      type="button"
                      onClick={() => downloadMarkdown(debatePreview.title || 'debate', debatePreview.markdown)}
                      className="px-3 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs font-bold border border-slate-700"
                    >
                      {t('debateArchiveDownload')}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setDebatePreview({ open: false, title: '', markdown: '' })}
                    className="px-3 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs font-bold border border-slate-700"
                  >
                    {t('close')}
                  </button>
                </div>
              </div>
              <div className="max-h-[75vh] overflow-auto p-4 sm:p-6">
                <ReactMarkdown components={archiveMarkdownComponents}>{debatePreview.markdown}</ReactMarkdown>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  const isInFreeDebate = session.mode === 'freeDebate';
  const isDebateOver = session.mode === 'ended';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-lexend">
      {/* Header */}
      <header className="bg-slate-900 border-b border-slate-800 py-3 sm:py-4 px-4 sm:px-6 flex justify-between items-center sticky top-0 z-50">
        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
          <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center font-bold text-xl italic shadow-inner">C</div>
          <div className="min-w-0">
            <h2 className="font-bold text-sm text-slate-400 uppercase tracking-widest">{t('debateArena')}</h2>
            <p className="text-base sm:text-lg font-bold truncate max-w-[55vw] sm:max-w-md">{session.topic}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-4 shrink-0">
            <div className="flex gap-1">
              <button type="button" onClick={() => setLang('zh-CN')} className={`px-2 py-1 rounded text-xs font-bold ${lang === 'zh-CN' ? 'bg-slate-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>中文</button>
              <button type="button" onClick={() => setLang('en-US')} className={`px-2 py-1 rounded text-xs font-bold ${lang === 'en-US' ? 'bg-slate-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>EN</button>
            </div>
            <div className="text-right hidden sm:block">
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
        <div className="flex-1 flex flex-col px-4 py-6 sm:p-8 overflow-y-auto">
          
          {/* Debaters Row */}
          <div className="mb-8 sm:mb-12">
            <div className="w-full flex items-center justify-start sm:justify-center gap-3 sm:gap-4 overflow-x-auto overflow-y-visible pb-3 px-1 flex-nowrap">
              {STUDENT_TEAM.map((d) => (
                <DebaterCard
                  key={d.id}
                  debater={d}
                  isActive={currentStep?.debater.id === d.id}
                  side="PRO"
                  displayName={getDebaterName(d.id)}
                  displayRole={getRoleName(d.role)}
                  speakingLabel={t('speaking')}
                />
              ))}

              <div className="shrink-0 px-2 sm:px-4">
                <div className="text-xs sm:text-sm font-black text-slate-500 italic select-none">VS</div>
            </div>

              {AI_TEAM.map((d) => (
                <DebaterCard
                  key={d.id}
                  debater={d}
                  isActive={currentStep?.debater.id === d.id}
                  side="CON"
                  displayName={getDebaterName(d.id)}
                  displayRole={getRoleName(d.role)}
                  speakingLabel={t('speaking')}
                />
              ))}
            </div>
          </div>

          {/* Transcript/Argument Display */}
          <div 
            ref={scrollRef}
            className="flex-1 bg-slate-900/50 rounded-3xl border border-slate-800 p-4 sm:p-8 overflow-y-auto space-y-6 shadow-inner"
          >
            {session.history.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-slate-500 space-y-4">
                <div className="w-16 h-16 border-2 border-dashed border-slate-700 rounded-full flex items-center justify-center">
                    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                </div>
                <p className="text-lg">{t('waitingOpening', { name: getDebaterName(STUDENT_TEAM[0].id) })}</p>
              </div>
            )}
            
            {session.history.map((arg) => (
              <div 
                key={arg.id} 
                className={`flex flex-col ${arg.side === DebateSide.PRO ? 'items-start' : 'items-end'}`}
              >
                <div className={`max-w-[92%] sm:max-w-[80%] rounded-2xl p-5 ${
                  arg.side === DebateSide.PRO 
                    ? 'bg-blue-900/20 border-l-4 border-blue-500 rounded-tl-none' 
                    : 'bg-red-900/20 border-r-4 border-red-500 rounded-tr-none' 
                }`}>
                  <div className={`flex items-center gap-2 mb-2 text-xs font-bold text-slate-400 uppercase tracking-tighter ${
                      arg.side === DebateSide.CON ? 'justify-end' : ''
                    }`}>
                    <span>{getDebaterName(arg.speakerId)}</span>
                    <span className="opacity-30">•</span>
                    <span>{new Date(arg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    {ttsEnabled && (
                      <button
                        type="button"
                        onClick={() => {
                          const speakable =
                            arg.side === DebateSide.CON
                              ? (() => {
                                  const { speech } = parseThinkingSpeech(arg.text);
                                  return speech || '';
                                })()
                              : arg.text;
                          speakText(arg.id, speakable);
                        }}
                        className={`ml-2 px-2 py-1 rounded border text-[10px] font-black transition-colors ${
                          speakingArgId === arg.id
                            ? 'bg-yellow-600/20 border-yellow-500/40 text-yellow-300'
                            : 'bg-slate-950/30 border-slate-700 text-slate-300 hover:bg-slate-950/50'
                        }`}
                        title={speakingArgId === arg.id ? t('stopReading') : t('readAloud')}
                      >
                        {speakingArgId === arg.id ? t('stopReading') : t('readAloud')}
                      </button>
                    )}
                  </div>
                  {arg.side === DebateSide.CON ? (
                    (() => {
                      const { thinking, speech, isThinkingPhase } = parseThinkingSpeech(arg.text);
                      return (
                        <div className="space-y-3">
                          {thinking && (
                            <details
                              className="bg-slate-950/30 border border-slate-700 rounded-xl p-3"
                              open={isThinkingPhase ? true : undefined}
                            >
                              <summary className="cursor-pointer text-xs font-bold text-slate-300 select-none">
                                {t('thinkingExpand')}
                              </summary>
                              <pre className="mt-2 text-xs text-slate-300 whitespace-pre-wrap leading-relaxed">
                                {thinking}
                              </pre>
                            </details>
                          )}
                          {speech && (
                            <p className="leading-relaxed text-slate-200 italic whitespace-pre-wrap">
                              {(() => {
                                const parts = speech.split(/(?<=[。！？.!?])\s*/);
                                const complete = parts.filter((p) => /[。！？.!?]\s*$/.test(p.trim()));
                                const remainder = parts.length > complete.length ? parts.slice(complete.length).join('') : '';
                                return (
                                  <>
                                    {complete.map((sent, i) => (
                                      <span
                                        key={i}
                                        className={
                                          speakingArgId === arg.id && ttsHighlightIndex === i
                                            ? 'bg-amber-400/35 text-amber-100 rounded px-1 -mx-0.5 transition-colors duration-200'
                                            : ''
                                        }
                                      >
                                        {sent}
                                      </span>
                                    ))}
                                    {remainder ? <span>{remainder}</span> : null}
                                  </>
                                );
                              })()}
                            </p>
                          )}
                        </div>
                      );
                    })()
                  ) : (
                  <p className="leading-relaxed text-slate-200 italic whitespace-pre-wrap">{arg.text}</p>
                  )}
                </div>
              </div>
            ))}

            {isAiThinking && (
              <div className="flex flex-col items-end animate-pulse">
                <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 w-full sm:w-1/2">
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
                        <div className="p-4 sm:p-8">
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
      <footer className="bg-slate-900 border-t border-slate-800 p-4 sm:p-6">
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
                     <div className="text-center p-6 bg-slate-800/50 border border-slate-700 rounded-2xl flex flex-col sm:flex-row gap-4 sm:justify-between sm:items-center">
                        <div className="text-left">
                            <h4 className="font-bold text-slate-300">{t('sessionClosed')}</h4>
                            <p className="text-xs text-slate-500">{t('verdictDelivered')}</p>
                        </div>
                        <div className="w-full sm:w-auto flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                          <input
                            value={debateSaveName}
                            onChange={(e) => setDebateSaveName(e.target.value)}
                            placeholder={t('debateSaveNamePlaceholder')}
                            className="flex-1 bg-slate-800 border border-slate-700 rounded-xl py-2 px-3 text-sm outline-none focus:ring-2 focus:ring-blue-500/40 min-w-0"
                          />
                          <button
                            type="button"
                            onClick={saveDebateArchive}
                            disabled={isSavingDebate}
                            className="px-6 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-xl font-bold transition-all text-sm"
                          >
                            {isSavingDebate ? t('debateSaving') : t('debateSave')}
                          </button>
                        <button 
                            onClick={() => window.location.reload()}
                            className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-bold transition-all text-sm"
                        >
                              {t('startNewDebate')}
                        </button>
                        </div>
                     </div>
                )}
            </div>
          ) : (
            <div className="space-y-4">
              {session.mode === 'structured' && currentStep ? (
                <>
              <div className="flex justify-between items-center text-sm">
                <span className="flex items-center gap-2 text-slate-400">
                    <span className="w-3 h-3 bg-yellow-500 rounded-full animate-ping"></span>
                        {t('currentPhase')} <strong className="text-white ml-1">{getStepLabel(session.currentTurn)}</strong>
                </span>
                <span className="text-slate-500">
                        {t('turnOf', { cur: session.currentTurn + 1, total: DEBATE_SEQUENCE.length })}
                </span>
              </div>

                  <div className="flex items-center justify-end">
                    <label className="flex items-center gap-2 text-xs text-slate-300" title={lang === 'zh-CN' ? '阿里云情感语音播报，AI 回复自动朗读，读到哪里高亮哪里' : 'Alibaba emotional TTS, auto-read AI, highlight while reading'}>
                      <input type="checkbox" checked={ttsEnabled} onChange={(e) => setTtsEnabled(e.target.checked)} />
                      {t('tts')}
                    </label>
              </div>

              {isStudentTurn ? (
                <div className="flex flex-col sm:flex-row gap-4">
                  <div className="flex-1 relative">
                    <textarea
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      placeholder={t('enterArgumentAs', { name: getDebaterName(currentStep.debater.id) })}
                      className="w-full bg-slate-800 border-2 border-blue-500/30 focus:border-blue-500 rounded-2xl py-4 px-6 pr-24 outline-none text-white resize-none h-24 transition-all"
                      disabled={isRecording || isTranscribing}
                    />
                    
                    {/* Microphone / Voice Input Trigger (streaming STT if supported) */}
                    {sttSupported && (
                    <div className="absolute bottom-4 left-4 z-10 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={toggleRecording}
                        className={`p-2 rounded-full transition-all duration-300 flex items-center justify-center ${
                          isRecording 
                            ? 'bg-red-500 text-white ring-4 ring-red-500/30 animate-pulse' 
                                : 'bg-slate-700 text-slate-400 hover:bg-slate-600 hover:text-white'
                        }`}
                          title={isRecording ? t('stopRecording') : t('clickToRecord')}
                      >
                         {isRecording ? (
                           <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                             <rect x="6" y="6" width="12" height="12" rx="1" />
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
                    )}

                    <div className="absolute bottom-4 right-4 text-xs text-slate-500">
                      {t('markdownSupported')}
                    </div>
                  </div>
                  <button
                    onClick={() => submitArgument(inputText)}
                    disabled={!inputText.trim() || isRecording || isTranscribing}
                    className="w-full sm:w-auto px-10 py-4 sm:py-0 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-2xl transition-all shadow-lg shadow-blue-900/20 active:scale-95 flex items-center justify-center gap-2"
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
                    {t('aiSynthesizing', { name: getDebaterName(currentStep.debater.id) })}
                  </p>
                </div>
              )}
                </>
              ) : (
                // Free debate mode
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-black text-slate-200">{t('freeDebateTitle')}</div>
                    <button
                      type="button"
                      onClick={() => setSession((prev) => ({ ...prev, mode: 'ended' }))}
                      className="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 text-slate-900 font-bold rounded-xl transition-all shadow-lg shadow-yellow-900/20 active:scale-[0.98] text-sm"
                    >
                      {t('freeDebateEnd')}
                    </button>
                  </div>
                  <div className="text-xs text-slate-500">{t('freeDebateHint')}</div>

                  <div className="flex flex-col sm:flex-row gap-3">
                    <label className="flex-1 text-xs text-slate-400">
                      <div className="mb-1">{t('freeDebateAttacker')}</div>
                      <select
                        value={pendingAiAttack?.humanId ?? freeAttackerId}
                        onChange={(e) => setFreeAttackerId(e.target.value)}
                        className="w-full bg-slate-800 border border-slate-700 rounded-xl py-2 px-3 text-sm outline-none"
                        disabled={Boolean(pendingAiAttack)}
                      >
                        {STUDENT_TEAM.map((d) => (
                          <option key={d.id} value={d.id}>
                            {getDebaterName(d.id)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex-1 text-xs text-slate-400">
                      <div className="mb-1">{t('freeDebateResponder')}</div>
                      <select
                        value={pendingAiAttack?.aiId ?? freeResponderId}
                        onChange={(e) => setFreeResponderId(e.target.value)}
                        className="w-full bg-slate-800 border border-slate-700 rounded-xl py-2 px-3 text-sm outline-none"
                        disabled={Boolean(pendingAiAttack)}
                      >
                        {AI_TEAM.map((d) => (
                          <option key={d.id} value={d.id}>
                            {getDebaterName(d.id)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3">
                    <label className="flex-1 text-xs text-slate-400">
                      <div className="mb-1">{t('aiAttacker')}</div>
                      <select
                        value={freeAiAttackerId}
                        onChange={(e) => setFreeAiAttackerId(e.target.value)}
                        className="w-full bg-slate-800 border border-slate-700 rounded-xl py-2 px-3 text-sm outline-none"
                        disabled={isAiThinking || Boolean(pendingAiAttack)}
                      >
                        {AI_TEAM.map((d) => (
                          <option key={d.id} value={d.id}>
                            {getDebaterName(d.id)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex-1 text-xs text-slate-400">
                      <div className="mb-1">{t('humanTarget')}</div>
                      <select
                        value={freeHumanTargetId}
                        onChange={(e) => setFreeHumanTargetId(e.target.value)}
                        className="w-full bg-slate-800 border border-slate-700 rounded-xl py-2 px-3 text-sm outline-none"
                        disabled={isAiThinking || Boolean(pendingAiAttack) || autoAiTarget}
                      >
                        {STUDENT_TEAM.map((d) => (
                          <option key={d.id} value={d.id}>
                            {getDebaterName(d.id)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex items-center gap-2 text-xs text-slate-300 bg-slate-800/40 border border-slate-700 rounded-xl px-3 py-2 shrink-0">
                      <input
                        type="checkbox"
                        checked={autoAiTarget}
                        onChange={(e) => setAutoAiTarget(e.target.checked)}
                        disabled={isAiThinking || Boolean(pendingAiAttack)}
                      />
                      {t('autoTarget')}
                    </label>
                    <button
                      type="button"
                      onClick={startAiAttack}
                      disabled={isAiThinking || Boolean(pendingAiAttack)}
                      className="px-6 py-3 bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-black transition-all text-sm self-stretch"
                      title={t('aiAttackButtonTitle')}
                    >
                      {t('aiAttack')}
                    </button>
                  </div>

                  {pendingAiAttack && (
                    <div className="text-xs text-yellow-300 bg-yellow-900/20 border border-yellow-700/40 rounded-xl p-3">
                      {t('aiAttackHint', { name: getDebaterName(pendingAiAttack.humanId) })}
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row gap-4">
                    <div className="flex-1 relative">
                      <textarea
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        placeholder={t('enterArgumentAs', { name: getDebaterName(pendingAiAttack?.humanId ?? freeAttackerId) })}
                        className="w-full bg-slate-800 border-2 border-blue-500/30 focus:border-blue-500 rounded-2xl py-4 px-6 pr-24 outline-none text-white resize-none h-24 transition-all"
                        disabled={isAiThinking}
                      />
                      <div className="absolute bottom-4 right-4 text-xs text-slate-500">
                        {t('markdownSupported')}
                      </div>
                    </div>
                    <button
                      onClick={() => submitFreeDebate(inputText)}
                      disabled={!inputText.trim() || isAiThinking}
                      className="w-full sm:w-auto px-10 py-4 sm:py-0 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-2xl transition-all shadow-lg shadow-blue-900/20 active:scale-95 flex items-center justify-center gap-2"
                    >
                      {t('sendArgument')}
                    </button>
                  </div>
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
