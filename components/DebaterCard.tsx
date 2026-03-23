
import React from 'react';
import { Debater } from '../types';

interface DebaterCardProps {
  debater: Debater;
  isActive: boolean;
  side: 'PRO' | 'CON';
  displayName?: string;
  displayRole?: string;
  speakingLabel?: string;
  /** 大尺寸 + 竖排 3v3 场景 */
  size?: 'default' | 'arena';
  /** AI 正在生成、尚未出正文时 */
  isThinking?: boolean;
  thinkingLabel?: string;
}

const DebaterCard: React.FC<DebaterCardProps> = ({
  debater,
  isActive,
  side,
  displayName,
  displayRole,
  speakingLabel,
  size = 'default',
  isThinking,
  thinkingLabel,
}) => {
  const sideColor = side === 'PRO' ? 'border-blue-500' : 'border-red-500';
  const glowClass =
    isActive || isThinking
      ? side === 'PRO'
        ? 'ring-4 ring-blue-400/60 scale-[1.03] shadow-lg shadow-blue-900/30'
        : 'ring-4 ring-red-400/60 scale-[1.03] shadow-lg shadow-red-900/30'
      : '';

  const isArena = size === 'arena';
  const imgClass = isArena
    ? 'w-20 h-20 sm:w-28 sm:h-28 rounded-full border-2 border-slate-600 object-cover shadow-lg'
    : 'w-14 h-14 sm:w-20 sm:h-20 rounded-full border-2 border-slate-600 object-cover shadow-lg';
  const cardMin = isArena ? 'min-w-[132px] sm:min-w-[188px] max-w-[220px]' : 'min-w-[112px] sm:min-w-[160px] max-w-[180px]';

  return (
    <div
      className={`relative transition-all duration-500 p-2 sm:p-4 rounded-2xl bg-slate-800 border-2 ${sideColor} ${glowClass} flex flex-col items-center gap-1.5 sm:gap-2 w-full ${cardMin} ${isThinking ? 'pb-8 sm:pb-9' : ''}`}
    >
      <img src={debater.avatar} alt={displayName ?? debater.name} className={imgClass} />
      <div className="text-center">
        <p className={`font-bold truncate ${isArena ? 'text-xs sm:text-base w-28 sm:w-40' : 'text-[11px] sm:text-sm w-24 sm:w-32'}`}>
          {displayName ?? debater.name}
        </p>
        <p
          className={`text-[10px] sm:text-xs font-semibold px-2 py-0.5 rounded-full mt-1 ${
            side === 'PRO' ? 'bg-blue-900/40 text-blue-300' : 'bg-red-900/40 text-red-300'
          }`}
        >
          {displayRole ?? debater.role}
        </p>
      </div>
      {isThinking && (
        <div className="absolute inset-x-1 bottom-1 flex justify-center">
          <span className="text-[10px] sm:text-xs font-black px-2 py-1 rounded-lg bg-amber-500/25 text-amber-200 border border-amber-500/40 animate-pulse">
            {thinkingLabel ?? '思考中'}
          </span>
        </div>
      )}
      {isActive && !isThinking && (
        <div className="absolute top-2 right-2 flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full bg-yellow-400 shadow-[0_0_12px_rgba(250,204,21,0.6)]" />
          <span className="hidden sm:inline text-[10px] font-black uppercase tracking-wider text-yellow-300">
            {speakingLabel ?? 'Speaking'}
          </span>
        </div>
      )}
    </div>
  );
};

export default DebaterCard;
