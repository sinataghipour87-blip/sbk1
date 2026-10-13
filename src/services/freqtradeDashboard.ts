export interface FreqtradeDashboardStatus {
  killSwitchActive: boolean;
  freqtrade: {
    status: 'running' | 'stopped';
    dryRun: boolean;
    demoTrading?: boolean;
    forceEntryEnabled: boolean;
  };
  activePositions: Array<{
    tradeId: number;
    pair: string;
    direction: 'LONG' | 'SHORT';
    amount: number;
    openRate: number;
  }>;
}

export interface FreqtradeClosedTrade {
  trade_id: number;
  pair: string;
  is_open: false;
  is_short: boolean;
  close_timestamp: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFreqtradeDashboardStatus(value: unknown): value is FreqtradeDashboardStatus {
  return (
    isRecord(value) &&
    typeof value.killSwitchActive === 'boolean' &&
    isRecord(value.freqtrade) &&
    (value.freqtrade.status === 'running' || value.freqtrade.status === 'stopped') &&
    typeof value.freqtrade.dryRun === 'boolean' &&
    typeof value.freqtrade.forceEntryEnabled === 'boolean' &&
    (value.freqtrade.demoTrading === undefined || typeof value.freqtrade.demoTrading === 'boolean') &&
    Array.isArray(value.activePositions) &&
    value.activePositions.every((position: unknown) =>
      isRecord(position) &&
      Number.isSafeInteger(position.tradeId) &&
      typeof position.pair === 'string' &&
      (position.direction === 'LONG' || position.direction === 'SHORT') &&
      typeof position.amount === 'number' &&
      Number.isFinite(position.amount) &&
      typeof position.openRate === 'number' &&
      Number.isFinite(position.openRate)
    )
  );
}

function isFreqtradeClosedTrade(value: unknown): value is FreqtradeClosedTrade {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.trade_id) &&
    typeof value.pair === 'string' &&
    value.is_open === false &&
    typeof value.is_short === 'boolean' &&
    (value.close_timestamp === null || typeof value.close_timestamp === 'number')
  );
}

async function fetchAdminJson(path: string): Promise<unknown> {
  const adminToken = localStorage.getItem('admin_token');
  if (!adminToken) {
    throw new Error('The admin token is unavailable; protected Freqtrade data cannot be read.');
  }
  const response = await fetch(path, {
    headers: { 'x-admin-token': adminToken },
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Protected Freqtrade request failed with HTTP ${response.status}.`);
  }
  return response.json();
}

export async function getFreqtradeDashboardStatus(): Promise<FreqtradeDashboardStatus> {
  const value: unknown = await fetchAdminJson('/api/live/status');
  if (!isFreqtradeDashboardStatus(value)) {
    throw new Error('Protected Freqtrade status response is invalid.');
  }
  return value;
}

export async function getFreqtradeClosedTrades(): Promise<FreqtradeClosedTrade[]> {
  const value: unknown = await fetchAdminJson('/api/live/closed-trades');
  if (!isRecord(value) || !Array.isArray(value.trades)) {
    throw new Error('Protected Freqtrade closed-trade response is invalid.');
  }
  return value.trades.map((trade: unknown) => {
    if (!isFreqtradeClosedTrade(trade)) {
      throw new Error('Protected Freqtrade history contains an invalid closed trade.');
    }
    return trade;
  });
}
