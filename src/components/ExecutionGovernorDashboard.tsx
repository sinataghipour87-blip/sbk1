import React, { useState, useEffect } from 'react';
import { ExecutionMode } from '../types/trading';
import { getExecutionSettings, getSelectedExecutionMode, saveSelectedExecutionMode } from '../services/executionMode';

interface Props {
    onModeSelected: (mode: ExecutionMode, isLocalSelection: boolean) => void;
}

const ExecutionGovernorDashboard: React.FC<Props> = ({ onModeSelected }) => {
    const [mode, setMode] = useState<ExecutionMode>(() => getSelectedExecutionMode());
    const [ceiling, setCeiling] = useState(() => {
        const savedCeiling = localStorage.getItem('quantum_live_capital_ceiling_pct');
        const parsedCeiling = savedCeiling === null ? 5 : Number(savedCeiling);
        return Number.isFinite(parsedCeiling) ? parsedCeiling : 5;
    });
    const [loading, setLoading] = useState(false);
    const [updateError, setUpdateError] = useState<string | null>(null);
    useEffect(() => {
        const selectedMode = getSelectedExecutionMode();
        onModeSelected(selectedMode, false);
        if (selectedMode === 'LIVE') {
            getExecutionSettings()
                .then(settings => {
                    if (settings.liveCapitalCeilingPct !== undefined) {
                        setCeiling(settings.liveCapitalCeilingPct);
                        localStorage.setItem('quantum_live_capital_ceiling_pct', String(settings.liveCapitalCeilingPct));
                    }
                })
                .catch((error: unknown) => {
                    const message = error instanceof Error ? error.message : 'خطای نامشخص';
                    setUpdateError(`دریافت تنظیمات حالت LIVE ناموفق بود (${message}).`);
                });
        }
    }, [onModeSelected]);

    const handleUpdate = (newMode: ExecutionMode, newCeiling: number) => {
        if (loading) return;
        setUpdateError(null);

        if (newMode !== 'LIVE') {
            saveSelectedExecutionMode(newMode);
            localStorage.setItem('quantum_live_capital_ceiling_pct', String(newCeiling));
            onModeSelected(newMode, true);
            setMode(newMode);
            setCeiling(newCeiling);
            setLoading(false);
            return;
        }

        const adminToken = localStorage.getItem('admin_token');
        if (!adminToken) {
            setUpdateError('برای انتخاب حالت LIVE، توکن ادمین در دسترس نیست.');
            return;
        }

        setLoading(true);
        fetch('/api/execution/mode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
            body: JSON.stringify({ mode: newMode, liveCapitalCeilingPct: newCeiling })
        })
        .then(response => {
            if (response.status === 403) {
                throw new Error('دسترسی ادمین رد شد؛ توکن را بررسی کنید.');
            }
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            saveSelectedExecutionMode(newMode);
            localStorage.setItem('quantum_live_capital_ceiling_pct', String(newCeiling));
            onModeSelected(newMode, true);
            setMode(newMode);
            setCeiling(newCeiling);
            setLoading(false);
        })
        .catch((error: unknown) => {
            setLoading(false);
            const message = error instanceof Error ? error.message : 'خطای نامشخص';
            setUpdateError(`ذخیره حالت LIVE روی سرور ناموفق بود (${message}).`);
        });
    };

    return (
        <div className="p-4 bg-slate-900 border border-slate-700 rounded-lg text-white">
            <h2 className="text-lg font-bold mb-4">مدیریت حالت اجرا (Execution Governor)</h2>
            <div className="flex gap-2 mb-4">
                {(['BACKTEST', 'TESTNET', 'PAPER', 'LIVE'] as ExecutionMode[]).map(m => (
                    <button
                        key={m}
                        disabled={loading}
                        className={`px-3 py-1 rounded ${mode === m ? 'bg-blue-600' : 'bg-slate-700'}`}
                        onClick={() => handleUpdate(m, ceiling)}
                    >
                        {m}
                    </button>
                ))}
            </div>
            {updateError && <p className="mb-4 text-sm text-amber-300">{updateError}</p>}
            <div className="mb-4">
                <label>سقف سرمایه لایو (%):</label>
                <input 
                    type="number" 
                    value={ceiling ?? 5} 
                    onChange={(e) => {
                        const nextCeiling = Number(e.target.value) || 5;
                        setCeiling(nextCeiling);
                        localStorage.setItem('quantum_live_capital_ceiling_pct', String(nextCeiling));
                    }}
                    className="ml-2 bg-slate-800 p-1 rounded"
                />
            </div>
            <div className="bg-slate-800 p-3 rounded">
                <h3 className="font-bold">داشبورد مقایسه‌ای</h3>
                <p>وضعیت فعلی: {mode}</p>
                <p>اسلیپیج واقعی در برابر پیش‌بینی: -</p>
                {/* Comparison logic goes here */}
            </div>
        </div>
    );
};

export default ExecutionGovernorDashboard;
