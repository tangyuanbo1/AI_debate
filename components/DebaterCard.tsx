
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
    <div className={`relative transition-all duration-500 p-4 rounded-2xl bg-slate-800 border-2 ${sideColor} ${glowClass} flex flex-col items-center gap-2 w-full max-w-[180px]`}>
      <img src={debater.avatar} alt={debater.name} className="w-20 h-20 rounded-full border-2 border-slate-600 object-cover shadow-lg" />
      <div className="text-center">
        <p className="font-bold text-sm truncate w-32">{debater.name}</p>
        <p className={`text-xs font-semibold px-2 py-0.5 rounded-full mt-1 ${side === 'PRO' ? 'bg-blue-900/40 text-blue-300' : 'bg-red-900/40 text-red-300'}`}>
          {debater.role}
        </p>
      </div>
      {isActive && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-yellow-500 text-slate-900 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider animate-bounce">
          Speaking
        </div>
      )}
    </div>
  );
};

export default DebaterCard;
