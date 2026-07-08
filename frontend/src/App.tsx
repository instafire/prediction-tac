import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { ethers } from "ethers";
import {
  TrendingUp, Trophy, Flame, Zap, Wallet, BarChart3, Shield, Clock,
  ChevronDown, Sparkles, Target, Award, Crown, Medal, Star, Activity,
  ArrowUpRight, ArrowDownRight, RefreshCw, Plus, Pause, Play, Landmark,
  CircleDollarSign, Users, Eye, Scale, PartyPopper, Gauge, X,
  Search, ArrowUpDown, Bookmark, Link2, Palette, Home, User, Settings,
  Calculator, HelpCircle, Bell, Download, Share2, WifiOff, History,
  Volume2, Vibrate, Moon
} from "lucide-react";
import abi from "./abi.json";
import "./App.css";
import { BrandMark, CatArt, EmptyMarketsArt, EmptyVaultArt, HeroChartArt, LoadingSkeleton } from "./graphics";
import { loadPrefs, savePrefs, type Prefs } from "./lib/prefs";
import { playSound } from "./lib/sounds";
import { loadJournal, pushJournal, clearJournal, type TxEntry } from "./lib/txJournal";

// ─── Runtime config (admin-settable, overrides build-time env) ───
interface RuntimeConfig { contract?: string; rpc?: string; chain?: "mainnet" | "testnet" | "local" }
function loadRuntimeConfig(): RuntimeConfig {
  try {
    const raw = JSON.parse(localStorage.getItem("ptac-config") || "{}");
    return typeof raw === "object" && raw !== null ? raw : {};
  } catch { return {} }
}
function saveRuntimeConfig(cfg: RuntimeConfig) {
  try { localStorage.setItem("ptac-config", JSON.stringify(cfg)) } catch {}
}
function isValidRpc(url: string): boolean {
  return /^https?:\/\//i.test(url);
}
const RT_CONFIG = loadRuntimeConfig();
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
const ENV_CONTRACT = (import.meta.env.VITE_CONTRACT_ADDRESS as string) || ZERO_ADDR;
const CONTRACT_ADDRESS = (RT_CONFIG.contract && ethers.isAddress(RT_CONFIG.contract) ? RT_CONFIG.contract : ENV_CONTRACT);
const ENV_CHAIN = ((import.meta.env.VITE_CHAIN as string) || "").toLowerCase();
const CHAIN_PREF = RT_CONFIG.chain || (ENV_CHAIN === "local" || ENV_CHAIN === "testnet" || ENV_CHAIN === "mainnet" ? ENV_CHAIN as RuntimeConfig["chain"] : "mainnet");
const TAC_RPC = RT_CONFIG.rpc
  || (import.meta.env.VITE_TAC_RPC as string)
  || (CHAIN_PREF === "local" ? "http://127.0.0.1:8545" : "https://rpc.tac.build");
const TAC_CHAIN_ID = "0xEF";
const TAC_CHAIN_ID_TESTNET = "0x957";
const LOCAL_CHAIN_ID = "0x7A69"; // 31337 Anvil
const ACTIVE_CHAIN = CHAIN_PREF === "local" ? LOCAL_CHAIN_ID : CHAIN_PREF === "testnet" ? TAC_CHAIN_ID_TESTNET : TAC_CHAIN_ID;
const ACTIVE_CHAIN_NAME = CHAIN_PREF === "local" ? "Local Anvil" : CHAIN_PREF === "testnet" ? "TAC Testnet" : "TAC Mainnet";
const NATIVE_SYMBOL = CHAIN_PREF === "local" ? "ETH" : "TAC";
const NOT_DEPLOYED = CONTRACT_ADDRESS === ZERO_ADDR;

const CATEGORIES = ["crypto", "politics", "sports", "tech", "culture", "misc"] as const;
const CAT_ICONS: Record<string, string> = { crypto: "₿", politics: "🏛", sports: "⚽", tech: "🚀", culture: "🎬", misc: "🎲" };
const CAT_LABEL: Record<string, string> = { crypto: "Crypto", politics: "Politics", sports: "Sports", tech: "Tech", culture: "Culture", misc: "Misc" };
const DURATIONS: Record<string, number> = { "1 day": 1, "3 days": 3, "7 days": 7, "14 days": 14, "30 days": 30, "90 days": 90 };
const FAQ_ITEMS: { q: string; a: string }[] = [
  { q: "How do payouts work?", a: "Pari-mutuel pools: winners split the losing side pro-rata after a protocol fee on profit. Your stake returns plus your share of the other side." },
  { q: "What is the vault?", a: "Deposit TAC once into the on-chain vault. Bets pull from your vault balance so you skip per-trade wallet confirms for every click." },
  { q: "Can I exit early?", a: "Yes. Sell returns face-value stake (minus fee) to your vault and removes liquidity from that side. Odds shift when you exit." },
  { q: "How is resolution fair?", a: "Owner resolves after deadline. Bettors get a 3-day dispute window. One-sided expired markets can be refunded by anyone." },
  { q: "Is this a Telegram Mini App?", a: "Yes. Open it inside Telegram for haptics, full-screen, and share flows. Desktop wallets work the same via MetaMask-compatible providers." },
  { q: "Demo mode?", a: "If no contract address is set, you trade a simulated wallet with seeded markets. Flip to live from Admin → Launch Setup." },
];

const STATUS = { Open: 0, Resolved: 1, Disputed: 2, Cancelled: 3, Refunded: 4 } as const;
const SIDE = { None: 0, Yes: 1, No: 2 } as const;

// ─── Gamification ───
const LEVELS = [
  { xp: 0, title: "Rookie", icon: "🥚" },
  { xp: 50, title: "Novice", icon: "🐣" },
  { xp: 150, title: "Forecaster", icon: "🔮" },
  { xp: 350, title: "Analyst", icon: "📊" },
  { xp: 700, title: "Sharp", icon: "🎯" },
  { xp: 1200, title: "Oracle", icon: "🦉" },
  { xp: 2000, title: "Prophet", icon: "⚡" },
  { xp: 3500, title: "Legend", icon: "👑" },
];

interface Achievement { id: string; name: string; desc: string; icon: string; test: (s: Stats, m: Market[]) => boolean }
const ACHIEVEMENTS: Achievement[] = [
  { id: "first-bet", name: "First Blood", desc: "Place your first bet", icon: "🩸", test: s => s.betsPlaced >= 1 },
  { id: "first-win", name: "Winner Winner", desc: "Win your first market", icon: "🏆", test: s => s.wins >= 1 },
  { id: "creator", name: "Market Maker", desc: "Create a market", icon: "✨", test: s => s.marketsCreated >= 1 },
  { id: "five-bets", name: "Regular", desc: "Place 5 bets", icon: "🎰", test: s => s.betsPlaced >= 5 },
  { id: "high-roller", name: "High Roller", desc: "Stake 100+ TAC total", icon: "💎", test: s => s.totalStaked >= ethers.parseEther("100") },
  { id: "three-wins", name: "Hat Trick", desc: "Win 3 markets", icon: "🎩", test: s => s.wins >= 3 },
  { id: "sharp", name: "Sharp Shooter", desc: "Win rate above 60% (5+ bets)", icon: "🎯", test: s => s.betsPlaced >= 5 && s.wins * 100 / Math.max(1, s.wins + s.losses) > 60 },
  { id: "whale", name: "Whale", desc: "Stake 1000+ TAC total", icon: "🐋", test: s => s.totalStaked >= ethers.parseEther("1000") },
  { id: "serial", name: "Serial Creator", desc: "Create 5 markets", icon: "🏭", test: s => s.marketsCreated >= 5 },
  { id: "profit", name: "In The Green", desc: "Total won exceeds total staked", icon: "🌱", test: s => s.totalWon > s.totalStaked && s.totalStaked > 0n },
];

interface Stats { marketsCreated: number; betsPlaced: number; wins: number; losses: number; totalStaked: bigint; totalWon: bigint }
interface Market {
  id: number; creator: string; question: string; description: string; category: string;
  resolutionTime: number; createdAt: number; totalYesPool: bigint; totalNoPool: bigint;
  status: number; winner: number; yesBettors: number; noBettors: number;
  mySide: number; myAmount: bigint; myClaimed: boolean; potYes: bigint; potNo: bigint;
  resolutionSource?: string;
  outcomeCount?: number; // 2 = binary, 3+ = multi
  outcomeLabels?: string[];
  outcomePools?: bigint[];
  outcomeBettors?: number[];
  myOutcomeIndex?: number; // multi: 0-based; -1 none
  winnerOutcome?: number;
}
interface Activity { type: string; text: string; time: number; block: number }
interface PricePoint { t: number; yes: number }
interface Leader { addr: string; volume: bigint; bets: number; wins: number }
interface MarketComment { marketId: number; author: string; body: string; time: number }

function loadComments(): MarketComment[] {
  try { return JSON.parse(localStorage.getItem("ptac-comments") || "[]") } catch { return [] }
}
function saveComments(c: MarketComment[]) {
  try { localStorage.setItem("ptac-comments", JSON.stringify(c.slice(0, 200))) } catch {}
}
function multiOdds(pools: bigint[]): number[] {
  const total = pools.reduce((a, b) => a + b, 0n);
  if (total === 0n) return pools.map(() => Math.round(1000 / pools.length) / 10);
  return pools.map(p => Math.round(Number((p * 1000n) / total)) / 10);
}

declare global { interface Window { ethereum?: any; Telegram?: { WebApp?: any } } }

// ─── Streaks + Daily Quests (local, per-device) ───
const DAY_MS = 86400000;
function todayKey(): string { return new Date().toISOString().slice(0, 10); }
function loadStreak(): { count: number; last: string } {
  try { return JSON.parse(localStorage.getItem("ptac-streak") || "") } catch { return { count: 0, last: "" } }
}
function bumpStreak(): { count: number; last: string; isNew: boolean } {
  const s = loadStreak();
  const today = todayKey();
  if (s.last === today) return { ...s, isNew: false };
  const yesterday = new Date(Date.now() - DAY_MS).toISOString().slice(0, 10);
  const count = s.last === yesterday ? s.count + 1 : 1;
  const next = { count, last: today };
  try { localStorage.setItem("ptac-streak", JSON.stringify(next)) } catch {}
  return { ...next, isNew: true };
}

interface Quest { id: string; name: string; desc: string; icon: string; goal: number; xp: number }
const DAILY_QUESTS: Quest[] = [
  { id: "scout", name: "Scout", desc: "Open 3 market cards", icon: "🔍", goal: 3, xp: 15 },
  { id: "conviction", name: "Conviction", desc: "Place a bet", icon: "🎯", goal: 1, xp: 30 },
  { id: "signal", name: "Signal Boost", desc: "Share a market link", icon: "📡", goal: 1, xp: 20 },
  { id: "curator", name: "Curator", desc: "Watchlist a market", icon: "🔖", goal: 1, xp: 15 },
];
type QuestProgress = Record<string, number>;
function loadQuests(): QuestProgress {
  try {
    const raw = JSON.parse(localStorage.getItem("ptac-quests") || "");
    if (raw.day === todayKey()) return raw.progress || {};
  } catch {}
  return {};
}
function saveQuests(progress: QuestProgress) {
  try { localStorage.setItem("ptac-quests", JSON.stringify({ day: todayKey(), progress })) } catch {}
}
function loadBonusXp(): number {
  try { return parseInt(localStorage.getItem("ptac-bonusxp") || "0", 10) || 0 } catch { return 0 }
}
function saveBonusXp(v: number) { try { localStorage.setItem("ptac-bonusxp", String(v)) } catch {} }

const TG = typeof window !== "undefined" ? window.Telegram?.WebApp : undefined;
const IN_TELEGRAM = !!TG?.initData || !!TG?.platform && TG.platform !== "unknown";
let prefsHaptics = true;
function tgHaptic(type: "light" | "medium" | "success" | "error" = "light") {
  try {
    if (!prefsHaptics || !TG?.HapticFeedback) return;
    if (type === "success" || type === "error") TG.HapticFeedback.notificationOccurred(type);
    else TG.HapticFeedback.impactOccurred(type);
  } catch { /* noop */ }
}

function exportPositionsCsv(rows: { question: string; side: string; amount: string; status: string; pnl?: string }[]) {
  const header = "question,side,amount_tac,status,note\n";
  const body = rows.map(r =>
    `"${r.question.replace(/"/g, '""')}",${r.side},${r.amount},${r.status},"${(r.pnl || "").replace(/"/g, '""')}"`
  ).join("\n");
  const blob = new Blob([header + body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `prediction-tac-positions-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Demo mode data (shown until the contract is deployed) ───
function buildDemoData(nowSec: number) {
  const E = (n: string) => ethers.parseEther(n);
  const mk = (
    id: number, question: string, description: string, category: string,
    hoursLeft: number, yes: string, no: string, yesB: number, noB: number,
    status = STATUS.Open as number, winner = SIDE.None as number,
    mySide = SIDE.None as number, myAmount = "0",
    resolutionSource = "",
  ): Market => ({
    id, creator: "0xd3a0000000000000000000000000000000000001", question, description, category,
    resolutionTime: nowSec + Math.round(hoursLeft * 3600),
    createdAt: nowSec - Math.round((72 - Math.min(hoursLeft, 72)) * 1800) - id * 3600,
    totalYesPool: E(yes), totalNoPool: E(no), status, winner,
    yesBettors: yesB, noBettors: noB,
    mySide, myAmount: E(myAmount), myClaimed: false,
    potYes: mySide === SIDE.Yes && E(yes) > 0n ? E(myAmount) * (E(yes) + E(no)) / E(yes) : 0n,
    potNo: mySide === SIDE.No && E(no) > 0n ? E(myAmount) * (E(yes) + E(no)) / E(no) : 0n,
    resolutionSource,
    outcomeCount: 2,
    outcomeLabels: ["YES", "NO"],
    outcomePools: [E(yes), E(no)],
    outcomeBettors: [yesB, noB],
    myOutcomeIndex: mySide === SIDE.Yes ? 0 : mySide === SIDE.No ? 1 : -1,
    winnerOutcome: winner === SIDE.Yes ? 0 : winner === SIDE.No ? 1 : 0,
  });
  const multi: Market = {
    id: 10, creator: "0xd3a0000000000000000000000000000000000001",
    question: "Which chain wins Q3 developer mindshare?",
    description: "Resolves to the ecosystem with the highest Electric Capital developer report rank shift.",
    category: "tech",
    resolutionTime: nowSec + 120 * 3600,
    createdAt: nowSec - 40 * 3600,
    totalYesPool: 0n, totalNoPool: 0n, status: STATUS.Open, winner: SIDE.None,
    yesBettors: 0, noBettors: 0, mySide: SIDE.None, myAmount: 0n, myClaimed: false, potYes: 0n, potNo: 0n,
    resolutionSource: "https://www.developerreport.com",
    outcomeCount: 4,
    outcomeLabels: ["TON / TAC", "Solana", "Base", "Other L2"],
    outcomePools: [E("2100"), E("1800"), E("1500"), E("900")],
    outcomeBettors: [18, 15, 12, 9],
    myOutcomeIndex: -1,
    winnerOutcome: 0,
  };
  const markets: Market[] = [
    multi,
    mk(9, "Will TAC hit a new all-time-high volume this month?", "Resolves YES if TAC daily DEX volume sets a new record before month end (source: tac.build analytics).", "crypto", 96, "4200", "2800", 34, 21, STATUS.Open, SIDE.None, SIDE.Yes, "120", "https://tac.build/analytics"),
    mk(8, "Will BTC close above $120k this Friday?", "Based on Coinbase BTC-USD daily close, UTC.", "crypto", 30, "1850", "2400", 28, 33, STATUS.Open, SIDE.None, SIDE.No, "40", "Coinbase BTC-USD"),
    mk(7, "Will a Telegram Mini App pass 100M MAU this quarter?", "Any TON-ecosystem mini app; official Telegram or project announcements count.", "tech", 41, "980", "1420", 17, 22, STATUS.Open, SIDE.None, SIDE.None, "0", "Telegram / project blogs"),
    mk(6, "Will the next World Cup qualifier end in a draw?", "Official FIFA result at 90 minutes plus stoppage.", "sports", 18, "310", "540", 9, 14, STATUS.Open, SIDE.None, SIDE.None, "0", "FIFA.com"),
    mk(5, "Will it rain in Toronto tomorrow?", "Resolves YES if Environment Canada records ≥1mm precipitation at Toronto City station.", "misc", 14, "95", "150", 8, 11, STATUS.Open, SIDE.None, SIDE.None, "0", "Environment Canada"),
    mk(4, "Will TON stay in the top-15 by market cap this week?", "CoinGecko ranking snapshot Sunday 23:59 UTC.", "crypto", 60, "760", "240", 19, 6, STATUS.Open, SIDE.None, SIDE.None, "0", "CoinGecko"),
    mk(3, "Will the new blockbuster cross $1B worldwide?", "Box Office Mojo worldwide gross by end of run.", "culture", 200, "420", "580", 12, 15),
    mk(2, "Did ETH close above $4k last Friday?", "Resolved from Coinbase ETH-USD daily close.", "crypto", -30, "1200", "800", 22, 15, STATUS.Resolved, SIDE.Yes, SIDE.Yes, "50", "Coinbase ETH-USD"),
    mk(1, "Was the launch delayed again?", "Resolved from the official mission page.", "tech", -80, "300", "700", 7, 16, STATUS.Resolved, SIDE.No),
  ];
  const hist: Record<number, PricePoint[]> = {};
  for (const m of markets) {
    const target = m.status === STATUS.Resolved
      ? (m.winner === SIDE.Yes ? 78 : 24)
      : odds(m.totalYesPool, m.totalNoPool).y;
    const n = 12 + (m.id % 4) * 3;
    const pts: PricePoint[] = [];
    let v = 50;
    for (let i = 0; i < n; i++) {
      const t = m.createdAt + Math.round(((nowSec - m.createdAt) / n) * i);
      const drift = (target - v) * 0.3;
      const wob = Math.sin(i * 1.3 + m.id) * 3.2 + Math.cos(i * 0.7 + m.id * 2) * 2.1;
      v = Math.min(96, Math.max(4, v + drift + wob));
      pts.push({ t, yes: Math.round(v * 10) / 10 });
    }
    pts.push({ t: nowSec, yes: target });
    hist[m.id] = pts;
  }
  const acts: Activity[] = [
    { type: "bet", text: "0x3fA9c2… bet 250 TAC on YES", time: nowSec - 120, block: 1284411 },
    { type: "sell", text: "0x5e0Cd1… sold 80 TAC of NO position", time: nowSec - 210, block: 1284390 },
    { type: "create", text: "New market: \"Will TAC hit a new all-time-high volume this month?\"", time: nowSec - 300, block: 1284360 },
    { type: "claim", text: "0x81eD40… claimed 1,120 TAC", time: nowSec - 900, block: 1284215 },
    { type: "bet", text: "0xC04b77… bet 75 TAC on NO", time: nowSec - 1500, block: 1284101 },
    { type: "deposit", text: "0x9A11f3… deposited 500 TAC", time: nowSec - 2400, block: 1283988 },
    { type: "resolve", text: "Market #2 resolved: YES won", time: nowSec - 4000, block: 1283710 },
  ];
  const leaders: Leader[] = [
    { addr: "0x81ed40b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7", volume: E("5400"), bets: 41, wins: 19 },
    { addr: "0x3fa9c2aa11bb22cc33dd44ee55ff66aa77bb88cc", volume: E("3150"), bets: 27, wins: 12 },
    { addr: "0xc04b77dd88ee99ff00aa11bb22cc33dd44ee55ff", volume: E("2020"), bets: 33, wins: 9 },
    { addr: "0x9a11f355667788990011aabbccddeeff00112233", volume: E("1480"), bets: 15, wins: 7 },
    { addr: "0x5e0cd1224466880022446688aabbccddeeff0011", volume: E("870"), bets: 11, wins: 4 },
  ];
  return { markets, hist, acts, leaders };
}

function fmt(wei: bigint, dp = 2): string {
  const f = parseFloat(ethers.formatEther(wei));
  if (f >= 1000) return f.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return f.toLocaleString(undefined, { maximumFractionDigits: dp });
}
function statusLabel(s: number): string { return (["Open", "Resolved", "Disputed", "Cancelled", "Refunded"] as const)[s] || "?" }
function sideLabel(s: number): string { return (["—", "YES", "NO"] as const)[s] || "—" }
function timeLeft(resolution: number, now: number, status: number): string {
  if (status !== STATUS.Open) return statusLabel(status);
  if (now >= resolution) return "Ended";
  const diff = resolution - now;
  const d = Math.floor(diff / 86400), h = Math.floor((diff % 86400) / 3600), m = Math.floor((diff % 3600) / 60), s = diff % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
function odds(yes: bigint, no: bigint): { y: number; n: number } {
  const total = yes + no;
  if (total === 0n) return { y: 50, n: 50 };
  const y = Number((yes * 1000n) / total) / 10;
  return { y: Math.round(y * 10) / 10, n: Math.round((100 - y) * 10) / 10 };
}
function levelFor(xp: number) {
  let cur = LEVELS[0], next = LEVELS[1] || null, idx = 0;
  for (let i = 0; i < LEVELS.length; i++) if (xp >= LEVELS[i].xp) { cur = LEVELS[i]; idx = i; next = LEVELS[i + 1] || null }
  const pct = next ? Math.min(100, ((xp - cur.xp) / (next.xp - cur.xp)) * 100) : 100;
  return { ...cur, level: idx + 1, next, pct };
}

// ─── Animated components ───
function CountUp({ value, suffix = "", dp = 1 }: { value: number; suffix?: string; dp?: number }) {
  const [display, setDisplay] = useState(0);
  const animated = useRef(false);
  const cur = useRef(0);
  useEffect(() => {
    if (animated.current || value === 0) {
      cur.current = value;
      setDisplay(value);
      if (value !== 0) animated.current = true;
      return;
    }
    animated.current = true;
    let raf: number;
    const start = performance.now(), from = cur.current, dur = 700;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = from + (value - from) * eased;
      cur.current = v; setDisplay(v);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{display.toLocaleString(undefined, { maximumFractionDigits: dp })}{suffix}</>;
}

function ProbChart({ points, height = 120 }: { points: PricePoint[]; height?: number }) {
  if (points.length < 2) return (
    <div className="chart-empty" style={{ height }}>
      <Activity size={16} /> Price history builds as bets come in
    </div>
  );
  const w = 600, h = height, pad = 10, padL = 34;
  const ts = points.map(p => p.t), ys = points.map(p => p.yes);
  const minT = Math.min(...ts), maxT = Math.max(...ts) || minT + 1;
  const x = (t: number) => padL + ((t - minT) / Math.max(1, maxT - minT)) * (w - padL - pad);
  const y = (v: number) => h - pad - (v / 100) * (h - pad * 2);
  const pts = points.map(p => [x(p.t), y(p.yes)] as const);
  let path = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = pts[i - 1], [cx, cy] = pts[i];
    const mx = (px + cx) / 2;
    path += ` C${mx.toFixed(1)},${py.toFixed(1)} ${mx.toFixed(1)},${cy.toFixed(1)} ${cx.toFixed(1)},${cy.toFixed(1)}`;
  }
  const last = ys[ys.length - 1], first = ys[0];
  const up = last >= first;
  const cls = up ? "spark-up" : "spark-down";
  const area = `${path} L${pts[pts.length - 1][0].toFixed(1)},${h - pad} L${pts[0][0].toFixed(1)},${h - pad} Z`;
  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${w} ${h}`} className={`prob-chart ${cls}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[25, 50, 75].map(g => (
          <g key={g}>
            <line x1={padL} y1={y(g)} x2={w - pad} y2={y(g)} className={`chart-grid ${g === 50 ? "mid" : ""}`} />
            <text x={padL - 6} y={y(g) + 3} className="chart-tick" textAnchor="end">{g}%</text>
          </g>
        ))}
        <path d={area} fill="url(#chartFill)" stroke="none" />
        <path d={path} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" className="chart-line" />
        <circle cx={pts[pts.length - 1][0]} cy={y(last)} r="4" fill="currentColor" className="chart-dot" />
      </svg>
      <div className="chart-labels">
        <span className={up ? "up" : "down"}>{up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />} YES {last.toFixed(1)}%</span>
        <span className="chart-range">{points.length} trades</span>
      </div>
    </div>
  );
}

function Sparkline({ points }: { points: PricePoint[] }) {
  if (points.length < 2) return null;
  const w = 320, h = 64, pad = 6;
  const ts = points.map(p => p.t);
  const minT = Math.min(...ts), maxT = Math.max(...ts) || minT + 1;
  const x = (t: number) => pad + ((t - minT) / Math.max(1, maxT - minT)) * (w - pad * 2);
  const y = (v: number) => h - pad - (v / 100) * (h - pad * 2);
  const pts = points.map(p => [x(p.t), y(p.yes)] as const);
  let path = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = pts[i - 1], [cx, cy] = pts[i];
    const mx = (px + cx) / 2;
    path += ` C${mx.toFixed(1)},${py.toFixed(1)} ${mx.toFixed(1)},${cy.toFixed(1)} ${cx.toFixed(1)},${cy.toFixed(1)}`;
  }
  const up = points[points.length - 1].yes >= points[0].yes;
  const [ex, ey] = pts[pts.length - 1];
  const area = `${path} L${ex.toFixed(1)},${h - pad} L${pts[0][0].toFixed(1)},${h - pad} Z`;
  const gid = up ? "sparkFillUp" : "sparkFillDown";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={`sparkline ${up ? "spark-up" : "spark-down"}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} stroke="none" />
      <path d={path} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={ex} cy={ey} r="3" fill="currentColor" />
    </svg>
  );
}

function Ring({ pct, size = 60, label }: { pct: number; size?: number; label: string }) {
  const r = (size - 8) / 2, c = 2 * Math.PI * r;
  return (
    <div className="ring-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-bg" strokeWidth="5" fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-fg" strokeWidth="5" fill="none"
          strokeDasharray={c} strokeDashoffset={c - (pct / 100) * c} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <span className="ring-label">{label}</span>
    </div>
  );
}

function PayoutPreview({ amount, yesPool, noPool, feeBp }: { amount: string; yesPool: bigint; noPool: bigint; feeBp: number }) {
  const amt = parseFloat(amount);
  if (!amt || amt <= 0 || !isFinite(amt)) return null;
  const stake = ethers.parseEther(String(amt));
  const est = (side: 1 | 2) => {
    const my = stake;
    const winPool = (side === 1 ? yesPool : noPool) + my;
    const losePool = side === 1 ? noPool : yesPool;
    if (winPool === 0n) return { payout: 0, mult: 0 };
    const gross = my + (losePool * my) / winPool;
    const fee = (gross - my) * BigInt(feeBp) / 1000n;
    const net = gross - fee;
    const payout = parseFloat(ethers.formatEther(net));
    return { payout, mult: payout / amt };
  };
  const y = est(1), n = est(2);
  return (
    <div className="payout-preview">
      <span className="pp-label"><Gauge size={12} /> If you stake {amt} TAC now</span>
      <div className="pp-cols">
        <span className="pp-yes">YES pays <b>{y.payout.toFixed(2)}</b> TAC <small>({y.mult.toFixed(2)}x)</small></span>
        <span className="pp-no">NO pays <b>{n.payout.toFixed(2)}</b> TAC <small>({n.mult.toFixed(2)}x)</small></span>
      </div>
      <span className="pp-note">Estimates shift as others bet · fee {feeBp / 10}% on winnings</span>
    </div>
  );
}

interface PaletteItem { id: string; icon: React.ReactNode; label: string; hint?: string; run: () => void }
function CommandPalette({ open, onClose, items }: { open: boolean; onClose: () => void; items: PaletteItem[] }) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSel(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    const scored = items
      .map(it => {
        const hay = `${it.label} ${it.hint || ""}`.toLowerCase();
        let score = -1;
        if (hay.includes(q)) score = 100 - hay.indexOf(q);
        else {
          let qi = 0;
          for (let i = 0; i < hay.length && qi < q.length; i++) if (hay[i] === q[qi]) qi++;
          if (qi === q.length) score = 10;
        }
        return { it, score };
      })
      .filter(x => x.score >= 0)
      .sort((a, b) => b.score - a.score);
    return scored.map(x => x.it);
  }, [items, query]);

  useEffect(() => { setSel(0) }, [filtered.length]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.children[sel] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [sel, open]);

  if (!open) return null;
  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette" onClick={e => e.stopPropagation()}>
        <div className="palette-input">
          <Search size={16} />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Jump to market, switch view, change theme…"
            onKeyDown={e => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel(s => Math.min(filtered.length - 1, s + 1)) }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSel(s => Math.max(0, s - 1)) }
              else if (e.key === "Enter") { e.preventDefault(); const it = filtered[sel]; if (it) { it.run(); onClose() } }
              else if (e.key === "Escape") { e.preventDefault(); onClose() }
            }}
          />
          <kbd>esc</kbd>
        </div>
        <div className="palette-list" ref={listRef}>
          {filtered.length === 0 && <div className="palette-empty">No matches — try fewer letters.</div>}
          {filtered.map((it, i) => (
            <button
              key={it.id}
              className={`palette-item ${i === sel ? "sel" : ""}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => { it.run(); onClose() }}
            >
              <span className="pi-ico">{it.icon}</span>
              <span className="pi-label">{it.label}</span>
              {it.hint && <span className="pi-hint">{it.hint}</span>}
            </button>
          ))}
        </div>
        <div className="palette-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> select</span>
          <span><kbd>⌘K</kbd> toggle</span>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [signer, setSigner] = useState<ethers.JsonRpcSigner | null>(null);
  const [account, setAccount] = useState("");
  const [readProvider] = useState(() => new ethers.JsonRpcProvider(TAC_RPC));
  const [markets, setMarkets] = useState<Market[]>([]);
  const [vaultBalance, setVaultBalance] = useState<bigint>(0n);
  const [walletBalance, setWalletBalance] = useState<bigint>(0n);
  const [stats, setStats] = useState<Stats | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [paused, setPausedState] = useState(false);
  const [protocolFee, setProtocolFee] = useState(20);
  const [accFees, setAccFees] = useState<bigint>(0n);
  const [solvent, setSolvent] = useState(true);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [priceHistory, setPriceHistory] = useState<Record<number, PricePoint[]>>({});
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<"home" | "markets" | "vault" | "portfolio" | "leaderboard" | "admin" | "settings" | "tools">("home");
  const [theme, setTheme] = useState<string>(() => {
    try { return localStorage.getItem("ptac-theme") || "midnight"; } catch { return "midnight"; }
  });
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs());
  const [journal, setJournal] = useState<TxEntry[]>(() => loadJournal());
  const [showOnboarding, setShowOnboarding] = useState(() => !loadPrefs().onboardingDone);
  const [onboardStep, setOnboardStep] = useState(0);
  const [calcOpen, setCalcOpen] = useState(false);
  const [calcYes, setCalcYes] = useState("50");
  const [calcStake, setCalcStake] = useState("100");
  const [calcFee, setCalcFee] = useState("2");
  const [faqOpen, setFaqOpen] = useState<number | null>(0);
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [alertedIds, setAlertedIds] = useState<Set<number>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("ptac-alerted") || "[]")); } catch { return new Set(); }
  });
  const [tab, setTab] = useState<"all" | "open" | "ending" | "resolved" | "mine">("all");
  const [catFilter, setCatFilter] = useState("");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"trending" | "newest" | "ending" | "volume" | "watchlist">("trending");
  const [favorites, setFavorites] = useState<number[]>(() => {
    try { return JSON.parse(localStorage.getItem("ptac-favs") || "[]"); } catch { return []; }
  });
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [err, setErr] = useState("");
  const [chainOk, setChainOk] = useState(true);
  const [successAnimation, setSuccessAnimation] = useState<"ripple" | "money" | "connection" | null>(null);
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  const [newAchievement, setNewAchievement] = useState<Achievement | null>(null);
  const seenAchievements = useRef<Set<string>>(new Set(JSON.parse(localStorage.getItem("ptac-ach") || "[]")));
  const [streak, setStreak] = useState<{ count: number; last: string }>(() => loadStreak());
  const [showStreakPop, setShowStreakPop] = useState(false);
  const [quests, setQuests] = useState<QuestProgress>(() => loadQuests());
  const [bonusXp, setBonusXp] = useState<number>(() => loadBonusXp());
  // forms
  const [q, setQ] = useState("");
  const [desc, setDesc] = useState("");
  const [cat, setCat] = useState("crypto");
  const [stake, setStake] = useState("10");
  const [duration, setDuration] = useState("7 days");
  const [resolutionSource, setResolutionSource] = useState("");
  const [multiMode, setMultiMode] = useState(false);
  const [outcomeDrafts, setOutcomeDrafts] = useState<string[]>(["YES", "NO", ""]);
  const [comments, setComments] = useState<MarketComment[]>(() => loadComments());
  const [commentDraft, setCommentDraft] = useState<Record<number, string>>({});
  const [multiPick, setMultiPick] = useState<Record<number, number>>({});
  const [depositAmt, setDepositAmt] = useState("50");
  const [withdrawAmt, setWithdrawAmt] = useState("");
  const [betAmt, setBetAmt] = useState<Record<number, string>>({});
  const [sellAmt, setSellAmt] = useState<Record<number, string>>({});
  const [tradeMode, setTradeMode] = useState<Record<number, "buy" | "sell">>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [adminFee, setAdminFee] = useState("20");
  const [feeRecipient, setFeeRecipient] = useState("");
  const [adminMode, setAdminMode] = useState<"overview" | "launch" | "contract" | "ops">("overview");
  const [configDraft, setConfigDraft] = useState<RuntimeConfig>(() => ({
    contract: RT_CONFIG.contract || (NOT_DEPLOYED ? "" : CONTRACT_ADDRESS),
    rpc: RT_CONFIG.rpc || TAC_RPC,
    chain: RT_CONFIG.chain || "mainnet",
  }));
  const deepLinked = useRef(false);
  const demoSeeded = useRef(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.motion = prefs.reduceMotion ? "reduce" : "full";
    try { localStorage.setItem("ptac-theme", theme); } catch {}
    prefsHaptics = prefs.haptics;
  }, [theme, prefs.reduceMotion, prefs.haptics]);
  const THEMES = useMemo(() => ["midnight", "terminal", "degen", "ledger"] as const, []);
  const THEME_LABEL: Record<string, string> = { midnight: "Midnight", terminal: "Terminal", degen: "Degen", ledger: "Ledger" };
  function cycleTheme() {
    const i = THEMES.indexOf(theme as typeof THEMES[number]);
    const next = THEMES[(i + 1) % THEMES.length];
    setTheme(next);
    playSound("tap", prefs.sounds);
  }
  function updatePrefs(partial: Partial<Prefs>) {
    const next = savePrefs(partial);
    setPrefs(next);
    prefsHaptics = next.haptics;
  }

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(p => !p);
      } else if (e.key === "/" && !paletteOpen) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") {
          e.preventDefault();
          setPaletteOpen(true);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen]);

  useEffect(() => {
    if (!TG) return;
    try {
      TG.ready();
      TG.expand?.();
      TG.setHeaderColor?.("#0b1110");
      TG.setBackgroundColor?.("#0b1110");
      TG.disableVerticalSwipes?.();
    } catch { /* noop */ }
  }, []);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  // Telegram BackButton when not on home
  useEffect(() => {
    if (!TG?.BackButton) return;
    try {
      if (view !== "home") {
        TG.BackButton.show();
        const handler = () => { setView("home"); tgHaptic("light"); };
        TG.BackButton.onClick?.(handler);
        return () => {
          TG.BackButton.offClick?.(handler);
          TG.BackButton.hide();
        };
      }
      TG.BackButton.hide();
    } catch { /* noop */ }
  }, [view]);

  function notify(m: string, isErr = false) {
    if (isErr) { setErr(m); setToast("") } else { setToast(m); setErr("") }
    tgHaptic(isErr ? "error" : "light");
    playSound(isErr ? "error" : "tap", prefs.sounds);
    setTimeout(() => { setToast(""); setErr("") }, 4000);
  }
  function fireConfetti() {
    setSuccessAnimation("ripple");
    tgHaptic("success");
    playSound("success", prefs.sounds);
    setTimeout(() => setSuccessAnimation(null), 2000);
  }

  function showMoneyRain() {
    setSuccessAnimation("money");
    tgHaptic("success");
    playSound("win", prefs.sounds);
    setTimeout(() => setSuccessAnimation(null), 2000);
  }

  function showConnectionPulse() {
    setSuccessAnimation("connection");
    tgHaptic("success");
    playSound("success", prefs.sounds);
    setTimeout(() => setSuccessAnimation(null), 1500);
  }

  function logTx(kind: string, label: string, ok = true, detail?: string) {
    setJournal(pushJournal({ kind, label, ok, detail }));
  }

  async function shareMarket(m: Market) {
    const o = odds(m.totalYesPool, m.totalNoPool);
    const url = `${window.location.origin}${window.location.pathname}#mk-${m.id}`;
    const text = `${m.question}\nYES ${o.y}% · NO ${o.n}% · ${fmt(m.totalYesPool + m.totalNoPool)} TAC pool\n${url}`;
    try {
      if (TG?.openTelegramLink) {
        const share = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(`${m.question} — YES ${o.y}%`)}`;
        TG.openTelegramLink(share);
        questBump("signal");
        notify("Opening Telegram share…");
        return;
      }
      if (navigator.share) {
        await navigator.share({ title: "Prediction Tac", text, url });
        questBump("signal");
        notify("Shared");
        return;
      }
      await navigator.clipboard.writeText(text);
      questBump("signal");
      notify("Share text copied");
    } catch {
      try {
        await navigator.clipboard.writeText(url);
        notify("Link copied");
      } catch {
        notify("Share failed", true);
      }
    }
  }

  useEffect(() => {
    const s = bumpStreak();
    setStreak({ count: s.count, last: s.last });
    if (s.isNew && s.count > 1) {
      setShowStreakPop(true);
      tgHaptic("success");
      setTimeout(() => setShowStreakPop(false), 4200);
    }
  }, []);

  const questBump = useCallback((id: string, amount = 1) => {
    setQuests(curr => {
      const quest = DAILY_QUESTS.find(x => x.id === id);
      if (!quest) return curr;
      const prev = curr[id] || 0;
      if (prev >= quest.goal) return curr;
      const nextVal = Math.min(quest.goal, prev + amount);
      const next = { ...curr, [id]: nextVal };
      saveQuests(next);
      if (nextVal >= quest.goal) {
        setBonusXp(b => { const nb = b + quest.xp; saveBonusXp(nb); return nb });
        setToast(`Quest complete: ${quest.icon} ${quest.name} +${quest.xp} XP`);
        tgHaptic("success");
        setTimeout(() => setToast(""), 4000);
      }
      return next;
    });
  }, []);

  const contract = useCallback((withSigner = false) => {
    if (withSigner) {
      if (!signer) throw new Error("Connect wallet first");
      return new ethers.Contract(CONTRACT_ADDRESS, abi, signer);
    }
    return new ethers.Contract(CONTRACT_ADDRESS, abi, readProvider);
  }, [signer, readProvider]);

  async function copyMarketLink(id: number) {
    const url = `${window.location.origin}${window.location.pathname}#mk-${id}`;
    try {
      await navigator.clipboard.writeText(url);
      notify("Market link copied");
      questBump("signal");
    } catch {
      notify("Copy failed", true);
    }
  }

  const toggleFavorite = useCallback((id: number) => {
    setFavorites(curr => {
      const next = curr.includes(id) ? curr.filter(n => n !== id) : [id, ...curr];
      localStorage.setItem("ptac-favs", JSON.stringify(next));
      if (!curr.includes(id)) questBump("curator");
      return next;
    });
  }, [questBump]);

  useEffect(() => {
    try { localStorage.setItem("ptac-favs", JSON.stringify(favorites)); } catch {}
  }, [favorites]);

  useEffect(() => {
    if (deepLinked.current || markets.length === 0) return;
    const h = window.location.hash;
    const match = h.match(/^#mk-(\d+)$/);
    if (!match) return;
    const id = parseInt(match[1], 10);
    if (!markets.some(m => m.id === id)) return;
    deepLinked.current = true;
    setView("markets");
    setExpanded(id);
    requestAnimationFrame(() => document.getElementById(`mk-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }, [markets]);

  async function connectWallet() {
    if (NOT_DEPLOYED) {
      const demoAddr = "0xDE300000000000000000000000000000000000AC";
      setAccount(demoAddr);
      setVaultBalance(ethers.parseEther("500"));
      setWalletBalance(ethers.parseEther("1250"));
      setStats({ marketsCreated: 1, betsPlaced: 6, wins: 2, losses: 1, totalStaked: ethers.parseEther("310"), totalWon: ethers.parseEther("395") });
      setIsOwner(true);
      showConnectionPulse();
      notify("Demo wallet connected — trades are simulated ⚡");
      return;
    }
    if (!window.ethereum) { notify("No EVM wallet found. Install MetaMask.", true); return }
    try {
      const p = new ethers.BrowserProvider(window.ethereum);
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ACTIVE_CHAIN }] })
        .catch(async () => {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: ACTIVE_CHAIN,
              chainName: ACTIVE_CHAIN_NAME,
              rpcUrls: [TAC_RPC],
              nativeCurrency: { name: NATIVE_SYMBOL, symbol: NATIVE_SYMBOL, decimals: 18 },
              blockExplorerUrls: CHAIN_PREF === "local" ? [] : ["https://explorer.tac.build"],
            }],
          });
        });
      const accs = await p.send("eth_requestAccounts", []);
      const s = await p.getSigner();
      setSigner(s); setAccount(accs[0]);
      showConnectionPulse();
      notify(CHAIN_PREF === "local" ? "Wallet connected to Local Anvil ⚡" : "Wallet connected ⚡");
      const cid = await window.ethereum.request({ method: "eth_chainId" });
      setChainOk(cid === ACTIVE_CHAIN || cid === TAC_CHAIN_ID_TESTNET || cid === LOCAL_CHAIN_ID);
    } catch (e: any) { notify(e?.shortMessage || e?.message || "Connection failed", true) }
  }

  const loadAll = useCallback(async () => {
    if (NOT_DEPLOYED) {
      if (demoSeeded.current) return;
      demoSeeded.current = true;
      const demo = buildDemoData(Math.floor(Date.now() / 1000));
      setMarkets(demo.markets);
      setPriceHistory(demo.hist);
      setActivity(demo.acts);
      setLeaders(demo.leaders);
      return;
    }
    setLoading(true);
    try {
      const c = contract(false);
      const [count, pausedV, feeV, feesV] = await Promise.all([
        c.marketCount(), c.paused(), c.protocolFee(), c.accumulatedFees(),
      ]);
      setPausedState(pausedV); setProtocolFee(Number(feeV)); setAccFees(feesV);

      const acc = account.toLowerCase();
      if (acc) {
        const [vb, wb, ownerAddr, st, solv] = await Promise.all([
          c.balanceOf(acc), readProvider.getBalance(acc), c.owner(), c.getUserStats(acc), c.isSolvent(),
        ]);
        setVaultBalance(vb); setWalletBalance(wb);
        setIsOwner(ownerAddr.toLowerCase() === acc);
        setStats({
          marketsCreated: Number(st.marketsCreated), betsPlaced: Number(st.betsPlaced),
          wins: Number(st.wins), losses: Number(st.losses),
          totalStaked: st.totalStaked, totalWon: st.totalWon,
        });
        setSolvent(solv);
      }

      const total = Number(count);
      const ids = Array.from({ length: total }, (_, i) => i + 1);
      const infos = await Promise.all(ids.map(i => c.getMarketInfo(i)));
      const metas = await Promise.all(ids.map(i => c.getMarketMeta(i).catch(() => null)));
      const multis = await Promise.all(ids.map(i => c.getMultiMarket(i).catch(() => null)));
      const bets = acc ? await Promise.all(ids.map(i => c.getUserBet(i, acc).catch(() => null))) : [];
      const multiBets = acc ? await Promise.all(ids.map(i => c.getUserMultiBet(i, acc).catch(() => null))) : [];
      const pots = acc ? await Promise.all(ids.map(i => c.getPotentialPayout(i, acc).catch(() => null))) : [];

      // Index comments from events
      try {
        const cur = await readProvider.getBlockNumber();
        const from = Math.max(0, cur - 45000);
        const commentLogs = await c.queryFilter(c.filters.CommentPosted?.() ?? "CommentPosted", from, cur).catch(() => []);
        const fromChain: MarketComment[] = [];
        for (const ev of commentLogs as ethers.EventLog[]) {
          if (!ev.args) continue;
          fromChain.push({
            marketId: Number(ev.args.marketId),
            author: String(ev.args.author),
            body: String(ev.args.body),
            time: Number(ev.args.timestamp || 0),
          });
        }
        if (fromChain.length) {
          const merged = [...fromChain, ...loadComments().filter(x => !fromChain.some(y => y.time === x.time && y.body === x.body))];
          setComments(merged);
          saveComments(merged);
        }
      } catch { /* best-effort */ }

      const out: Market[] = ids.map((id, idx) => {
        const m = infos[idx], ub = bets[idx], pp = pots[idx], meta = metas[idx], multi = multis[idx], mb = multiBets[idx];
        const oc = meta ? Number(meta.outcomeCount || 2) : 2;
        const labels: string[] = multi ? [...multi.labels] : ["YES", "NO"];
        const pools: bigint[] = multi ? multi.pools.map((p: bigint) => p) : [m.totalYesPool, m.totalNoPool];
        const bettors: number[] = multi ? multi.bettors.map((b: number) => Number(b)) : [Number(m.yesBettors), Number(m.noBettors)];
        let myOutcomeIndex = -1;
        if (mb && Number(mb.outcomeIndex) !== 255) myOutcomeIndex = Number(mb.outcomeIndex);
        else if (ub && Number(ub.side) === 1) myOutcomeIndex = 0;
        else if (ub && Number(ub.side) === 2) myOutcomeIndex = 1;
        return {
          id, creator: m.creator, question: m.question, description: m.description,
          category: m.category, resolutionTime: Number(m.resolutionTime), createdAt: Number(m.createdAt),
          totalYesPool: m.totalYesPool, totalNoPool: m.totalNoPool,
          status: Number(m.status), winner: Number(m.winner),
          yesBettors: Number(m.yesBettors), noBettors: Number(m.noBettors),
          mySide: ub ? Number(ub.side) : 0, myAmount: ub ? ub.amount : (mb ? mb.amount : 0n), myClaimed: ub ? ub.claimed : (mb ? mb.claimed : false),
          potYes: pp ? pp.ifYes : 0n, potNo: pp ? pp.ifNo : 0n,
          resolutionSource: meta ? String(meta.resolutionSource || "") : "",
          outcomeCount: oc,
          outcomeLabels: labels,
          outcomePools: pools,
          outcomeBettors: bettors,
          myOutcomeIndex,
          winnerOutcome: meta ? Number(meta.winnerOutcome || 0) : 0,
        };
      });
      out.sort((a, b) => b.createdAt - a.createdAt);
      setMarkets(out);

      // ── Events → activity feed + price history + leaderboard ──
      try {
        const cur = await readProvider.getBlockNumber();
        const from = Math.max(0, cur - 45000);
        const evs = await c.queryFilter("*", from, cur);
        const acts: Activity[] = [];
        const hist: Record<number, PricePoint[]> = {};
        const pools: Record<number, { yes: bigint; no: bigint }> = {};
        const traders: Record<string, Leader> = {};

        for (const ev of evs) {
          const e = ev as ethers.EventLog;
          if (!e.fragment) continue;
          const n = e.fragment.name, a = e.args;
          if (n === "MarketCreated") {
            const id = Number(a.marketId);
            pools[id] = { yes: a.stake, no: 0n };
            hist[id] = [{ t: Number(a.timestamp), yes: 100 }];
            const addr = String(a.creator).toLowerCase();
            traders[addr] = traders[addr] || { addr, volume: 0n, bets: 0, wins: 0 };
            traders[addr].volume += a.stake; traders[addr].bets++;
            acts.push({ type: "create", text: `New market: "${a.question}"`, time: Number(a.timestamp), block: e.blockNumber });
          } else if (n === "BetPlaced") {
            const id = Number(a.marketId);
            pools[id] = pools[id] || { yes: 0n, no: 0n };
            if (Number(a.side) === 1) pools[id].yes += a.amount; else pools[id].no += a.amount;
            const o = odds(pools[id].yes, pools[id].no);
            hist[id] = hist[id] || [];
            hist[id].push({ t: Number(a.timestamp), yes: o.y });
            const addr = String(a.bettor).toLowerCase();
            traders[addr] = traders[addr] || { addr, volume: 0n, bets: 0, wins: 0 };
            traders[addr].volume += a.amount; traders[addr].bets++;
            acts.push({ type: "bet", text: `${String(a.bettor).slice(0, 8)}… bet ${fmt(a.amount)} TAC on ${Number(a.side) === 1 ? "YES" : "NO"}`, time: Number(a.timestamp), block: e.blockNumber });
          } else if (n === "PositionSold") {
            const id = Number(a.marketId);
            pools[id] = pools[id] || { yes: 0n, no: 0n };
            if (Number(a.side) === 1) pools[id].yes -= a.amount; else pools[id].no -= a.amount;
            const o = odds(pools[id].yes < 0n ? 0n : pools[id].yes, pools[id].no < 0n ? 0n : pools[id].no);
            hist[id] = hist[id] || [];
            hist[id].push({ t: Number(a.timestamp), yes: o.y });
            acts.push({ type: "sell", text: `${String(a.seller).slice(0, 8)}… sold ${fmt(a.amount)} TAC of ${Number(a.side) === 1 ? "YES" : "NO"}`, time: Number(a.timestamp), block: e.blockNumber });
          } else if (n === "MarketResolved") {
            acts.push({ type: "resolve", text: `Market #${a.marketId} resolved: ${Number(a.winner) === 1 ? "YES" : "NO"} won`, time: Number(a.timestamp), block: e.blockNumber });
          } else if (n === "Claimed") {
            const addr = String(a.claimant).toLowerCase();
            traders[addr] = traders[addr] || { addr, volume: 0n, bets: 0, wins: 0 };
            traders[addr].wins++;
            acts.push({ type: "claim", text: `${String(a.claimant).slice(0, 8)}… claimed ${fmt(a.amount)} TAC`, time: Number(a.timestamp), block: e.blockNumber });
          } else if (n === "Deposited") {
            acts.push({ type: "deposit", text: `${String(a.user).slice(0, 8)}… deposited ${fmt(a.amount)} TAC`, time: 0, block: e.blockNumber });
          } else if (n === "Withdrawn") {
            acts.push({ type: "withdraw", text: `${String(a.user).slice(0, 8)}… withdrew ${fmt(a.amount)} TAC`, time: 0, block: e.blockNumber });
          }
        }
        setActivity(acts.slice(-30).reverse());
        setPriceHistory(hist);
        setLeaders(Object.values(traders).sort((a, b) => (b.volume > a.volume ? 1 : -1)).slice(0, 20));
      } catch { /* best-effort */ }
    } catch (e: any) {
      notify(e?.shortMessage || e?.message || "Failed to load", true);
    } finally { setLoading(false) }
  }, [account, contract, readProvider]);

  useEffect(() => { loadAll() }, [loadAll]);
  useEffect(() => {
    const t = setInterval(loadAll, 30000);
    return () => clearInterval(t);
  }, [loadAll]);
  useEffect(() => {
    if (!window.ethereum) return;
    const handleAccountsChanged = (accs: string[]) => {
      setAccount(accs[0] || "");
      setSigner(null);
    };
    const handleChainChanged = () => {
      setSigner(null);
      loadAll();
    };

    window.ethereum.on?.("accountsChanged", handleAccountsChanged);
    window.ethereum.on?.("chainChanged", handleChainChanged);

    return () => {
      window.ethereum.removeListener?.("accountsChanged", handleAccountsChanged);
      window.ethereum.removeListener?.("chainChanged", handleChainChanged);
    };
  }, [loadAll]);

  // ── XP + achievements ──
  const xp = useMemo(() => {
    if (!stats) return bonusXp;
    const base = stats.betsPlaced * 10 + stats.wins * 25 + stats.marketsCreated * 20 + Math.floor(parseFloat(ethers.formatEther(stats.totalStaked)) / 10);
    const streakBonus = Math.min(streak.count, 30) * 5;
    return base + bonusXp + streakBonus;
  }, [stats, bonusXp, streak]);
  const lvl = levelFor(xp);
  const unlocked = useMemo(() => stats ? ACHIEVEMENTS.filter(a => a.test(stats, markets)) : [], [stats, markets]);

  useEffect(() => {
    for (const a of unlocked) {
      if (!seenAchievements.current.has(a.id)) {
        seenAchievements.current.add(a.id);
        localStorage.setItem("ptac-ach", JSON.stringify([...seenAchievements.current]));
        setNewAchievement(a);
        fireConfetti();
        setTimeout(() => setNewAchievement(null), 4200);
        break;
      }
    }
  }, [unlocked]);

  async function tx(key: string, fn: () => Promise<any>, okMsg: string, celebrate = false) {
    if (NOT_DEPLOYED) {
      setBusy(b => ({ ...b, [key]: true }));
      await new Promise(r => setTimeout(r, 650));
      setBusy(b => ({ ...b, [key]: false }));
      notify(`${okMsg} (demo — no real transaction)`);
      logTx(key, okMsg, true, "demo");
      playSound(celebrate ? "win" : "bet", prefs.sounds);
      if (celebrate) fireConfetti();
      return;
    }
    setBusy(b => ({ ...b, [key]: true }));
    try {
      const r = await fn();
      notify("Transaction sent — confirming…");
      await r.wait();
      notify(okMsg);
      logTx(key, okMsg, true);
      playSound(celebrate ? "win" : "bet", prefs.sounds);
      if (celebrate) fireConfetti();
      await loadAll();
    } catch (e: any) {
      const msg = e?.shortMessage || e?.reason || e?.message || "Transaction failed";
      notify(msg, true);
      logTx(key, msg, false);
    } finally { setBusy(b => ({ ...b, [key]: false })) }
  }

  const deposit = () => {
    const v = parseFloat(depositAmt);
    if (!v || v <= 0) return notify("Enter amount", true);
    if (NOT_DEPLOYED) {
      const wei = ethers.parseEther(depositAmt);
      tx("deposit", async () => null, `Deposited ${depositAmt} TAC 🏦`, true).then(() => {
        setVaultBalance(b => b + wei);
        setWalletBalance(b => (b >= wei ? b - wei : 0n));
        showMoneyRain();
      });
      return;
    }
    tx("deposit", () => contract(true).deposit({ value: ethers.parseEther(depositAmt) }), `Deposited ${depositAmt} TAC 🏦`, true).then(() => {
      showMoneyRain();
    });
  };
  const withdraw = () => {
    if (NOT_DEPLOYED) {
      let wei: bigint;
      try { wei = withdrawAmt ? ethers.parseEther(withdrawAmt) : vaultBalance } catch { return notify("Invalid amount", true) }
      if (wei > vaultBalance) return notify("Insufficient vault balance", true);
      tx("withdraw", async () => null, withdrawAmt ? `Withdrew ${withdrawAmt} TAC` : "Withdrew full vault balance").then(() => {
        setVaultBalance(b => b - wei);
        setWalletBalance(b => b + wei);
        setWithdrawAmt("");
      });
      return;
    }
    if (!withdrawAmt) return tx("withdraw", () => contract(true).withdrawAll(), "Withdrew full vault balance");
    tx("withdraw", () => contract(true).withdraw(ethers.parseEther(withdrawAmt)), `Withdrew ${withdrawAmt} TAC`);
  };
  const createMarket = () => {
    if (!q.trim()) return notify("Enter a question", true);
    const amt = parseFloat(stake);
    if (!amt || amt < 0.01) return notify("Stake ≥ 0.01 TAC", true);
    if (ethers.parseEther(stake) > vaultBalance) return notify("Insufficient vault — deposit first", true);
    const rt = Math.floor(Date.now() / 1000) + DURATIONS[duration] * 86400;
    const labels = multiMode
      ? outcomeDrafts.map(s => s.trim()).filter(Boolean)
      : ["YES", "NO"];
    if (multiMode && (labels.length < 2 || labels.length > 8)) return notify("Need 2–8 outcomes", true);
    const isMulti = multiMode && labels.length >= 3;
    const seedLabel = labels[0] || "YES";
    if (NOT_DEPLOYED) {
      const wei = ethers.parseEther(stake);
      tx("create", async () => null, `Market live — staked on ${seedLabel} 🎯`, true).then(() => {
        setMarkets(ms => {
          const nid = Math.max(0, ...ms.map(m => m.id)) + 1;
          const pools = labels.map((_, i) => i === 0 ? wei : 0n);
          const bettors = labels.map((_, i) => i === 0 ? 1 : 0);
          return [{
            id: nid, creator: account || "0xDE300000000000000000000000000000000000AC",
            question: q, description: desc, category: cat,
            resolutionTime: rt, createdAt: Math.floor(Date.now() / 1000),
            totalYesPool: !isMulti ? wei : 0n, totalNoPool: 0n, status: STATUS.Open, winner: SIDE.None,
            yesBettors: !isMulti ? 1 : 0, noBettors: 0,
            mySide: !isMulti ? SIDE.Yes : SIDE.None,
            myAmount: wei, myClaimed: false, potYes: 0n, potNo: 0n,
            resolutionSource,
            outcomeCount: labels.length,
            outcomeLabels: labels,
            outcomePools: pools,
            outcomeBettors: bettors,
            myOutcomeIndex: 0,
            winnerOutcome: 0,
          }, ...ms];
        });
        setVaultBalance(v => v - wei);
        setShowCreate(false); setQ(""); setDesc(""); setResolutionSource("");
      });
      return;
    }
    const c = contract(true);
    const wei = ethers.parseEther(stake);
    const fn = isMulti
      ? () => c.createMultiMarket(q, desc, cat, resolutionSource, rt, wei, labels)
      : resolutionSource
        ? () => c.createMarketWithSource(q, desc, cat, resolutionSource, rt, wei)
        : () => c.createMarket(q, desc, cat, rt, wei);
    tx("create", fn, `Market live — staked on ${seedLabel} 🎯`, true).then(() => {
      setShowCreate(false); setQ(""); setDesc(""); setResolutionSource("");
    });
  };

  const betOutcome = (id: number, outcomeIndex: number) => {
    const amt = betAmt[id] || "5";
    let wei: bigint;
    try { wei = ethers.parseEther(amt) } catch { return notify("Invalid amount", true) }
    if (wei < ethers.parseEther("0.01")) return notify("Minimum bet is 0.01 TAC", true);
    if (wei > vaultBalance) return notify("Insufficient vault balance — deposit first", true);
    const mkt = markets.find(m => m.id === id);
    if (!mkt) return;
    const labels = mkt.outcomeLabels || ["YES", "NO"];
    if (mkt.myOutcomeIndex !== undefined && mkt.myOutcomeIndex >= 0 && mkt.myOutcomeIndex !== outcomeIndex) {
      return notify(`You're on ${labels[mkt.myOutcomeIndex]} — sell first to switch`, true);
    }
    if (NOT_DEPLOYED) {
      const fee = wei * BigInt(protocolFee) / 1000n;
      const net = wei - fee;
      tx(`bet-${id}`, async () => null, `${amt} TAC on ${labels[outcomeIndex]} ⚡`).then(() => {
        setMarkets(ms => ms.map(m => {
          if (m.id !== id) return m;
          const pools = [...(m.outcomePools || [m.totalYesPool, m.totalNoPool])];
          const bettors = [...(m.outcomeBettors || [m.yesBettors, m.noBettors])];
          pools[outcomeIndex] = (pools[outcomeIndex] || 0n) + net;
          if ((m.myOutcomeIndex ?? -1) < 0) bettors[outcomeIndex] = (bettors[outcomeIndex] || 0) + 1;
          const isBinary = (m.outcomeCount || 2) <= 2;
          return {
            ...m,
            outcomePools: pools,
            outcomeBettors: bettors,
            myOutcomeIndex: outcomeIndex,
            myAmount: m.myAmount + net,
            mySide: isBinary ? (outcomeIndex === 0 ? SIDE.Yes : SIDE.No) : m.mySide,
            totalYesPool: isBinary && outcomeIndex === 0 ? m.totalYesPool + net : m.totalYesPool,
            totalNoPool: isBinary && outcomeIndex === 1 ? m.totalNoPool + net : m.totalNoPool,
          };
        }));
        setVaultBalance(v => v - wei);
        questBump("conviction");
      });
      return;
    }
    tx(`bet-${id}`, () => contract(true).betOutcome(id, outcomeIndex, wei), `${amt} TAC on ${labels[outcomeIndex]} ⚡`).then(() => questBump("conviction"));
  };

  const postComment = (marketId: number) => {
    const body = (commentDraft[marketId] || "").trim();
    if (!body) return notify("Write a comment first", true);
    if (body.length > 280) return notify("Max 280 characters", true);
    if (NOT_DEPLOYED) {
      const entry: MarketComment = {
        marketId, author: account || "0xdemo", body, time: Math.floor(Date.now() / 1000),
      };
      const next = [entry, ...comments];
      setComments(next);
      saveComments(next);
      setCommentDraft(d => ({ ...d, [marketId]: "" }));
      notify("Comment posted (demo)");
      return;
    }
    if (!account) return notify("Connect wallet first", true);
    tx(`comment-${marketId}`, () => contract(true).postComment(marketId, body), "Comment posted").then(() => {
      const entry: MarketComment = {
        marketId, author: account, body, time: Math.floor(Date.now() / 1000),
      };
      const next = [entry, ...comments];
      setComments(next);
      saveComments(next);
      setCommentDraft(d => ({ ...d, [marketId]: "" }));
    });
  };
  const bet = (id: number, side: 1 | 2) => {
    const amt = betAmt[id] || "5";
    let wei: bigint;
    try { wei = ethers.parseEther(amt) } catch { return notify("Invalid amount", true) }
    if (wei < ethers.parseEther("0.01")) return notify("Minimum bet is 0.01 TAC", true);
    if (wei > vaultBalance) return notify("Insufficient vault balance — deposit first", true);
    const mkt = markets.find(m => m.id === id);
    if (mkt && mkt.mySide !== SIDE.None && mkt.mySide !== side) return notify(`You're on ${sideLabel(mkt.mySide)} — sell first to switch sides`, true);
    if (NOT_DEPLOYED) {
      const fee = wei * BigInt(protocolFee) / 1000n;
      const net = wei - fee;
      tx(`bet-${id}`, async () => null, `${amt} TAC on ${side === 1 ? "YES" : "NO"} ⚡`).then(() => {
        setMarkets(ms => ms.map(m => {
          if (m.id !== id) return m;
          const yes = side === 1 ? m.totalYesPool + net : m.totalYesPool;
          const no = side === 2 ? m.totalNoPool + net : m.totalNoPool;
          const myAmt = m.myAmount + net;
          const pot = (winPool: bigint, losePool: bigint) => winPool === 0n ? 0n : myAmt + (myAmt * losePool) / winPool;
          return {
            ...m,
            totalYesPool: yes, totalNoPool: no,
            yesBettors: side === 1 && m.mySide === SIDE.None ? m.yesBettors + 1 : m.yesBettors,
            noBettors: side === 2 && m.mySide === SIDE.None ? m.noBettors + 1 : m.noBettors,
            mySide: side, myAmount: myAmt,
            potYes: side === 1 ? pot(yes, no) : 0n,
            potNo: side === 2 ? pot(no, yes) : 0n,
          };
        }));
        const target = markets.find(m => m.id === id);
        if (target) {
          const yes = side === 1 ? target.totalYesPool + net : target.totalYesPool;
          const no = side === 2 ? target.totalNoPool + net : target.totalNoPool;
          const o = odds(yes, no);
          const t = Math.floor(Date.now() / 1000);
          setPriceHistory(h => ({ ...h, [id]: [...(h[id] || []), { t, yes: o.y }] }));
          setActivity(a => [{ type: "bet", text: `You bet ${amt} TAC on ${side === 1 ? "YES" : "NO"}`, time: t, block: 0 }, ...a].slice(0, 30));
        }
        setVaultBalance(v => v - wei);
        questBump("conviction");
      });
      return;
    }
    tx(`bet-${id}`, () => contract(true).bet(id, side, wei), `${amt} TAC on ${side === 1 ? "YES" : "NO"} ⚡`).then(() => questBump("conviction"));
  };
  const sellPos = (id: number, held: bigint, amtWei: bigint) => {
    if (amtWei <= 0n) return notify("Enter an amount to sell", true);
    if (amtWei > held) return notify(`You only hold ${fmt(held)} TAC`, true);
    if (NOT_DEPLOYED) {
      const fee = amtWei * BigInt(protocolFee) / 1000n;
      tx(`sell-${id}`, async () => null, `Sold ${fmt(amtWei)} TAC of your position → vault`).then(() => {
        setMarkets(ms => ms.map(m => {
          if (m.id !== id) return m;
          const remaining = m.myAmount - amtWei;
          const yes = m.mySide === SIDE.Yes ? m.totalYesPool - amtWei : m.totalYesPool;
          const no = m.mySide === SIDE.No ? m.totalNoPool - amtWei : m.totalNoPool;
          const pot = (winPool: bigint, losePool: bigint) => winPool === 0n || remaining === 0n ? 0n : remaining + (remaining * losePool) / winPool;
          return {
            ...m,
            totalYesPool: yes, totalNoPool: no,
            yesBettors: remaining === 0n && m.mySide === SIDE.Yes ? m.yesBettors - 1 : m.yesBettors,
            noBettors: remaining === 0n && m.mySide === SIDE.No ? m.noBettors - 1 : m.noBettors,
            myAmount: remaining,
            mySide: remaining === 0n ? SIDE.None : m.mySide,
            potYes: m.mySide === SIDE.Yes ? pot(yes, no) : 0n,
            potNo: m.mySide === SIDE.No ? pot(no, yes) : 0n,
          };
        }));
        const target = markets.find(m => m.id === id);
        if (target) {
          const yes = target.mySide === SIDE.Yes ? target.totalYesPool - amtWei : target.totalYesPool;
          const no = target.mySide === SIDE.No ? target.totalNoPool - amtWei : target.totalNoPool;
          const o = odds(yes, no);
          const t = Math.floor(Date.now() / 1000);
          setPriceHistory(h => ({ ...h, [id]: [...(h[id] || []), { t, yes: o.y }] }));
          setActivity(a => [{ type: "sell", text: `You sold ${fmt(amtWei)} TAC of your ${sideLabel(target.mySide)} position`, time: t, block: 0 }, ...a].slice(0, 30));
        }
        setVaultBalance(v => v + amtWei - fee);
        setSellAmt(s => ({ ...s, [id]: "" }));
        if (amtWei === held) setTradeMode(t => ({ ...t, [id]: "buy" }));
      });
      return;
    }
    tx(`sell-${id}`, () => contract(true).sellPosition(id, amtWei), `Sold ${fmt(amtWei)} TAC of your position → vault`).then(() => {
      setSellAmt(s => ({ ...s, [id]: "" }));
      if (amtWei === held) setTradeMode(t => ({ ...t, [id]: "buy" }));
    });
  };
  const claim = (id: number) => tx(`claim-${id}`, () => contract(true).claim(id), "Winnings claimed → vault 💰", true);
  const claimRefund = (id: number) => tx(`refund-${id}`, () => contract(true).claimRefund(id), "Refund claimed → vault");
  const cancelM = (id: number) => tx(`cancel-${id}`, () => contract(true).cancelMarket(id), "Market cancelled — stake refunded");
  const refundExpired = (id: number) => tx(`rexp-${id}`, () => contract(true).refundExpiredMarket(id), "Marked for refund");
  const disputeM = (id: number) => tx(`disp-${id}`, () => contract(true).dispute(id), "Dispute raised ⚖️");
  const adminResolve = (id: number, side: 1 | 2) => tx(`ares-${id}`, () => contract(true).resolve(id, side), `#${id} resolved ${side === 1 ? "YES" : "NO"}`);
  const adminResolveDispute = (id: number, side: 1 | 2) => tx(`adis-${id}`, () => contract(true).resolveDispute(id, side), `Dispute #${id} settled`);
  const adminSetFee = () => tx("afee", () => contract(true).setProtocolFee(parseInt(adminFee)), "Fee updated");
  const adminWithdrawFees = () => tx("awd", () => contract(true).withdrawFees(feeRecipient || account), "Fees withdrawn");
  const adminPause = () => tx("apause", () => contract(true).setPaused(!paused), paused ? "Unpaused" : "Paused");

  const totalVol = useMemo(() => markets.reduce((s, m) => s + m.totalYesPool + m.totalNoPool, 0n), [markets]);
  const activeCount = markets.filter(m => m.status === STATUS.Open && now < m.resolutionTime).length;
  const totalBettors = markets.reduce((s, m) => s + m.yesBettors + m.noBettors, 0);
  const winRate = stats && (stats.wins + stats.losses) > 0 ? Math.round(stats.wins * 100 / (stats.wins + stats.losses)) : 0;
  const pnl = stats ? stats.totalWon - stats.totalStaked : 0n;
  const favoritesSet = useMemo(() => new Set(favorites), [favorites]);
  const openMarkets = useMemo(() => markets.filter(m => m.status === STATUS.Open && now < m.resolutionTime), [markets, now]);
  const spotlightMarket = useMemo(() => {
    const pool = [...openMarkets].sort((a, b) => Number((b.totalYesPool + b.totalNoPool) - (a.totalYesPool + a.totalNoPool)));
    return pool[0] || markets[0] || null;
  }, [openMarkets, markets]);
  const closingSoonMarket = useMemo(() => {
    const pool = [...openMarkets].sort((a, b) => a.resolutionTime - b.resolutionTime);
    return pool[0] || null;
  }, [openMarkets]);
  const unresolvedCount = markets.filter(m => m.status === STATUS.Open && now >= m.resolutionTime && m.totalYesPool > 0n && m.totalNoPool > 0n).length;
  const watchlistedMarkets = useMemo(() => markets.filter(m => favoritesSet.has(m.id)), [markets, favoritesSet]);
  const latestActivity = activity[0] || null;

  const jumpToMarket = useCallback((id: number) => {
    setView("markets");
    setExpanded(id);
    requestAnimationFrame(() => document.getElementById(`mk-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }, []);

  const paletteItems = useMemo<PaletteItem[]>(() => {
    const nav: PaletteItem[] = [
      { id: "v-markets", icon: <BarChart3 size={15} />, label: "Go to Markets", hint: "view", run: () => setView("markets") },
      { id: "v-vault", icon: <Landmark size={15} />, label: "Go to Vault", hint: "view", run: () => setView("vault") },
      { id: "v-portfolio", icon: <Target size={15} />, label: "Go to Portfolio", hint: "view", run: () => setView("portfolio") },
      { id: "v-leaders", icon: <Trophy size={15} />, label: "Go to Leaderboard", hint: "view", run: () => setView("leaderboard") },
      { id: "a-create", icon: <Plus size={15} />, label: "Create a market", hint: "action", run: () => { setView("markets"); setShowCreate(true) } },
      { id: "a-calc", icon: <Calculator size={15} />, label: "Odds calculator", hint: "tool", run: () => setCalcOpen(true) },
      { id: "a-settings", icon: <Settings size={15} />, label: "Open Settings", hint: "view", run: () => setView("settings") },
      { id: "a-claim", icon: <PartyPopper size={15} />, label: "Claim all winnings", hint: "action", run: () => { setView("portfolio"); claimAll() } },
      { id: "a-theme", icon: <Palette size={15} />, label: `Switch theme (now: ${THEME_LABEL[theme] || theme})`, hint: "action", run: cycleTheme },
      { id: "a-refresh", icon: <RefreshCw size={15} />, label: "Refresh data", hint: "action", run: loadAll },
    ];
    const mks: PaletteItem[] = markets.map(m => {
      const o = odds(m.totalYesPool, m.totalNoPool);
      return {
        id: `m-${m.id}`,
        icon: <span className="pi-cat">{CAT_ICONS[m.category] || "🎲"}</span>,
        label: m.question,
        hint: `YES ${o.y}% · ${fmt(m.totalYesPool + m.totalNoPool)} TAC`,
        run: () => jumpToMarket(m.id),
      };
    });
    return [...nav, ...mks];
  }, [markets, theme, THEME_LABEL, cycleTheme, loadAll, jumpToMarket]);

  const filtered = useMemo(() => {
    const qText = search.trim().toLowerCase();
    const list = markets.filter(m => {
      if (catFilter && m.category !== catFilter) return false;
      if (qText) {
        const hay = `${m.question} ${m.description} ${m.category}`.toLowerCase();
        if (!hay.includes(qText)) return false;
      }
      if (tab === "open") return m.status === STATUS.Open && now < m.resolutionTime;
      if (tab === "ending") return m.status === STATUS.Open && now < m.resolutionTime && m.resolutionTime - now < 86400 * 2;
      if (tab === "resolved") return m.status !== STATUS.Open;
      if (tab === "mine") return m.mySide !== SIDE.None || (account && m.creator.toLowerCase() === account.toLowerCase());
      return true;
    });
    const sortVolume = (m: Market) => Number(ethers.formatEther(m.totalYesPool + m.totalNoPool));
    const favRank = (m: Market) => (favoritesSet.has(m.id) ? 0 : 1);
    return [...list].sort((a, b) => {
      if (sortBy === "watchlist") {
        const favDelta = favRank(a) - favRank(b);
        if (favDelta !== 0) return favDelta;
        return sortVolume(b) - sortVolume(a);
      }
      if (sortBy === "newest") return b.createdAt - a.createdAt;
      if (sortBy === "ending") return a.resolutionTime - b.resolutionTime;
      if (sortBy === "volume") return sortVolume(b) - sortVolume(a);
      return sortVolume(b) - sortVolume(a) || b.createdAt - a.createdAt;
    });
  }, [markets, catFilter, tab, account, now, search, sortBy, favoritesSet]);

  const trending = useMemo(() =>
    [...markets].filter(m => m.status === STATUS.Open && now < m.resolutionTime)
      .sort((a, b) => ((b.totalYesPool + b.totalNoPool) > (a.totalYesPool + a.totalNoPool) ? 1 : -1)).slice(0, 3),
    [markets, now]);
  const disputedMarkets = markets.filter(m => m.status === STATUS.Disputed);
  const awaitingResolution = markets.filter(m => m.status === STATUS.Open && now >= m.resolutionTime && m.totalYesPool > 0n && m.totalNoPool > 0n);
  const isCreator = (m: Market) => account && m.creator.toLowerCase() === account.toLowerCase();
  const claimable = markets.filter(m => {
    const multi = (m.outcomeCount || 2) > 2;
    const won = multi
      ? (m.myOutcomeIndex ?? -1) === (m.winnerOutcome ?? -2) && (m.myOutcomeIndex ?? -1) >= 0
      : m.mySide === m.winner && m.mySide !== SIDE.None;
    const hasPos = multi ? (m.myOutcomeIndex ?? -1) >= 0 : m.mySide !== SIDE.None;
    return (m.status === STATUS.Resolved && !m.myClaimed && won) ||
      ((m.status === STATUS.Refunded || m.status === STATUS.Cancelled) && !m.myClaimed && hasPos);
  });

  // Ending-soon local alerts
  useEffect(() => {
    if (!prefs.endingAlerts || markets.length === 0) return;
    const thr = prefs.alertThresholdHrs * 3600;
    const due = markets.filter(m =>
      m.status === STATUS.Open &&
      m.resolutionTime > now &&
      m.resolutionTime - now <= thr &&
      !alertedIds.has(m.id)
    );
    if (due.length === 0) return;
    const next = new Set(alertedIds);
    for (const m of due.slice(0, 3)) {
      next.add(m.id);
      notify(`Ending soon: ${m.question.slice(0, 64)}${m.question.length > 64 ? "…" : ""}`);
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        try { new Notification("Prediction Tac", { body: m.question, icon: "/icon-192.png" }); } catch { /* noop */ }
      }
    }
    setAlertedIds(next);
    try { localStorage.setItem("ptac-alerted", JSON.stringify([...next])); } catch { /* noop */ }
  }, [markets, now, prefs.endingAlerts, prefs.alertThresholdHrs]); // eslint-disable-line react-hooks/exhaustive-deps

  const calcPayout = useMemo(() => {
    const yesPct = Math.min(99.9, Math.max(0.1, parseFloat(calcYes) || 50));
    const stakeN = Math.max(0, parseFloat(calcStake) || 0);
    const feePct = Math.min(5, Math.max(0, parseFloat(calcFee) || 0));
    if (stakeN <= 0) return { yes: 0, no: 0, yesMult: 0, noMult: 0 };
    // Simple implied payout if current odds held and you took that side alone of the winning pool share approximation
    const yesMult = (100 / yesPct) * (1 - feePct / 100 * (1 - yesPct / 100));
    const noMult = (100 / (100 - yesPct)) * (1 - feePct / 100 * (yesPct / 100));
    return {
      yes: stakeN * yesMult,
      no: stakeN * noMult,
      yesMult,
      noMult,
    };
  }, [calcYes, calcStake, calcFee]);

  async function claimAll() {
    if (!account || claimable.length === 0) return notify("Nothing to claim", true);
    const ids = claimable.map(m => m.id);
    if (NOT_DEPLOYED) {
      for (const m of claimable) {
        if (m.status === STATUS.Resolved) await claim(m.id);
        else await claimRefund(m.id);
      }
      return;
    }
    await tx("claim-many", () => contract(true).claimMany(ids), `Claimed ${ids.length} market(s) → vault 💰`, true);
  }

  function finishOnboarding() {
    updatePrefs({ onboardingDone: true });
    setShowOnboarding(false);
    playSound("success", prefs.sounds);
    setView("markets");
  }

  return (
    <div className={`app-root ${IN_TELEGRAM ? "tg-mode" : ""} ${prefs.reduceMotion ? "reduce-motion" : ""}`}>
      <div className="bg-scene">
        <div className="orb o1" /><div className="orb o2" /><div className="orb o3" />
        <div className="grid-overlay" />
      </div>

      {successAnimation === "ripple" && (
        <div className="success-ripple">
          <div className="success-ripple-inner">
            <div className="ripple-circle" />
            <div className="ripple-circle" />
            <div className="ripple-circle" />
            <div className="success-icon">✨</div>
          </div>
        </div>
      )}

      {successAnimation === "money" && (
        <div className="money-rain">
          {Array.from({ length: 20 }).map((_, i) => (
            <div
              key={i}
              className="money-particle"
              style={{
                left: `${5 + i * 5}%`,
                animationDelay: `${i * 0.1}s`,
                animationDuration: `${1.5 + Math.random() * 0.5}s`
              }}
            >
              💰
            </div>
          ))}
        </div>
      )}

      {successAnimation === "connection" && (
        <div className="connection-pulse">
          <div className="pulse-ring" />
          <div className="pulse-ring" />
          <div className="pulse-ring" />
          <div className="pulse-icon">🔗</div>
        </div>
      )}

      {(toast || err) && <div className={`toast ${err ? "err" : ""}`}>{err || toast}</div>}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} items={paletteItems} />
      {newAchievement && (
        <div className="ach-popup">
          <span className="ach-ico">{newAchievement.icon}</span>
          <div><b>Achievement unlocked!</b><span>{newAchievement.name} — {newAchievement.desc}</span></div>
        </div>
      )}
      {showStreakPop && (
        <div className="ach-popup streak-pop">
          <span className="ach-ico">🔥</span>
          <div><b>{streak.count}-day streak!</b><span>+{Math.min(streak.count, 30) * 5} bonus XP — come back tomorrow to keep it going</span></div>
        </div>
      )}
      {paused && <div className="banner warn"><Pause size={14} /> Protocol paused — actions disabled</div>}
      {!solvent && account && <div className="banner danger"><Shield size={14} /> Solvency warning — contract balance below obligations</div>}
      {!online && <div className="banner danger"><WifiOff size={14} /> You're offline — balances may be stale</div>}

      {showOnboarding && (
        <div className="onboard-overlay" role="dialog" aria-modal="true" aria-label="Welcome">
          <div className="onboard-card">
            <div className="onboard-art">
              {onboardStep === 0 && <HeroChartArt className="onboard-hero" />}
              {onboardStep === 1 && <EmptyVaultArt />}
              {onboardStep === 2 && <EmptyMarketsArt />}
            </div>
            {onboardStep === 0 && (
              <>
                <h2>Call it. Stake it. Win.</h2>
                <p>Peer-to-peer YES/NO pools on TAC. Odds move with every stake — early conviction pays more.</p>
              </>
            )}
            {onboardStep === 1 && (
              <>
                <h2>Vault first</h2>
                <p>Deposit TAC once. Trade from your vault balance without signing every single bet. Withdraw anytime.</p>
              </>
            )}
            {onboardStep === 2 && (
              <>
                <h2>Built for Telegram</h2>
                <p>Thumb-friendly markets, haptics, and share links. Rank up with XP, streaks, and the leaderboard.</p>
              </>
            )}
            <div className="onboard-dots">
              {[0, 1, 2].map(i => <span key={i} className={i === onboardStep ? "on" : ""} />)}
            </div>
            <div className="onboard-actions">
              {onboardStep < 2 ? (
                <button className="btn-submit" onClick={() => { setOnboardStep(s => s + 1); playSound("tap", prefs.sounds); }}>Continue</button>
              ) : (
                <button className="btn-submit" onClick={finishOnboarding}>Open markets</button>
              )}
              <button className="btn-ghost" onClick={finishOnboarding}>Skip</button>
            </div>
          </div>
        </div>
      )}

      {calcOpen && (
        <div className="palette-overlay" onClick={() => setCalcOpen(false)}>
          <div className="calc-panel" onClick={e => e.stopPropagation()}>
            <div className="calc-head">
              <h3><Calculator size={16} /> Odds calculator</h3>
              <button className="icon-chip" onClick={() => setCalcOpen(false)} aria-label="Close"><X size={14} /></button>
            </div>
            <p className="sub">Estimate payout if current odds held and you won. Fee applies to profit only in the real pool math.</p>
            <div className="calc-grid">
              <label>YES odds %
                <input type="number" min="1" max="99" value={calcYes} onChange={e => setCalcYes(e.target.value)} />
              </label>
              <label>Stake (TAC)
                <input type="number" min="0" value={calcStake} onChange={e => setCalcStake(e.target.value)} />
              </label>
              <label>Fee %
                <input type="number" min="0" max="5" step="0.1" value={calcFee} onChange={e => setCalcFee(e.target.value)} />
              </label>
            </div>
            <div className="calc-out">
              <div className="calc-yes"><span>If YES wins</span><b>{calcPayout.yes.toFixed(2)} TAC</b><small>{calcPayout.yesMult.toFixed(2)}x</small></div>
              <div className="calc-no"><span>If NO wins</span><b>{calcPayout.no.toFixed(2)} TAC</b><small>{calcPayout.noMult.toFixed(2)}x</small></div>
            </div>
          </div>
        </div>
      )}

      <nav className="topnav">
        <div className="brand" onClick={() => setView("home")}>
          <BrandMark size={30} />
          <span className="brand-name">Prediction<b>Tac</b></span>
        </div>
        <div className="nav-tabs">
          <button className={view === "home" ? "on" : ""} onClick={() => setView("home")}><Home size={15} /> Home</button>
          <button className={view === "markets" ? "on" : ""} onClick={() => setView("markets")}><BarChart3 size={15} /> Markets</button>
          <button className={view === "vault" ? "on" : ""} onClick={() => setView("vault")}><Landmark size={15} /> Vault</button>
          <button className={view === "portfolio" ? "on" : ""} onClick={() => setView("portfolio")}><User size={15} /> You</button>
          <button className={view === "leaderboard" ? "on" : ""} onClick={() => setView("leaderboard")}><Trophy size={15} /> Rank</button>
          {isOwner && <button className={`admin-tab ${view === "admin" ? "on" : ""}`} onClick={() => setView("admin")}><Shield size={15} /> Admin</button>}
        </div>
        <div className="nav-right">
          <button className="palette-btn" onClick={() => setPaletteOpen(true)} title="Command palette (⌘K or /)">
            <Search size={14} /><kbd>⌘K</kbd>
          </button>
          <button className="theme-btn" onClick={() => setCalcOpen(true)} title="Odds calculator">
            <Calculator size={15} />
          </button>
          <button className="theme-btn" onClick={() => setView("settings")} title="Settings">
            <Settings size={15} />
          </button>
          <button className="theme-btn" onClick={cycleTheme} title={`Theme: ${THEME_LABEL[theme] || theme} — click to switch`}>
            <Palette size={15} />
          </button>
          {account && stats && (
            <span className="lvl-chip" onClick={() => setView("portfolio")} title={`Level ${lvl.level} · ${xp} XP`}>
              {lvl.icon} <b>L{lvl.level}</b>
              <span className="lvl-bar"><span style={{ width: `${lvl.pct}%` }} /></span>
            </span>
          )}
          {streak.count > 0 && (
            <span className="streak-chip" onClick={() => setView("portfolio")} title={`${streak.count}-day streak — visit daily to keep it alive`}>
              🔥 <b>{streak.count}</b>
            </span>
          )}
          {account && <span className="vault-chip" onClick={() => setView("vault")}><Landmark size={13} /> {fmt(vaultBalance)}</span>}
          {account ? (
            <span className={`acct ${NOT_DEPLOYED ? "demo" : ""}`} title={NOT_DEPLOYED ? "Demo wallet — trades are simulated locally" : account}><span className={`acct-dot ${chainOk ? "" : "bad"}`} />{NOT_DEPLOYED ? "demo·" : ""}{account.slice(0, 6)}…{account.slice(-4)}</span>
          ) : (
            <button className="btn-connect" onClick={connectWallet}><Wallet size={15} /> Connect</button>
          )}
        </div>
      </nav>

      {markets.length > 0 && view !== "home" && (
        <div className="ticker">
          <div className="ticker-track">
            {[...markets, ...markets].map((m, i) => {
              const o = odds(m.totalYesPool, m.totalNoPool);
              return (
                <span key={`${m.id}-${i}`} className="tick" onClick={() => { setView("markets"); setExpanded(m.id); }}>
                  <span className="t-cat">{CAT_ICONS[m.category] || "🎲"}</span>
                  <span className="t-q">{m.question}</span>
                  <span className={`t-odds ${o.y >= 50 ? "up" : "down"}`}>YES {o.y}%</span>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {view === "home" && (
        <>
          <header className="hero">
            <div className="hero-grid">
              <div className="hero-inner">
                <div className="hero-badge"><span className="pulse-dot" /><Sparkles size={13} /> Live on TAC · Telegram ready</div>
                <h1>Call it. <span className="grad">Stake it.</span> Win the pool.</h1>
                <p>Peer-to-peer prediction markets for the TON / TAC stack. Stake YES or NO, climb ranks, cash out winners. No house edge — just the pool.</p>
                <div className="hero-visual desktop-only" aria-hidden>
                  <HeroChartArt className="hero-chart-art" />
                </div>
                <div className="hero-stats">
                  <div className="stat"><CircleDollarSign className="stat-ico" size={18} /><span className="v"><CountUp value={parseFloat(ethers.formatEther(totalVol))} /> TAC</span><span className="l">Volume</span></div>
                  <div className="stat"><Activity className="stat-ico" size={18} /><span className="v"><CountUp value={activeCount} dp={0} /></span><span className="l">Live Markets</span></div>
                  <div className="stat"><Users className="stat-ico" size={18} /><span className="v"><CountUp value={totalBettors} dp={0} /></span><span className="l">Positions</span></div>
                  <div className="stat"><Eye className="stat-ico" size={18} /><span className="v">100%</span><span className="l">On-chain</span></div>
                </div>
                <div className="hero-actions">
                  <button onClick={() => { setView("markets"); setTab("open"); }}>Explore markets</button>
                  <button onClick={() => { setView("markets"); setTab("ending"); }}>Ending soon</button>
                  <button onClick={() => { setView("markets"); setSortBy("watchlist"); }}>Watchlist</button>
                  <button onClick={() => { setView("markets"); setShowCreate(true); }}>Create market</button>
                </div>
              </div>
              <aside className="hero-side">
                <div className="hero-visual mobile-only" aria-hidden>
                  <HeroChartArt className="hero-chart-art" />
                </div>
                <div className="hero-panel hero-spotlight">
                  <div className="panel-head">
                    <span className="panel-kicker">Spotlight</span>
                    <span className="panel-badge">{openMarkets.length} open</span>
                  </div>
                  {spotlightMarket ? (
                    <>
                      <div className="spotlight-cat"><CatArt cat={spotlightMarket.category} size={22} /> <span>{CAT_LABEL[spotlightMarket.category] || spotlightMarket.category}</span></div>
                      <h3>{spotlightMarket.question}</h3>
                      <p>{spotlightMarket.description || "Live market with the deepest pool and strongest signal."}</p>
                      <div className="panel-meta">
                        <span>{fmt(spotlightMarket.totalYesPool + spotlightMarket.totalNoPool)} TAC</span>
                        <span>{timeLeft(spotlightMarket.resolutionTime, now, spotlightMarket.status)}</span>
                      </div>
                      <div className="panel-prob">
                        {(() => { const o = odds(spotlightMarket.totalYesPool, spotlightMarket.totalNoPool); return <><b>YES {o.y}%</b><span>NO {o.n}%</span></>; })()}
                      </div>
                    </>
                  ) : <p>No live markets yet.</p>}
                </div>
                <div className="hero-panel hero-metrics">
                  <div>
                    <span>Watchlist</span>
                    <b>{watchlistedMarkets.length}</b>
                  </div>
                  <div>
                    <span>Ending soon</span>
                    <b>{openMarkets.filter(m => m.resolutionTime - now < 86400 * 2).length}</b>
                  </div>
                  <div>
                    <span>Overdue</span>
                    <b>{unresolvedCount}</b>
                  </div>
                  <div>
                    <span>Disputes</span>
                    <b>{disputedMarkets.length}</b>
                  </div>
                </div>
                <div className="hero-panel hero-activity">
                  <div className="panel-head compact">
                    <span className="panel-kicker">Latest pulse</span>
                    <span className="panel-badge soft">live</span>
                  </div>
                  {latestActivity ? <p>{latestActivity.text}</p> : <p>Activity feed wakes as bets land.</p>}
                  {closingSoonMarket && <button className="hero-jump" onClick={() => { setExpanded(closingSoonMarket.id); document.getElementById(`mk-${closingSoonMarket.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }); }}>Jump to nearest close</button>}
                </div>
              </aside>
            </div>
            {NOT_DEPLOYED && <div className="demo-banner">🔧 Demo mode — contract not deployed yet. All UI is live; transactions enable once the contract address is set in the Admin panel.</div>}
          </header>

          {trending.length > 0 && (
            <section className="trending">
              <h3><Flame size={16} /> Trending</h3>
              <div className="trend-row">
                {trending.map(m => {
                  const o = odds(m.totalYesPool, m.totalNoPool);
                  return (
                    <div key={m.id} className="trend-card" onClick={() => { setView("markets"); setExpanded(m.id); requestAnimationFrame(() => document.getElementById(`mk-${m.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })); }}>
                      <span className="trend-cat">{CAT_ICONS[m.category]} {m.category}</span>
                      <p>{m.question}</p>
                      <div className="trend-foot">
                        <span className="trend-odds"><b className="y">{o.y}%</b> YES</span>
                        <Sparkline points={priceHistory[m.id] || []} />
                        <span className="trend-vol">{fmt(m.totalYesPool + m.totalNoPool)} TAC</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section className="how-strip">
            <h3><Gauge size={16} /> How it works</h3>
            <div className="how-step" data-n="1"><span className="hs-ico">✨</span><b>Create or find a market</b><p>Any yes/no question with a deadline. Creators seed the pool with their own stake.</p></div>
            <div className="how-step" data-n="2"><span className="hs-ico">🎯</span><b>Stake YES or NO</b><p>Your TAC joins that side's pool. Live odds shift with every bet — early conviction pays more.</p></div>
            <div className="how-step" data-n="3"><span className="hs-ico">🏁</span><b>Market resolves</b><p>After the deadline the outcome is set on-chain, with a 3-day dispute window for safety.</p></div>
            <div className="how-step" data-n="4"><span className="hs-ico">💰</span><b>Winners split the pot</b><p>Your stake back plus a pro-rata share of the losing pool. No house edge — ever.</p></div>
          </section>

          <section className="landing-cta">
            <h2>Ready to call it?</h2>
            <p>Browse live pools, stake your conviction, and climb the leaderboard.</p>
            <button className="btn-create big" onClick={() => setView("markets")}><BarChart3 size={16} /> Open the Markets</button>
          </section>

          <section className="faq-section">
            <h3><HelpCircle size={16} /> FAQ</h3>
            <div className="faq-list">
              {FAQ_ITEMS.map((item, i) => (
                <button
                  key={item.q}
                  type="button"
                  className={`faq-item ${faqOpen === i ? "open" : ""}`}
                  onClick={() => setFaqOpen(faqOpen === i ? null : i)}
                >
                  <span className="faq-q">{item.q}<ChevronDown size={15} className={faqOpen === i ? "rot" : ""} /></span>
                  {faqOpen === i && <span className="faq-a">{item.a}</span>}
                </button>
              ))}
            </div>
          </section>
        </>
      )}

      {view === "markets" && (
        <>
          <div className="page-head">
            <h2><BarChart3 size={22} /> Markets</h2>
            <p className="sub">{activeCount} live · {fmt(totalVol)} TAC total volume{NOT_DEPLOYED ? " · demo data" : ""}</p>
          </div>

          <div className="cat-browse">
            <button className={`catb ${catFilter === "" ? "on" : ""}`} onClick={() => setCatFilter("")}>
              <span className="cb-art"><CatArt cat="misc" size={20} /></span> All
              <span className="cb-n">{markets.length}</span>
            </button>
            {CATEGORIES.map(c => {
              const n = markets.filter(m => m.category === c).length;
              return (
                <button key={c} className={`catb ${catFilter === c ? "on" : ""}`} onClick={() => setCatFilter(catFilter === c ? "" : c)}>
                  <span className="cb-art"><CatArt cat={c} size={20} /></span> {CAT_LABEL[c] || c}
                  <span className="cb-n">{n}</span>
                </button>
              );
            })}
          </div>

          <div className="controls" id="market-controls">
            <div className="tabs">
              {(["all", "open", "ending", "resolved", "mine"] as const).map(t => (
                <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
                  {t === "ending" ? <><Flame size={13} /> Ending</> : t[0].toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
            <div className="search-shelf">
              <label className="search-box" aria-label="Search markets">
                <Search size={14} />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search questions, tags, or themes" />
              </label>
              <label className="sort-box" aria-label="Sort markets">
                <ArrowUpDown size={14} />
                <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}>
                  <option value="trending">Trending</option>
                  <option value="newest">Newest</option>
                  <option value="ending">Ending soon</option>
                  <option value="volume">Largest pool</option>
                  <option value="watchlist">Watchlist</option>
                </select>
              </label>
              <button className={`watch-chip ${sortBy === "watchlist" ? "on" : ""}`} onClick={() => setSortBy(sortBy === "watchlist" ? "trending" : "watchlist")}>
                <Bookmark size={14} /> Watchlist {favorites.length ? `(${favorites.length})` : ""}
              </button>
            </div>
            <div className="ctrl-right">
              <button className="btn-refresh" onClick={loadAll} disabled={loading}><RefreshCw size={15} className={loading ? "spin" : ""} /></button>
              <button className="btn-create" onClick={() => setShowCreate(!showCreate)}>{showCreate ? <X size={15} /> : <Plus size={15} />} Create Market</button>
            </div>
          </div>

          {showCreate && (
            <section className="create-panel">
              <h3><Sparkles size={16} /> Create a Market</h3>
              <p className="sub">Your stake seeds the first outcome from your vault. Winners split the pool. Add an oracle source so resolution is auditable.</p>
              <div className="mode-toggle">
                <button type="button" className={!multiMode ? "on" : ""} onClick={() => setMultiMode(false)}>Binary YES / NO</button>
                <button type="button" className={multiMode ? "on" : ""} onClick={() => setMultiMode(true)}>Multi-outcome</button>
              </div>
              <input className="big-input" placeholder={multiMode ? "Who / what wins by deadline?" : "Will X happen by Y date?"} value={q} onChange={e => setQ(e.target.value)} maxLength={200} />
              <textarea placeholder="Resolution criteria — be specific: data source, exact threshold, timezone…" value={desc} onChange={e => setDesc(e.target.value)} rows={2} maxLength={1000} />
              <input className="src-input" placeholder="Oracle / resolution source (URL or description)" value={resolutionSource} onChange={e => setResolutionSource(e.target.value)} maxLength={300} />
              {multiMode && (
                <div className="outcome-editor">
                  <span className="oe-label">Outcomes (2–8) — stake seeds the first</span>
                  {outcomeDrafts.map((o, i) => (
                    <div key={i} className="oe-row">
                      <input value={o} placeholder={`Outcome ${i + 1}`} maxLength={48} onChange={e => {
                        const next = [...outcomeDrafts];
                        next[i] = e.target.value;
                        setOutcomeDrafts(next);
                      }} />
                      {outcomeDrafts.length > 2 && (
                        <button type="button" className="icon-chip" onClick={() => setOutcomeDrafts(outcomeDrafts.filter((_, j) => j !== i))}><X size={12} /></button>
                      )}
                    </div>
                  ))}
                  {outcomeDrafts.length < 8 && (
                    <button type="button" className="btn-ghost" onClick={() => setOutcomeDrafts([...outcomeDrafts, ""])}>+ Add outcome</button>
                  )}
                </div>
              )}
              <div className="row">
                <label>Category<select value={cat} onChange={e => setCat(e.target.value)}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></label>
                <label>Duration<select value={duration} onChange={e => setDuration(e.target.value)}>{Object.keys(DURATIONS).map(d => <option key={d}>{d}</option>)}</select></label>
                <label>Stake (TAC)<input type="number" min="0.01" value={stake} onChange={e => setStake(e.target.value)} /></label>
              </div>
              <div className="row-end">
                <span className="vault-note"><Landmark size={13} /> Vault: {fmt(vaultBalance)} TAC {ethers.parseEther(stake || "0") > vaultBalance && <b className="warn">— insufficient</b>}</span>
                <button className="btn-submit" onClick={createMarket} disabled={busy.create}>
                  {busy.create ? "Creating…" : `Create · ${stake} TAC on ${multiMode ? (outcomeDrafts[0] || "first") : "YES"}`}
                </button>
              </div>
            </section>
          )}

          <main className="grid">
            {loading && filtered.length === 0 && <LoadingSkeleton rows={4} />}
            {filtered.length === 0 && !loading && (
              <div className="empty rich">
                <EmptyMarketsArt />
                <b>No markets match</b>
                <span>Try another category, clear search, or create the first market.</span>
                <button className="btn-create" onClick={() => setShowCreate(true)}><Plus size={15} /> Create market</button>
              </div>
            )}
            {filtered.map((m, idx) => {
              const o = odds(m.totalYesPool, m.totalNoPool);
              const isExp = expanded === m.id;
              const open = m.status === STATUS.Open && now < m.resolutionTime;
              const ended = m.status === STATUS.Open && now >= m.resolutionTime;
              const isMulti = (m.outcomeCount || 2) > 2;
              const multiWon = isMulti && m.status === STATUS.Resolved && (m.myOutcomeIndex ?? -1) === (m.winnerOutcome ?? -2);
              const multiLost = isMulti && m.status === STATUS.Resolved && (m.myOutcomeIndex ?? -1) >= 0 && (m.myOutcomeIndex ?? -1) !== (m.winnerOutcome ?? -2);
              const canClaim = m.status === STATUS.Resolved && !m.myClaimed && (
                (!isMulti && m.mySide === m.winner && m.mySide !== SIDE.None) || multiWon
              );
              const canRefund = (m.status === STATUS.Refunded || m.status === STATUS.Cancelled) && !m.myClaimed && (m.mySide !== SIDE.None || (m.myOutcomeIndex ?? -1) >= 0);
              const canDispute = m.status === STATUS.Resolved && (m.mySide !== SIDE.None || (m.myOutcomeIndex ?? -1) >= 0);
              const multiTotal = (m.outcomePools || []).reduce((a, b) => a + b, 0n);
              const canCancel = m.status === STATUS.Open && isCreator(m) && (isMulti ? multiTotal === m.myAmount : m.totalNoPool === 0n);
              const canRexp = ended && (isMulti
                ? (m.outcomePools || []).filter(p => p > 0n).length <= 1
                : (m.totalYesPool === 0n || m.totalNoPool === 0n));
              const lost = (!isMulti && m.status === STATUS.Resolved && m.mySide !== SIDE.None && m.mySide !== m.winner) || multiLost;
              const urgent = open && m.resolutionTime - now < 86400 * 2;
              const hist = priceHistory[m.id] || [];
              const poolVol = isMulti ? multiTotal : m.totalYesPool + m.totalNoPool;
              const bettorCount = isMulti ? (m.outcomeBettors || []).reduce((a, b) => a + b, 0) : m.yesBettors + m.noBettors;
              const multiPcts = isMulti ? multiOdds(m.outcomePools || [0n]) : [];
              const leadIdx = isMulti ? multiPcts.reduce((bi, v, i, arr) => v > arr[bi] ? i : bi, 0) : 0;
              const leadPct = isMulti ? (multiPcts[leadIdx] || 0) : o.y;
              const leadLab = isMulti ? ((m.outcomeLabels || [])[leadIdx] || "—") : "YES";
              return (
                <div key={m.id} id={`mk-${m.id}`} className={`card ${!open ? "done" : ""} ${isExp ? "exp" : ""} ${urgent ? "hot" : ""} ${isMulti ? "multi" : ""}`} style={{ "--d": `${Math.min(idx, 8) * 55}ms` } as any}>
                  <div className="card-head" onClick={() => { setExpanded(isExp ? null : m.id); if (!isExp) questBump("scout"); }}>
                    <div className="ch-left">
                      <span className="cat-chip art"><CatArt cat={m.category} size={16} /> {CAT_LABEL[m.category] || m.category}</span>
                      {isMulti && <span className="fav-chip">multi · {(m.outcomeCount || 0)} ways</span>}
                      {favoritesSet.has(m.id) && <span className="fav-chip"><Bookmark size={11} /> watched</span>}
                      {urgent && <span className="urgent-chip"><Flame size={11} /> ending soon</span>}
                      {m.status === STATUS.Resolved && !isMulti && <span className={`res-chip ${m.winner === SIDE.Yes ? "y" : "n"}`}>{m.winner === SIDE.Yes ? "YES ✓" : "NO ✗"}</span>}
                      {m.status === STATUS.Resolved && isMulti && <span className="res-chip y">{(m.outcomeLabels || [])[m.winnerOutcome || 0] || "?"} ✓</span>}
                      {m.status === STATUS.Disputed && <span className="res-chip d"><Scale size={11} /> DISPUTED</span>}
                      {m.status === STATUS.Cancelled && <span className="res-chip c">CANCELLED</span>}
                      {m.status === STATUS.Refunded && <span className="res-chip c">REFUNDED</span>}
                      {m.mySide !== SIDE.None && !isMulti && <span className={`my-chip ${m.mySide === SIDE.Yes ? "y" : "n"}`}>you: {sideLabel(m.mySide)}</span>}
                      {isMulti && (m.myOutcomeIndex ?? -1) >= 0 && <span className="my-chip y">you: {(m.outcomeLabels || [])[m.myOutcomeIndex!]}</span>}
                    </div>
                    <div className="ch-main">
                      <h3>{m.question}</h3>
                      {hist.length > 1 && !isExp && !isMulti && <Sparkline points={hist} />}
                    </div>
                    <div className="ch-odds" aria-label={`${leadLab} ${leadPct} percent`}>
                      <span className="odds-yes">{leadPct}%</span>
                      <span className="odds-lbl">{isMulti ? leadLab.slice(0, 10) : "YES"}</span>
                      {!isMulti && <span className="odds-no">NO {o.n}%</span>}
                      {isMulti && <span className="odds-no">{m.outcomeCount} outcomes</span>}
                    </div>
                    <div className="ch-meta">
                      <span><CircleDollarSign size={12} /> {fmt(poolVol)} TAC</span>
                      <span><Users size={12} /> {bettorCount}</span>
                      <button className={`icon-chip ${favoritesSet.has(m.id) ? "on" : ""}`} onClick={e => { e.stopPropagation(); toggleFavorite(m.id); }} title={favoritesSet.has(m.id) ? "Remove from watchlist" : "Add to watchlist"}>
                        <Bookmark size={12} />
                      </button>
                      <button className="icon-chip" onClick={e => { e.stopPropagation(); copyMarketLink(m.id); }} title="Copy share link">
                        <Link2 size={12} />
                      </button>
                      <button className="icon-chip" onClick={e => { e.stopPropagation(); shareMarket(m); }} title="Share">
                        <Share2 size={12} />
                      </button>
                      <span className={urgent ? "urgent-t" : ""}><Clock size={12} /> {timeLeft(m.resolutionTime, now, m.status)}</span>
                      <ChevronDown size={15} className={`chev ${isExp ? "rot" : ""}`} />
                    </div>
                  </div>

                  {(m.outcomeCount || 2) <= 2 ? (
                    <div className="prob">
                      <div className="prob-track">
                        <div className="prob-yes" style={{ width: `${o.y}%` }}><span className="prob-shimmer" /></div>
                      </div>
                      <div className="prob-nums">
                        <span className="py">YES {o.y}%</span>
                        <span className="pn">NO {o.n}%</span>
                      </div>
                    </div>
                  ) : (
                    <div className="multi-prob">
                      {(() => {
                        const pools = m.outcomePools || [];
                        const pcts = multiOdds(pools);
                        const labels = m.outcomeLabels || [];
                        return labels.map((lab, i) => (
                          <div key={i} className="mp-row">
                            <span className="mp-lab">{lab}</span>
                            <div className="mp-track"><div style={{ width: `${pcts[i]}%` }} /></div>
                            <span className="mp-pct">{pcts[i]}%</span>
                          </div>
                        ));
                      })()}
                    </div>
                  )}

                  {open && !isExp && (m.outcomeCount || 2) <= 2 && (
                    <div className="quick-trade" onClick={e => e.stopPropagation()}>
                      {!account ? (
                        <button className="qt-connect" onClick={connectWallet}>
                          <Wallet size={15} /> Connect to trade
                        </button>
                      ) : (
                        <>
                          <button
                            className="qt-yes"
                            disabled={!!busy[`bet-${m.id}`] || m.mySide === SIDE.No}
                            onClick={() => { setExpanded(m.id); setTradeMode({ ...tradeMode, [m.id]: "buy" }); bet(m.id, 1); tgHaptic("medium"); }}
                          >
                            YES <small>{(100 / Math.max(1, o.y)).toFixed(2)}x</small>
                          </button>
                          <button
                            className="qt-no"
                            disabled={!!busy[`bet-${m.id}`] || m.mySide === SIDE.Yes}
                            onClick={() => { setExpanded(m.id); setTradeMode({ ...tradeMode, [m.id]: "buy" }); bet(m.id, 2); tgHaptic("medium"); }}
                          >
                            NO <small>{(100 / Math.max(1, o.n)).toFixed(2)}x</small>
                          </button>
                        </>
                      )}
                    </div>
                  )}
                  {open && !isExp && (m.outcomeCount || 2) > 2 && (
                    <div className="quick-trade multi" onClick={e => e.stopPropagation()}>
                      {!account ? (
                        <button className="qt-connect" onClick={connectWallet}><Wallet size={15} /> Connect to trade</button>
                      ) : (
                        (m.outcomeLabels || []).slice(0, 4).map((lab, i) => (
                          <button key={i} className="qt-multi" disabled={!!busy[`bet-${m.id}`]} onClick={() => { setExpanded(m.id); betOutcome(m.id, i); tgHaptic("medium"); }}>
                            {lab}
                          </button>
                        ))
                      )}
                    </div>
                  )}

                  {isExp && (
                    <div className="card-body">
                      {(m.outcomeCount || 2) <= 2 && <ProbChart points={hist} />}
                      {m.description && <p className="desc">{m.description}</p>}
                      {m.resolutionSource && (
                        <div className="oracle-pill"><Shield size={12} /> Oracle: <a href={/^https?:\/\//i.test(m.resolutionSource) ? m.resolutionSource : undefined} target="_blank" rel="noreferrer">{m.resolutionSource}</a></div>
                      )}
                      <div className="facts">
                        <span><Clock size={12} /> Resolves {new Date(m.resolutionTime * 1000).toLocaleString()}</span>
                        <span><Users size={12} /> By {m.creator.slice(0, 6)}…{m.creator.slice(-4)}{isCreator(m) ? " (you)" : ""}</span>
                        {(m.outcomeCount || 2) <= 2 ? (
                          <span><BarChart3 size={12} /> YES {fmt(m.totalYesPool)} ({m.yesBettors}) · NO {fmt(m.totalNoPool)} ({m.noBettors})</span>
                        ) : (
                          <span><BarChart3 size={12} /> {(m.outcomeLabels || []).map((lab, i) => `${lab} ${fmt((m.outcomePools || [])[i] || 0n)}`).join(" · ")}</span>
                        )}
                        {m.mySide !== SIDE.None && <span><Target size={12} /> Your stake: {fmt(m.myAmount)} TAC{m.status === STATUS.Open && (m.potYes > 0n || m.potNo > 0n) ? ` → ${fmt(m.mySide === SIDE.Yes ? m.potYes : m.potNo)} TAC if ${sideLabel(m.mySide)}` : ""}</span>}
                        {(m.myOutcomeIndex ?? -1) >= 0 && (m.outcomeCount || 2) > 2 && (
                          <span><Target size={12} /> Your pick: {(m.outcomeLabels || [])[m.myOutcomeIndex!]} · {fmt(m.myAmount)} TAC</span>
                        )}
                      </div>

                      {open && account && (m.outcomeCount || 2) > 2 && (
                        <div className="trade-panel multi-trade">
                          <div className="bet-input">
                            <input type="number" min="0.01" value={betAmt[m.id] || "5"} onChange={e => setBetAmt({ ...betAmt, [m.id]: e.target.value })} />
                            <div className="quick-sm">{["5", "25", "100"].map(v => <button key={v} onClick={() => setBetAmt({ ...betAmt, [m.id]: v })}>{v}</button>)}</div>
                          </div>
                          <div className="multi-bet-grid">
                            {(m.outcomeLabels || []).map((lab, i) => {
                              const pcts = multiOdds(m.outcomePools || []);
                              return (
                                <button key={i} className={`b-multi ${(multiPick[m.id] ?? m.myOutcomeIndex) === i ? "on" : ""}`} disabled={!!busy[`bet-${m.id}`]} onClick={() => { setMultiPick({ ...multiPick, [m.id]: i }); betOutcome(m.id, i); }}>
                                  <b>{lab}</b>
                                  <small>{pcts[i]}% · {fmt((m.outcomePools || [])[i] || 0n)} TAC</small>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {open && account && (m.outcomeCount || 2) <= 2 && (
                        <div className="trade-panel">
                          <div className="trade-tabs">
                            <button className={(tradeMode[m.id] || "buy") === "buy" ? "on buy" : ""} onClick={() => setTradeMode({ ...tradeMode, [m.id]: "buy" })}>Buy</button>
                            <button className={tradeMode[m.id] === "sell" ? "on sell" : ""} disabled={m.mySide === SIDE.None || m.myAmount === 0n} onClick={() => setTradeMode({ ...tradeMode, [m.id]: "sell" })} title={m.mySide === SIDE.None ? "No position to sell" : "Sell part or all of your position back to the vault"}>Sell</button>
                            {m.mySide !== SIDE.None && <span className="trade-held">holding {fmt(m.myAmount)} TAC {sideLabel(m.mySide)}</span>}
                          </div>
                          {(tradeMode[m.id] || "buy") === "buy" ? (
                            <>
                              <div className="bet-zone">
                                <div className="bet-input">
                                  <input type="number" min="0.01" value={betAmt[m.id] || "5"} onChange={e => setBetAmt({ ...betAmt, [m.id]: e.target.value })} />
                                  <div className="quick-sm">{["5", "25", "100"].map(v => <button key={v} onClick={() => setBetAmt({ ...betAmt, [m.id]: v })}>{v}</button>)}</div>
                                </div>
                                <button className="b-yes" disabled={busy[`bet-${m.id}`] || m.mySide === SIDE.No} onClick={() => bet(m.id, 1)}>
                                  <b>Buy YES</b><small>{o.y}% → pays {(100 / Math.max(1, o.y)).toFixed(2)}x</small>
                                </button>
                                <button className="b-no" disabled={busy[`bet-${m.id}`] || m.mySide === SIDE.Yes} onClick={() => bet(m.id, 2)}>
                                  <b>Buy NO</b><small>{o.n}% → pays {(100 / Math.max(1, o.n)).toFixed(2)}x</small>
                                </button>
                              </div>
                              <PayoutPreview amount={betAmt[m.id] || "5"} yesPool={m.totalYesPool} noPool={m.totalNoPool} feeBp={protocolFee} />
                            </>
                          ) : (
                            <div className="sell-zone">
                              <div className="bet-input">
                                <input type="number" min="0.01" placeholder={`empty = all (${fmt(m.myAmount)})`} value={sellAmt[m.id] || ""} onChange={e => setSellAmt({ ...sellAmt, [m.id]: e.target.value })} />
                                <div className="quick-sm">
                                  {[25, 50, 100].map(p => (
                                    <button key={p} className={(() => { const cur = sellAmt[m.id] || ""; if (p === 100) return cur === "" ? "on" : ""; try { return cur && ethers.parseEther(cur) === m.myAmount * BigInt(p) / 100n ? "on" : "" } catch { return "" } })()} onClick={() => setSellAmt({ ...sellAmt, [m.id]: p === 100 ? "" : ethers.formatEther(m.myAmount * BigInt(p) / 100n) })}>{p}%</button>
                                  ))}
                                </div>
                              </div>
                              {(() => {
                                const raw = sellAmt[m.id];
                                let w: bigint | null = null;
                                try { w = raw ? ethers.parseEther(raw) : m.myAmount } catch { w = null }
                                const MIN = ethers.parseEther("0.01");
                                const invalid = w === null || w <= 0n || w > m.myAmount;
                                const dustLeft = w !== null && !invalid && w < m.myAmount && (m.myAmount - w) < MIN;
                                const tooSmall = w !== null && !invalid && w < MIN;
                                const blocked = invalid || dustLeft || tooSmall;
                                const fee = w && !invalid ? w * BigInt(protocolFee) / 1000n : 0n;
                                return (
                                  <>
                                    <button className="b-sell" disabled={busy[`sell-${m.id}`] || blocked} onClick={() => { if (w && !blocked) sellPos(m.id, w, w) }}>
                                      <b>Sell {w !== null && !invalid && w < m.myAmount ? `${fmt(w)} ` : ""}{sideLabel(m.mySide)}</b>
                                      <small>{invalid ? "enter valid amount" : tooSmall ? "min sell 0.01 TAC" : dustLeft ? `leave ≥ 0.01 or sell all` : `get ${fmt((w as bigint) - fee)} TAC (${protocolFee / 10}% fee)`}</small>
                                    </button>
                                    <p className="sell-note">Exits at face value of your stake — not market odds. Selling removes your TAC from the {sideLabel(m.mySide)} pool and shifts the odds.</p>
                                  </>
                                );
                              })()}
                            </div>
                          )}
                        </div>
                      )}
                      {open && !account && <PayoutPreview amount={betAmt[m.id] || "5"} yesPool={m.totalYesPool} noPool={m.totalNoPool} feeBp={protocolFee} />}
                      {open && !account && <button className="btn-connect wide" onClick={connectWallet}><Wallet size={15} /> Connect wallet to trade</button>}

                      <div className="act-row">
                        {canClaim && <button className="act claim" disabled={busy[`claim-${m.id}`]} onClick={() => claim(m.id)}><PartyPopper size={14} /> Claim {fmt(m.mySide === SIDE.Yes ? m.potYes : m.potNo)} TAC</button>}
                        {canRefund && <button className="act refund" disabled={busy[`refund-${m.id}`]} onClick={() => claimRefund(m.id)}>Claim refund {fmt(m.myAmount)} TAC</button>}
                        {canDispute && !canClaim && !lost && <button className="act disp" disabled={busy[`disp-${m.id}`]} onClick={() => disputeM(m.id)}><Scale size={14} /> Dispute</button>}
                        {lost && <span className="lost">You bet {sideLabel(m.mySide)} — went the other way. <button className="link-btn" onClick={() => disputeM(m.id)}>Dispute?</button></span>}
                        {canCancel && <button className="act cancel" disabled={busy[`cancel-${m.id}`]} onClick={() => cancelM(m.id)}>Cancel & refund</button>}
                        {canRexp && <button className="act refund" disabled={busy[`rexp-${m.id}`]} onClick={() => refundExpired(m.id)}>One-sided — mark refund</button>}
                        {m.myClaimed && <span className="claimed">✓ Claimed</span>}
                        {ended && !canRexp && <span className="await"><Clock size={13} /> Awaiting resolution…</span>}
                      </div>
                      <div className="comment-box">
                        <h4>Discussion</h4>
                        <div className="comment-list">
                          {comments.filter(c => c.marketId === m.id).slice(0, 8).map((c, i) => (
                            <div key={i} className="comment-row">
                              <span className="c-author">{c.author.slice(0, 6)}…{c.author.slice(-4)}</span>
                              <span className="c-body">{c.body}</span>
                            </div>
                          ))}
                          {comments.filter(c => c.marketId === m.id).length === 0 && (
                            <p className="c-empty">No comments yet — leave a note for the crowd.</p>
                          )}
                        </div>
                        <div className="comment-compose">
                          <input
                            maxLength={280}
                            placeholder="Short comment (on-chain event when live)…"
                            value={commentDraft[m.id] || ""}
                            onChange={e => setCommentDraft({ ...commentDraft, [m.id]: e.target.value })}
                            onClick={e => e.stopPropagation()}
                          />
                          <button type="button" className="btn-ghost" onClick={e => { e.stopPropagation(); postComment(m.id); }} disabled={!!busy[`comment-${m.id}`]}>
                            Post
                          </button>
                        </div>
                      </div>

                      <div className="transparency">
                        <Shield size={12} /> Pool math on-chain · fee {protocolFee / 10}% · payout = stake + share of losing pool · 3-day dispute window
                        {m.resolutionSource ? ` · oracle: ${m.resolutionSource}` : ""}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </main>

          {activity.length > 0 && (
            <section className="feed">
              <h3><Activity size={16} /> Live Activity</h3>
              <div className="feed-list">
                {activity.map((a, i) => (
                  <div key={i} className={`feed-item ${a.type}`} style={{ "--d": `${i * 35}ms` } as any}>
                    <span className="feed-ico">{a.type === "create" ? "✨" : a.type === "bet" ? "🎯" : a.type === "resolve" ? "🏁" : a.type === "claim" ? "💰" : a.type === "deposit" ? "🏦" : a.type === "sell" ? "📤" : "↗"}</span>
                    {a.text}
                    <span className="feed-block">#{a.block}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {view === "vault" && (
        <section className="vault-page">
          <h2><Landmark size={22} /> Your Vault</h2>
          <p className="sub">Deposit once — create and bet instantly. Withdraw anytime, no lockups.</p>
          {!account && (
            <div className="empty rich" style={{ marginBottom: 16 }}>
              <EmptyVaultArt />
              <b>Connect to fund your vault</b>
              <span>Your TAC lives on-chain under your address. Bets pull from vault balance.</span>
            </div>
          )}
          <div className="vault-card">
            <div className="vault-balance">
              <span className="vb-label">Vault balance</span>
              <span className="vb-value"><CountUp value={parseFloat(ethers.formatEther(vaultBalance))} dp={4} /> <small>TAC</small></span>
              <span className="vb-wallet"><Wallet size={13} /> Wallet: {fmt(walletBalance)} TAC</span>
            </div>
            <div className="vault-actions">
              <div className="va">
                <label>Deposit</label>
                <div className="va-row">
                  <input type="number" min="0.01" value={depositAmt} onChange={e => setDepositAmt(e.target.value)} />
                  <button className="btn-submit" onClick={deposit} disabled={busy.deposit || !account}>{busy.deposit ? "…" : "Deposit"}</button>
                </div>
                <div className="quick">{["10", "50", "100", "500"].map(v => <button key={v} onClick={() => setDepositAmt(v)}>{v}</button>)}</div>
              </div>
              <div className="va">
                <label>Withdraw</label>
                <div className="va-row">
                  <input type="number" placeholder="empty = all" value={withdrawAmt} onChange={e => setWithdrawAmt(e.target.value)} />
                  <button className="btn-ghost" onClick={withdraw} disabled={busy.withdraw || !account || vaultBalance === 0n}>{busy.withdraw ? "…" : withdrawAmt ? "Withdraw" : "Withdraw All"}</button>
                </div>
              </div>
            </div>
          </div>
          <div className="vault-info">
            <div className="vi"><Shield size={16} /><div><b>Security</b><p>Reentrancy guards, pull-payouts, solvency invariant, fee hard-capped at 5% in the contract.</p></div></div>
            <div className="vi"><Zap size={16} /><div><b>How it works</b><p>Vault funds live in the contract under your address. Bets deduct; wins, refunds and cancels credit back. Withdraw anytime.</p></div></div>
          </div>
          {!account && <button className="btn-connect wide" onClick={connectWallet}><Wallet size={15} /> Connect wallet</button>}
        </section>
      )}

      {view === "portfolio" && (
        <section className="portfolio">
          <div className="page-head row-between">
            <div>
              <h2><User size={22} /> Portfolio</h2>
              <p className="sub">Positions, quests, achievements, and your local action journal.</p>
            </div>
            <div className="head-actions">
              {claimable.length > 0 && (
                <button className="btn-submit" onClick={claimAll} disabled={Object.keys(busy).some(k => k.startsWith("claim") || k.startsWith("refund"))}>
                  <PartyPopper size={15} /> Claim all ({claimable.length})
                </button>
              )}
              <button className="btn-ghost" onClick={() => {
                const rows = markets.filter(m => m.mySide !== SIDE.None).map(m => ({
                  question: m.question,
                  side: sideLabel(m.mySide),
                  amount: fmt(m.myAmount),
                  status: statusLabel(m.status),
                  pnl: m.status === STATUS.Resolved ? (m.mySide === m.winner ? "won" : "lost") : "open",
                }));
                if (!rows.length) return notify("No positions to export", true);
                exportPositionsCsv(rows);
                notify("CSV downloaded");
              }}><Download size={14} /> Export</button>
            </div>
          </div>
          <div className="quest-panel">
            <div className="qp-head">
              <h3><Zap size={17} /> Daily Quests <span className="qp-day">resets midnight</span></h3>
              <span className="qp-streak" title="Daily visit streak — bonus XP every day you show up">🔥 {streak.count}-day streak · +{Math.min(streak.count, 30) * 5} XP</span>
            </div>
            <div className="quest-grid">
              {DAILY_QUESTS.map(qd => {
                const prog = Math.min(qd.goal, quests[qd.id] || 0);
                const done = prog >= qd.goal;
                return (
                  <div key={qd.id} className={`quest ${done ? "done" : ""}`}>
                    <span className="q-ico">{qd.icon}</span>
                    <div className="q-info">
                      <b>{qd.name}</b>
                      <span className="q-desc">{qd.desc}</span>
                      <div className="q-bar"><div style={{ width: `${(prog / qd.goal) * 100}%` }} /></div>
                    </div>
                    <span className="q-xp">{done ? "✓" : `${prog}/${qd.goal}`} <small>+{qd.xp} XP</small></span>
                  </div>
                );
              })}
            </div>
          </div>
          {!account && <button className="btn-connect wide" onClick={connectWallet}><Wallet size={15} /> Connect wallet to see your stats</button>}
          {account && stats && (
            <>
              <div className="level-card">
                <div className="lc-badge">{lvl.icon}</div>
                <div className="lc-info">
                  <span className="lc-title">Level {lvl.level} · {lvl.title}</span>
                  <div className="lc-bar"><div style={{ width: `${lvl.pct}%` }} /></div>
                  <span className="lc-xp">{xp} XP{lvl.next ? ` · ${lvl.next.xp - xp} to ${lvl.next.title}` : " · MAX"}</span>
                </div>
                <div className="lc-rings">
                  <Ring pct={winRate} label={`${winRate}%`} />
                  <span className="ring-cap">Win rate</span>
                </div>
              </div>

              <div className="stat-cards">
                <div className="sc"><span className="sc-v">{stats.betsPlaced}</span><span className="sc-l">Bets</span></div>
                <div className="sc"><span className="sc-v">{stats.wins}</span><span className="sc-l">Wins</span></div>
                <div className="sc"><span className="sc-v">{stats.losses}</span><span className="sc-l">Losses</span></div>
                <div className="sc"><span className="sc-v">{stats.marketsCreated}</span><span className="sc-l">Created</span></div>
                <div className="sc"><span className="sc-v">{fmt(stats.totalStaked)}</span><span className="sc-l">TAC Staked</span></div>
                <div className={`sc big ${pnl >= 0n ? "pos" : "neg"}`}>
                  <span className="sc-v">{pnl >= 0n ? "+" : "−"}{fmt(pnl < 0n ? -pnl : pnl)}</span>
                  <span className="sc-l">Net P&L (TAC)</span>
                </div>
              </div>

              <h3><Award size={17} /> Achievements <span className="ach-count">{unlocked.length}/{ACHIEVEMENTS.length}</span></h3>
              <div className="ach-grid">
                {ACHIEVEMENTS.map(a => {
                  const got = unlocked.some(u => u.id === a.id);
                  return (
                    <div key={a.id} className={`ach ${got ? "got" : ""}`}>
                      <span className="a-ico">{a.icon}</span>
                      <b>{a.name}</b>
                      <span className="a-desc">{a.desc}</span>
                      {got && <span className="a-check">✓</span>}
                    </div>
                  );
                })}
              </div>

              <h3><BarChart3 size={17} /> Your Positions</h3>
              <div className="pos-list">
                {markets.filter(m => m.mySide !== SIDE.None).map(m => {
                  const won = m.status === STATUS.Resolved && m.mySide === m.winner;
                  const lostP = m.status === STATUS.Resolved && m.mySide !== m.winner;
                  return (
                    <div key={m.id} className={`pos ${won ? "won" : lostP ? "lost" : ""}`} onClick={() => { setView("markets"); setExpanded(m.id); setTab("mine") }}>
                      <span className={`pos-side ${m.mySide === SIDE.Yes ? "y" : "n"}`}>{sideLabel(m.mySide)}</span>
                      <span className="pos-q">{m.question}</span>
                      <span className="pos-amt">{fmt(m.myAmount)} TAC</span>
                      <span className="pos-status">{won ? (m.myClaimed ? "✓ Won & claimed" : "🏆 Won — claim!") : lostP ? "✗ Lost" : statusLabel(m.status)}</span>
                    </div>
                  );
                })}
                {markets.filter(m => m.mySide !== SIDE.None).length === 0 && (
                  <div className="empty rich">
                    <EmptyMarketsArt />
                    <b>No positions yet</b>
                    <span>Pick a market and stake your conviction.</span>
                    <button className="btn-create" onClick={() => setView("markets")}>Browse markets</button>
                  </div>
                )}
              </div>

              <div className="port-tools">
                <button className="btn-ghost" onClick={() => setView("settings")}><Settings size={14} /> Settings</button>
                <button className="btn-ghost" onClick={() => setCalcOpen(true)}><Calculator size={14} /> Calculator</button>
              </div>

              <h3><History size={17} /> Action journal</h3>
              <p className="sub tight">Local log of your deposits, bets, claims, and fails on this device.</p>
              <div className="journal-list">
                {journal.length === 0 && <div className="empty">No actions logged yet.</div>}
                {journal.slice(0, 24).map(j => (
                  <div key={j.id} className={`journal-row ${j.ok ? "ok" : "bad"}`}>
                    <span className="j-kind">{j.kind}</span>
                    <span className="j-label">{j.label}</span>
                    <span className="j-time">{new Date(j.t * 1000).toLocaleString()}</span>
                  </div>
                ))}
              </div>
              {journal.length > 0 && (
                <button className="btn-ghost" style={{ marginTop: 10 }} onClick={() => { clearJournal(); setJournal([]); notify("Journal cleared"); }}>
                  Clear journal
                </button>
              )}
            </>
          )}
        </section>
      )}

      {view === "settings" && (
        <section className="settings-page">
          <div className="page-head">
            <h2><Settings size={22} /> Settings</h2>
            <p className="sub">Tune haptics, sounds, alerts, and appearance for Telegram and desktop.</p>
          </div>
          <div className="settings-grid">
            <div className="set-card">
              <h4><Vibrate size={15} /> Feedback</h4>
              <label className="set-row">
                <span>Telegram haptics</span>
                <input type="checkbox" checked={prefs.haptics} onChange={e => updatePrefs({ haptics: e.target.checked })} />
              </label>
              <label className="set-row">
                <span><Volume2 size={14} /> UI sounds</span>
                <input type="checkbox" checked={prefs.sounds} onChange={e => { updatePrefs({ sounds: e.target.checked }); if (e.target.checked) playSound("tap", true); }} />
              </label>
              <label className="set-row">
                <span><Moon size={14} /> Reduce motion</span>
                <input type="checkbox" checked={prefs.reduceMotion} onChange={e => updatePrefs({ reduceMotion: e.target.checked })} />
              </label>
            </div>
            <div className="set-card">
              <h4><Bell size={15} /> Alerts</h4>
              <label className="set-row">
                <span>Ending-soon toasts</span>
                <input type="checkbox" checked={prefs.endingAlerts} onChange={async e => {
                  const on = e.target.checked;
                  if (on && typeof Notification !== "undefined" && Notification.permission === "default") {
                    try { await Notification.requestPermission(); } catch { /* noop */ }
                  }
                  updatePrefs({ endingAlerts: on });
                }} />
              </label>
              <label className="set-row col">
                <span>Alert window (hours)</span>
                <input type="number" min="1" max="168" value={prefs.alertThresholdHrs} onChange={e => updatePrefs({ alertThresholdHrs: Math.max(1, parseInt(e.target.value || "24", 10)) })} />
              </label>
              <p className="set-note">Optional browser notifications require permission. Works best when the tab stays open.</p>
            </div>
            <div className="set-card">
              <h4><Palette size={15} /> Theme</h4>
              <div className="theme-pick">
                {THEMES.map(t => (
                  <button key={t} type="button" className={`theme-swatch ${theme === t ? "on" : ""}`} data-t={t} onClick={() => setTheme(t)}>
                    {THEME_LABEL[t]}
                  </button>
                ))}
              </div>
            </div>
            <div className="set-card">
              <h4><Calculator size={15} /> Tools</h4>
              <button className="act" onClick={() => setCalcOpen(true)}><Calculator size={14} /> Open odds calculator</button>
              <button className="act" onClick={() => { setShowOnboarding(true); setOnboardStep(0); }}><Sparkles size={14} /> Replay onboarding</button>
              <button className="act" onClick={() => setView("home")}><HelpCircle size={14} /> FAQ on Home</button>
            </div>
            <div className="set-card wide">
              <h4><Shield size={15} /> Session</h4>
              <div className="ad-conn">
                <div><span>Mode</span><code>{NOT_DEPLOYED ? "Demo" : "Live"}</code></div>
                <div><span>Network</span><code>{ACTIVE_CHAIN_NAME}</code></div>
                <div><span>Telegram</span><code>{IN_TELEGRAM ? "Mini App" : "Browser"}</code></div>
                <div><span>Contract</span><code>{NOT_DEPLOYED ? "not set" : CONTRACT_ADDRESS}</code></div>
              </div>
            </div>
          </div>
        </section>
      )}

      {view === "leaderboard" && (
        <section className="leaderboard">
          <h2><Trophy size={22} /> Leaderboard</h2>
          <p className="sub">Ranked by on-chain volume (last ~45k blocks). Fully transparent — computed from events anyone can verify.</p>
          {leaders.length === 0 && <div className="empty"><Trophy size={22} />No activity indexed yet.</div>}
          <div className="lb-list">
            {leaders.map((l, i) => (
              <div key={l.addr} className={`lb-row ${i < 3 ? `top t${i + 1}` : ""} ${account && l.addr === account.toLowerCase() ? "me" : ""}`} style={{ "--d": `${i * 45}ms` } as any}>
                <span className="lb-rank">{i === 0 ? <Crown size={17} /> : i === 1 ? <Medal size={16} /> : i === 2 ? <Star size={15} /> : `#${i + 1}`}</span>
                <span className="lb-addr">{l.addr.slice(0, 8)}…{l.addr.slice(-6)}{account && l.addr === account.toLowerCase() ? " (you)" : ""}</span>
                <span className="lb-bets">{l.bets} bets</span>
                <span className="lb-wins">{l.wins} claims</span>
                <span className="lb-vol">{fmt(l.volume)} TAC</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {view === "admin" && isOwner && (
        <section className="admin">
          <div className="admin-head">
            <div>
              <h2><Shield size={22} /> Admin Console</h2>
              <p className="sub">Protocol operations, live-chain configuration and launch checklist. Only visible to the contract owner.</p>
            </div>
            <span className={`admin-env ${NOT_DEPLOYED ? "demo" : "live"}`}>{NOT_DEPLOYED ? "DEMO MODE" : "LIVE CHAIN"}</span>
          </div>

          <div className="admin-tabs">
            {([["overview", "Overview"], ["launch", "Launch Setup"], ["ops", "Operations"]] as const).map(([k, label]) => (
              <button key={k} className={adminMode === k ? "on" : ""} onClick={() => setAdminMode(k)}>{label}</button>
            ))}
          </div>

          {adminMode === "overview" && (
            <div className="admin-grid">
              <div className="ad-card">
                <h4><Gauge size={15} /> Protocol Status</h4>
                <div className="ad-facts">
                  <span>State <b className={paused ? "warn" : "ok"}>{paused ? "PAUSED" : "LIVE"}</b></span>
                  <span>Solvency <b className={solvent ? "ok" : "warn"}>{solvent ? "SOLVENT ✓" : "⚠ INSOLVENT"}</b></span>
                  <span>Fee <b>{protocolFee / 10}%</b></span>
                  <span>Accrued <b>{fmt(accFees)} TAC</b></span>
                </div>
                <button className={`act ${paused ? "claim" : "cancel"}`} onClick={adminPause} disabled={busy.apause}>
                  {paused ? <><Play size={14} /> Unpause</> : <><Pause size={14} /> Pause protocol</>}
                </button>
              </div>
              <div className="ad-card">
                <h4><Activity size={15} /> Market Health</h4>
                <div className="ad-facts">
                  <span>Total markets <b>{markets.length}</b></span>
                  <span>Open <b>{openMarkets.length}</b></span>
                  <span>Awaiting resolution <b className={awaitingResolution.length ? "warn" : "ok"}>{awaitingResolution.length}</b></span>
                  <span>Disputes <b className={disputedMarkets.length ? "warn" : "ok"}>{disputedMarkets.length}</b></span>
                  <span>Volume <b>{fmt(totalVol)} TAC</b></span>
                  <span>Positions <b>{totalBettors}</b></span>
                </div>
                {(awaitingResolution.length > 0 || disputedMarkets.length > 0) && (
                  <button className="act" onClick={() => setAdminMode("ops")}>Go to Operations →</button>
                )}
              </div>
              <div className="ad-card wide">
                <h4><Link2 size={15} /> Connection</h4>
                <div className="ad-conn">
                  <div><span>Contract</span><code>{NOT_DEPLOYED ? "not deployed (demo data)" : CONTRACT_ADDRESS}</code></div>
                  <div><span>RPC</span><code>{TAC_RPC}</code></div>
                  <div><span>Network</span><code>{ACTIVE_CHAIN_NAME} ({ACTIVE_CHAIN})</code></div>
                  <div><span>Owner</span><code>{account}</code></div>
                </div>
                {NOT_DEPLOYED && <p className="sub" style={{ marginTop: 10 }}>The app is running on seeded demo data. Head to <b>Launch Setup</b> for the exact steps to go live on TAC.</p>}
              </div>
            </div>
          )}

          {adminMode === "launch" && (
            <div className="admin-grid">
              <div className="ad-card wide launch-config">
                <h4><Zap size={15} /> Live-chain configuration</h4>
                <p className="sub">Saved to this browser (localStorage) and applied on reload — overrides the build-time <code>.env</code>. For a permanent setup, also update <code>frontend/.env</code> and rebuild.</p>
                <div className="lc-grid">
                  <label>Contract address
                    <input placeholder="0x… (deployed PredictionPoolV3)" value={configDraft.contract || ""} onChange={e => setConfigDraft({ ...configDraft, contract: e.target.value.trim() })} />
                    {configDraft.contract && !ethers.isAddress(configDraft.contract) && <em className="lc-err">Not a valid EVM address</em>}
                  </label>
                  <label>RPC endpoint
                    <input placeholder="http://127.0.0.1:8545 or https://rpc.tac.build" value={configDraft.rpc || ""} onChange={e => setConfigDraft({ ...configDraft, rpc: e.target.value.trim() })} />
                    {configDraft.rpc && !isValidRpc(configDraft.rpc) && <em className="lc-err">Must be an http(s):// URL</em>}
                  </label>
                  <label>Network
                    <select value={configDraft.chain || "mainnet"} onChange={e => setConfigDraft({ ...configDraft, chain: e.target.value as "mainnet" | "testnet" | "local" })}>
                      <option value="mainnet">TAC Mainnet (chain 239 / 0xEF)</option>
                      <option value="testnet">TAC Testnet (chain 2391 / 0x957)</option>
                      <option value="local">Local Anvil (chain 31337 / 0x7A69)</option>
                    </select>
                  </label>
                </div>
                <div className="lc-actions">
                  <button
                    className="btn-submit"
                    disabled={!!(configDraft.contract && !ethers.isAddress(configDraft.contract)) || !!(configDraft.rpc && !isValidRpc(configDraft.rpc))}
                    onClick={() => {
                      const cfg: RuntimeConfig = {};
                      if (configDraft.contract && ethers.isAddress(configDraft.contract)) cfg.contract = configDraft.contract;
                      if (configDraft.rpc && isValidRpc(configDraft.rpc)) cfg.rpc = configDraft.rpc;
                      if (configDraft.chain) cfg.chain = configDraft.chain;
                      saveRuntimeConfig(cfg);
                      notify("Config saved — reloading with live settings…");
                      setTimeout(() => window.location.reload(), 900);
                    }}
                  >Save & reload</button>
                  <button className="btn-ghost" onClick={() => {
                    try { localStorage.removeItem("ptac-config") } catch {}
                    notify("Config cleared — back to build defaults");
                    setTimeout(() => window.location.reload(), 900);
                  }}>Reset to defaults</button>
                </div>
              </div>

              <div className="ad-card wide launch-steps">
                <h4><Target size={15} /> Go-live checklist</h4>
                <ol className="launch-list">
                  <li>
                    <b>Deploy the contract</b>
                    <p>From the repo root, set <code>PRIVATE_KEY</code> in <code>.env</code> (deployer wallet — needs a little TAC for gas), then:</p>
                    <pre>forge script script/DeployV3.s.sol --rpc-url https://rpc.tac.build --broadcast</pre>
                    <p>Copy the deployed address from the output. That wallet becomes the <b>owner</b> — only it sees this admin console.</p>
                  </li>
                  <li>
                    <b>Point the app at the contract</b>
                    <p>Paste the address in the form above and hit <b>Save &amp; reload</b> — the app switches from demo data to live chain instantly. For a permanent build, also set <code>VITE_CONTRACT_ADDRESS</code> in <code>frontend/.env</code> and run <code>bun run build</code>.</p>
                  </li>
                  <li>
                    <b>Verify the connection</b>
                    <p>The DEMO MODE badge disappears, the footer shows the contract address, and the Overview tab reads live paused/fee/solvency values from chain.</p>
                  </li>
                  <li>
                    <b>Hook up Telegram</b>
                    <p>In <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a>: <code>/newapp</code> → pick your bot → set the Web App URL to this site's URL. The app already loads the Telegram SDK, expands full-screen and uses haptics automatically.</p>
                  </li>
                  <li>
                    <b>Seed the first markets</b>
                    <p>Deposit TAC to your vault, then create 3–5 quality markets with clear resolution criteria so the board isn't empty at launch.</p>
                  </li>
                  <li>
                    <b>Operate</b>
                    <p>After each market's deadline, resolve it in <b>Operations</b>. Bettors have a 3-day dispute window; disputed markets come back to you for a final ruling. Withdraw accrued fees whenever.</p>
                  </li>
                </ol>
                <div className="launch-note"><Shield size={13} /> Keys stay in your wallet — this panel never asks for or stores a private key. Config saved here is public info (address, RPC), safe in localStorage.</div>
              </div>
            </div>
          )}

          {adminMode === "ops" && (
            <div className="admin-grid">
              <div className="ad-card">
                <h4><CircleDollarSign size={15} /> Fees</h4>
                <label>Protocol fee (bp ÷ 10, max 50 = 5%)<input type="number" min="0" max="50" value={adminFee} onChange={e => setAdminFee(e.target.value)} /></label>
                <button className="act" onClick={adminSetFee} disabled={busy.afee}>Set fee</button>
                <label>Withdraw fees to (empty = you)<input placeholder="0x…" value={feeRecipient} onChange={e => setFeeRecipient(e.target.value)} /></label>
                <button className="act claim" onClick={adminWithdrawFees} disabled={busy.awd || accFees === 0n}>Withdraw {fmt(accFees)} TAC</button>
              </div>
              <div className="ad-card">
                <h4><Pause size={15} /> Emergency</h4>
                <p className="sub">Pausing blocks new bets, market creation and sells. Claims and withdrawals keep working — users can always exit.</p>
                <button className={`act ${paused ? "claim" : "cancel"}`} onClick={adminPause} disabled={busy.apause}>
                  {paused ? <><Play size={14} /> Unpause protocol</> : <><Pause size={14} /> Pause protocol</>}
                </button>
              </div>
              <div className="ad-card wide">
                <h4><Clock size={15} /> Awaiting Resolution ({awaitingResolution.length})</h4>
                {awaitingResolution.length === 0 && <p className="sub">Nothing to resolve.</p>}
                {awaitingResolution.map(m => (
                  <div key={m.id} className="ad-market">
                    <div><b>#{m.id}</b> {m.question}<div className="sub">Pool {fmt(m.totalYesPool + m.totalNoPool)} TAC · ended {new Date(m.resolutionTime * 1000).toLocaleString()}</div></div>
                    <div className="ad-btns">
                      <button className="b-yes sm" onClick={() => adminResolve(m.id, 1)} disabled={busy[`ares-${m.id}`]}>Resolve YES</button>
                      <button className="b-no sm" onClick={() => adminResolve(m.id, 2)} disabled={busy[`ares-${m.id}`]}>Resolve NO</button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="ad-card wide">
                <h4><Scale size={15} /> Disputes ({disputedMarkets.length})</h4>
                {disputedMarkets.length === 0 && <p className="sub">No open disputes.</p>}
                {disputedMarkets.map(m => (
                  <div key={m.id} className="ad-market">
                    <div><b>#{m.id}</b> {m.question}<div className="sub">Original ruling: {sideLabel(m.winner)}</div></div>
                    <div className="ad-btns">
                      <button className="b-yes sm" onClick={() => adminResolveDispute(m.id, 1)} disabled={busy[`adis-${m.id}`]}>Final: YES</button>
                      <button className="b-no sm" onClick={() => adminResolveDispute(m.id, 2)} disabled={busy[`adis-${m.id}`]}>Final: NO</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      <footer className="footer">
        <span className="f-brand">Prediction<b>Tac</b></span>
        <span className="f-sub">Prediction pools on <a href="https://tac.build" target="_blank" rel="noreferrer">TAC</a> · {NOT_DEPLOYED ? "contract not deployed" : `${CONTRACT_ADDRESS.slice(0, 8)}…`} · fee {protocolFee / 10}% · 3d dispute window · <TrendingUp size={11} /> no house edge</span>
      </footer>

      <nav className="bottom-nav" aria-label="Primary">
        <button type="button" className={view === "home" ? "on" : ""} onClick={() => { setView("home"); tgHaptic("light"); playSound("tap", prefs.sounds); }}>
          <Home size={20} strokeWidth={view === "home" ? 2.4 : 1.8} />
          Home
        </button>
        <button type="button" className={view === "markets" ? "on" : ""} onClick={() => { setView("markets"); tgHaptic("light"); playSound("tap", prefs.sounds); }}>
          <BarChart3 size={20} strokeWidth={view === "markets" ? 2.4 : 1.8} />
          Markets
        </button>
        <button type="button" className={view === "vault" ? "on" : ""} onClick={() => { setView("vault"); tgHaptic("light"); playSound("tap", prefs.sounds); }}>
          <Landmark size={20} strokeWidth={view === "vault" ? 2.4 : 1.8} />
          Vault
        </button>
        <button type="button" className={view === "portfolio" || view === "settings" ? "on" : ""} onClick={() => { setView("portfolio"); tgHaptic("light"); playSound("tap", prefs.sounds); }}>
          <User size={20} strokeWidth={view === "portfolio" || view === "settings" ? 2.4 : 1.8} />
          You
          {claimable.length > 0 && <span className="bn-badge">{claimable.length}</span>}
        </button>
        <button type="button" className={view === "leaderboard" ? "on" : ""} onClick={() => { setView("leaderboard"); tgHaptic("light"); playSound("tap", prefs.sounds); }}>
          <Trophy size={20} strokeWidth={view === "leaderboard" ? 2.4 : 1.8} />
          Rank
        </button>
      </nav>
    </div>
  );
}
