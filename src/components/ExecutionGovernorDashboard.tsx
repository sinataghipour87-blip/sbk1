import React, { useState, useEffect } from 'react';
import { ExecutionMode } from '../types/trading';
import { getSelectedExecutionMode, saveSelectedExecutionMode } from '../services/executionMode';

interface Props {
    onModeSelected: (mode: ExecutionMode, isLocalSelection: boolean) => void;
}

const ExecutionGovernorDashboard: React.FC<Props> = ({ onModeSelected }) => {
    const [mode, setMode] = useState<ExecutionMode>(() => getSelectedExecutionMode());
    useEffect(() => {
        onModeSelected(mode, false);
    }, [onModeSelected]);

    const selectDryRun = () => {
        if (mode === 'DRY_RUN') return;
        saveSelectedExecutionMode('DRY_RUN');
        onModeSelected('DRY_RUN', true);
        setMode('DRY_RUN');
    };

    return (
        <div className="p-4 bg-slate-900 border border-slate-700 rounded-lg text-white">
            <h2 className="text-lg font-bold mb-4">حالت اجرای Freqtrade</h2>
            <div className="flex gap-2 mb-4">
                <button
                    type="button"
                    aria-pressed={mode === 'DRY_RUN'}
                    className={`px-3 py-1 rounded ${mode === 'DRY_RUN' ? 'bg-blue-600' : 'bg-slate-700'}`}
                    onClick={selectDryRun}
                >
                    FREQTRADE DRY-RUN
                </button>
            </div>
            <p className="mb-4 text-xs text-slate-300">
                فقط کیف پول مجازی DRY_RUN فریکترید در این رابط قابل انتخاب است. مجوز ارسال سیگنال production جداگانه و مستقل کنترل می‌شود.
            </p>
        </div>
    );
};

export default ExecutionGovernorDashboard;
