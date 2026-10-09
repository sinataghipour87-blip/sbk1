import { UserSettings } from '../types/trading';

const DEFAULT_SETTINGS: UserSettings = {
  riskPct: 1.5,
  emaPeriods: { fast: 20, slow: 50, trend: 200 },
  notificationsEnabled: true,
  autoTradeEnabled: false, // Default: OFF for maximum safety (Issue 26)
  precisionPullbackEnabled: true,
  rangeFilterEnabled: true,
  autoHedgeEnabled: true,
  takeProfitMode: 'STEPPED_3_TIER',
};

export const loadSettings = (): UserSettings => {
  const saved = localStorage.getItem('quantum_settings');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        takeProfitMode: parsed.takeProfitMode || 'STEPPED_3_TIER',
        autoHedgeEnabled: true, // Always enforce auto-hedge protection by default
        autoTradeEnabled: parsed.autoTradeEnabled === true, // Default to false unless explicitly activated
      };
    } catch (e) {
      return DEFAULT_SETTINGS;
    }
  }
  return DEFAULT_SETTINGS;
};

export const saveSettings = (settings: UserSettings) => {
  localStorage.setItem('quantum_settings', JSON.stringify(settings));
};
