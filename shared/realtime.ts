export interface MatchScoreUpdate {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  status: string;
  scoreDetails?: string;
  currentOver?: number;
  currentBall?: number;
  currentInning?: number;
  targetRuns?: number | null;
  live?: any;
  innings?: any[];
  roStatusRaw?: string | null;
  roPlayStatus?: string | null;
  toss_won_by?: string | null;
  elected_to?: string | null;
  tossDecision?: string | null;
  battingTeam?: string;
  runs?: number;
  wickets?: number;
  overs?: string;
  runRate?: string;
  timestamp: number;
  marketsSuspended?: boolean;
}

export interface BallResult {
  matchId: string;
  inning?: number;
  over: number;
  ball: number;
  subBall?: number;
  runsScored: number;
  extras?: number;
  totalRuns?: number;
  isWicket: boolean;
  isBoundary: boolean;
  isSix: boolean;
  isExtra: boolean;
  batsmanName?: string | null;
  bowlerName?: string | null;
  isLegal?: boolean;
  outcome?: string;
  timestamp: number;
}

export interface MarketUpdate {
  matchId: string;
  status?: string;
  markets?: any[];
  timestamp?: number;
}

export interface BetSettlement {
  betId: string;
  matchId: string;
  marketId: string;
  userId: string;
  outcome: string;
  winningOutcome: string;
  status: "WON" | "LOST" | "VOID";
  stake: number;
  payout: number;
  timestamp: number;
}

export interface WalletUpdate {
  userId: string;
  balance?: number;
  exposure?: number;
  change: number;
  reason?: string;
  timestamp: number;
}
