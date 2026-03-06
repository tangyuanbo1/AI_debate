
import React from 'react';
import { Debater } from '../types';

interface DebaterCardProps {
  debater: Debater;
  isActive: boolean;
  side: 'PRO' | 'CON';
}

const DebaterCard: React.FC<DebaterCardProps> = ({ debater, isActive, side }) => {
  const sideColor = side === 'PRO' ? 'border-blue-500' : 'border-red-500';
  const glowClass = isActive ? (side === 'PRO' ? 'ring-4 ring-blue-500/50 scale-105' : 'ring-4 ring-red-500/50 scale-105') : '';

  return (
    <div
      className={`relative transition-all duration-500 p-2 sm:p-4 rounded-2xl bg-slate-800 border-2 ${sideColor} ${glowClass} flex flex-col items-center gap-1.5 sm:gap-2 w-full min-w-[112px] sm:min-w-[160px] max-w-[180px]`}
    >
      <img
        src={debater.avatar}
        alt={debater.name}
        className="w-14 h-14 sm:w-20 sm:h-20 rounded-full border-2 border-slate-600 object-cover shadow-lg"
      />
      <div className="text-center">
        <p className="font-bold text-[11px] sm:text-sm truncate w-24 sm:w-32">{debater.name}</p>
        <p className={`text-[10px] sm:text-xs font-semibold px-2 py-0.5 rounded-full mt-1 ${side === 'PRO' ? 'bg-blue-900/40 text-blue-300' : 'bg-red-900/40 text-red-300'}`}>
          {debater.role}
        </p>
      </div>
      {isActive && (
        <div className="absolute top-2 right-2 flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full bg-yellow-400 shadow-[0_0_12px_rgba(250,204,21,0.6)]" />
          <span className="hidden sm:inline text-[10px] font-black uppercase tracking-wider text-yellow-300">
            Speaking
          </span>
        </div>
      )}
    </div>
  );
};

export default DebaterCard;
