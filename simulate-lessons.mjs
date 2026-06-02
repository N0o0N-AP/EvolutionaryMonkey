/**
 * Monte Carlo simulation matching 演化人类.html evolution rules
 * Run: node simulate-lessons.mjs
 * JSON: node simulate-lessons.mjs --json
 * Embed: node simulate-lessons.mjs --embed-html
 */
import fs from 'fs';

const DETECTIVE_PROBE = ['C', 'D', 'C', 'C'];
const WIN_TABLE = [0.50, 0.60, 0.78, 0.90, 0.96, 0.99, 0.995];
const TRIALS = 2000;
const ROLE_NAMES = {
  cooperator: '合作者', cheater: '骗子', copycat: '复读机', sucker: '冤大头',
  grudger: '记仇者', detective: '侦探', pavlov: '墙头草', generous_copycat: '宽宏者',
  tit_for_two_tats: '宽容两次', conformist: '跟风者', firm_but_fair: '和事佬', prober: '试探者', joker: '混沌'
};

function getWinProbability(diff) {
  const d = Math.abs(diff);
  const clamped = Math.min(d, 6);
  const floor = Math.floor(clamped);
  const ceil = Math.min(floor + 1, 6);
  const fraction = clamped - floor;
  const p = WIN_TABLE[floor] + (WIN_TABLE[ceil] - WIN_TABLE[floor]) * fraction;
  return diff > 0 ? p : 1 - p;
}

function applyPerceptionNoise(history, rate) {
  if (!rate || !history.length) return history;
  return history.map(h => {
    if (Math.random() < rate) return { ...h, oppAction: h.oppAction === 'C' ? 'D' : 'C' };
    return h;
  });
}

function applyActionNoise(action, rate) {
  if (!rate || Math.random() >= rate) return action;
  return action === 'C' ? 'D' : 'C';
}

function payoff(my, opp) {
  if (my === 'C' && opp === 'C') return 2;
  if (my === 'C' && opp === 'D') return -1;
  if (my === 'D' && opp === 'C') return 3;
  return 0;
}

function pairKey(i, j) { return `${i}_${j}`; }

function resolvePositions(spec, N, taken) {
  if (Array.isArray(spec)) return spec;
  if (spec === 'all') return [...Array(N).keys()];
  if (spec === 'even') return [...Array(N).keys()].filter(i => i % 2 === 0);
  if (spec === 'odd') return [...Array(N).keys()].filter(i => i % 2 === 1);
  if (spec === 'remaining') return [...Array(N).keys()].filter(i => !taken.has(i));
  if (spec === 'everyThird') return [...Array(N).keys()].filter(i => i % 3 === 0);
  if (spec === 'everyThirdOffset1') return [...Array(N).keys()].filter(i => i % 3 === 1);
  if (spec === 'everyThirdOffset2') return [...Array(N).keys()].filter(i => i % 3 === 2);
  return [];
}

function buildNodes(lesson) {
  const N = lesson.playerCount;
  const nodes = Array(N).fill(null);
  const taken = new Set();
  for (const block of lesson.preplaced) {
    let posList = resolvePositions(block.positions, N, taken);
    if (Array.isArray(block.positions)) posList = block.positions;
    const use = posList.slice(0, block.count);
    use.forEach(p => { if (p >= 0 && p < N) { nodes[p] = block.role; taken.add(p); } });
  }
  return nodes;
}

function getFitness(scoreHistory) {
  const h = scoreHistory || [];
  if (!h.length) return 1;
  const avg = h.reduce((a, b) => a + b, 0) / h.length;
  return 1 + avg;
}

function seedNewbornScoreHistory(state, emptyIdx, donorIdx) {
  const donorHistory = state.scoreHistory[donorIdx] || [];
  const donorAvg = donorHistory.length
    ? donorHistory.reduce((a, b) => a + b, 0) / donorHistory.length
    : 0;
  state.scoreHistory[emptyIdx] = [Math.max(0, Math.round(donorAvg * 10) / 10)];
}

function decide(role, neighborId, history, round, grudgeCtx, playerIndex) {
  const key = pairKey(playerIndex, neighborId);
  switch (role) {
    case 'cooperator':
    case 'sucker':
      return 'C';
    case 'cheater':
      return 'D';
    case 'copycat':
      return history.length === 0 ? 'C' : history[history.length - 1].oppAction;
    case 'grudger':
      if (history.length === 0) return 'C';
      if (history.some(h => h.oppAction === 'D')) return 'D';
      return 'C';
    case 'detective':
      if (history.length < 4) return DETECTIVE_PROBE[history.length];
      if (history.slice(0, 4).some(h => h.oppAction === 'D'))
        return history.length ? history[history.length - 1].oppAction : 'C';
      return 'D';
    case 'pavlov':
      if (history.length === 0) return 'C';
      const last = history[history.length - 1];
      if (last.myScore >= 2) return last.myAction;
      return last.myAction === 'C' ? 'D' : 'C';
    case 'generous_copycat':
      if (history.length === 0) return 'C';
      const lo = history[history.length - 1].oppAction;
      if (lo === 'C') return 'C';
      return Math.random() < 0.1 ? 'C' : 'D';
    case 'tit_for_two_tats':
      if (history.length === 0) return 'C';
      if (history.length >= 2) {
        const a = history[history.length - 2].oppAction;
        const b = history[history.length - 1].oppAction;
        if (a === 'D' && b === 'D') return 'D';
      }
      return 'C';
    case 'forgiving': {
      if (history.length === 0) return 'C';
      const last = history[history.length - 1];
      if (last.oppAction === 'C') return 'C';
      if (history.length >= 2) {
        const prev = history[history.length - 2];
        if (prev.oppAction === 'D') return 'D';
      }
      return 'C';
    }
    case 'firm_but_fair': {
      let g = grudgeCtx.get(key) || 0;
      if (g > 0) { grudgeCtx.set(key, g - 1); return 'D'; }
      if (history.length === 0) return 'C';
      const l = history[history.length - 1];
      if (l.oppAction === 'D') { grudgeCtx.set(key, 1); return 'D'; }
      return 'C';
    }
    case 'prober':
      if (history.length === 0) return 'D';
      if (history.length >= 2) {
        if (history[0].oppAction === 'C' && history[1].oppAction === 'C') return 'D';
        if (history[1].oppAction === 'D') return history[history.length - 1].oppAction;
      }
      return 'D';
    case 'joker':
      return Math.random() < 0.5 ? 'C' : 'D';
    default:
      return 'C';
  }
}

function conformistAction(i, state, pNoise) {
  if (state.round === 0) return 'C';
  const L = (i - 1 + state.N) % state.N;
  const R = (i + 1) % state.N;
  const hL = applyPerceptionNoise(state.histories.get(pairKey(i, L)) || [], pNoise);
  const hR = applyPerceptionNoise(state.histories.get(pairKey(i, R)) || [], pNoise);
  const lastL = hL.length ? hL[hL.length - 1].oppAction : 'C';
  const lastR = hR.length ? hR[hR.length - 1].oppAction : 'C';
  let d = 0, c = 0;
  if (lastL === 'D') d++; else c++;
  if (lastR === 'D') d++; else c++;
  return d >= c ? 'D' : 'C';
}

function findNearestAlive(emptyIdx, goLeft, state, victims) {
  let idx = goLeft ? (emptyIdx - 1 + state.N) % state.N : (emptyIdx + 1) % state.N;
  for (let step = 0; step < state.N - 1; step++) {
    if (!victims.has(idx) && state.nodes[idx]) return idx;
    idx = goLeft ? (idx - 1 + state.N) % state.N : (idx + 1) % state.N;
    if (idx === emptyIdx) break;
  }
  return null;
}

function competeForEmpty(emptyIdx, state, victims) {
  const left = findNearestAlive(emptyIdx, true, state, victims);
  const right = findNearestAlive(emptyIdx, false, state, victims);
  if (!left && !right) return null;
  if (left && !right) return left;
  if (right && !left) return right;
  const diff = getFitness(state.scoreHistory[left]) - getFitness(state.scoreHistory[right]);
  return Math.random() < getWinProbability(diff) ? left : right;
}

function monoculture(nodes) {
  const filled = nodes.filter(n => n);
  if (!filled.length) return null;
  const s = new Set(filled);
  return s.size === 1 ? [...s][0] : null;
}

function runLessonOnce(lesson) {
  const N = lesson.playerCount;
  const state = {
    N,
    nodes: buildNodes(lesson),
    round: 0,
    histories: new Map(),
    grudgeMap: new Map(),
    scoreHistory: Array.from({ length: N }, () => []),
    cumulativeScores: Array(N).fill(0)
  };
  const immortal = new Set(lesson.immortalIndices || []);
  const aNoise = lesson.actionNoise || 0;
  const pNoise = lesson.perceptionNoise || 0;

  while (state.round < lesson.targetRounds) {
    const actions = Array.from({ length: N }, () => ({}));
    const grudgeCtx = new Map(state.grudgeMap);

    for (let i = 0; i < N; i++) {
      if (!state.nodes[i]) continue;
      const role = state.nodes[i];
      if (role === 'conformist') {
        let act = conformistAction(i, state, pNoise);
        act = applyActionNoise(act, aNoise);
        actions[i][(i - 1 + N) % N] = act;
        actions[i][(i + 1) % N] = act;
        continue;
      }
      for (const j of [(i - 1 + N) % N, (i + 1) % N]) {
        if (!state.nodes[j]) continue;
        const raw = state.histories.get(pairKey(i, j)) || [];
        const hist = applyPerceptionNoise(raw, pNoise);
        let act = decide(role, j, hist, state.round, grudgeCtx, i);
        act = applyActionNoise(act, aNoise);
        actions[i][j] = act;
      }
    }
    state.grudgeMap = grudgeCtx;

    const scores = Array(N).fill(0);
    for (let i = 0; i < N; i++) {
      if (!state.nodes[i]) continue;
      for (const j of [(i - 1 + N) % N, (i + 1) % N]) {
        if (!state.nodes[j]) continue;
        const my = actions[i][j];
        const opp = actions[j][i];
        if (my === undefined || opp === undefined) continue;
        scores[i] += payoff(my, opp);
      }
    }

    for (let i = 0; i < N; i++) {
      if (state.nodes[i]) {
        state.cumulativeScores[i] += scores[i];
        state.scoreHistory[i].push(scores[i]);
        if (state.scoreHistory[i].length > 5) state.scoreHistory[i].shift();
      }
    }

    const deathCount = Math.max(1, Math.floor(N / 6));
    const candidates = [...Array(N).keys()].filter(i => state.nodes[i] && !immortal.has(i));
    const actual = candidates.length ? Math.min(deathCount, candidates.length) : 0;
    const pool = candidates.slice();
    const victims = new Set();
    for (let d = 0; d < actual; d++) {
      const idx = Math.floor(Math.random() * pool.length);
      victims.add(pool.splice(idx, 1)[0]);
    }
    for (const idx of victims) {
      state.nodes[idx] = null;
      state.scoreHistory[idx] = [];
    }

    for (let i = 0; i < N; i++) {
      if (state.nodes[i] !== null) continue;
      const donor = competeForEmpty(i, state, victims);
      if (donor != null) {
        state.nodes[i] = state.nodes[donor];
        seedNewbornScoreHistory(state, i, donor);
      }
    }

    for (let i = 0; i < N; i++) {
      if (!state.nodes[i]) continue;
      for (const j of [(i - 1 + N) % N, (i + 1) % N]) {
        if (!state.nodes[j]) continue;
        const my = actions[i][j];
        const opp = actions[j][i];
        if (my === undefined) continue;
        const key = pairKey(i, j);
        const arr = (state.histories.get(key) || []).slice();
        arr.push({ round: state.round, myAction: my, oppAction: opp, myScore: payoff(my, opp) });
        state.histories.set(key, arr);
      }
    }

    state.round++;
    if (monoculture(state.nodes)) break;
  }

  const counts = {};
  for (const n of state.nodes) {
    if (n) counts[n] = (counts[n] || 0) + 1;
  }
  let dominant = null;
  let max = 0;
  for (const [r, c] of Object.entries(counts)) {
    if (c > max) { max = c; dominant = r; }
  }
  const tied = Object.entries(counts).filter(([, c]) => c === max).map(([r]) => r);

  let cc = 0, total = 0;
  if (state.round > 0) {
    for (const [, arr] of state.histories) {
      const last = arr.filter(h => h.round === state.round - 1);
      if (!last.length) continue;
      const h = last[last.length - 1];
      total++;
      if (h.myAction === 'C' && h.oppAction === 'C') cc++;
    }
  }
  const coopRate = total ? cc / total : 0;

  let defect = 0, interact = 0;
  if (state.round > 0) {
    for (const [, arr] of state.histories) {
      for (const h of arr.filter(x => x.round === state.round - 1)) {
        interact++;
        if (h.myAction === 'D' || h.oppAction === 'D') defect++;
      }
    }
  }
  const defectRate = interact ? defect / interact : 0;

  return { counts, dominant, tied, max, N, mono: monoculture(state.nodes), coopRate, defectRate, round: state.round };
}

const lessons = [
  { id:1, playerCount:4, targetRounds:20, immortalIndices:[3], actionNoise:0, perceptionNoise:0,
    preplaced:[{role:'cooperator',count:3,positions:[0,1,2]},{role:'cheater',count:1,positions:[3]}],
    options:[{id:'A',label:'老好人'},{id:'B',label:'投机者'},{id:'C',label:'一样多'}] },
  { id:2, playerCount:6, targetRounds:25, immortalIndices:[], actionNoise:0, perceptionNoise:0,
    preplaced:[{role:'copycat',count:4,positions:[0,2,3,5]},{role:'cheater',count:2,positions:[1,4]}],
    options:[{id:'A',label:'复仇者'},{id:'B',label:'逃兵'},{id:'C',label:'两败俱伤'}] },
  { id:3, playerCount:8, targetRounds:30, immortalIndices:[7], actionNoise:0, perceptionNoise:0,
    preplaced:[{role:'cooperator',count:7,positions:[0,1,2,3,4,5,6]},{role:'cheater',count:1,positions:[7]}],
    options:[{id:'A',label:'圣人'},{id:'B',label:'病毒'},{id:'C',label:'奇迹般维持'}] },
  { id:4, playerCount:8, targetRounds:38, immortalIndices:[], actionNoise:0, perceptionNoise:0,
    preplaced:[{role:'copycat',count:5,positions:[0,1,2,4,5]},{role:'cooperator',count:2,positions:[6,7]},{role:'cheater',count:1,positions:[3]}],
    options:[{id:'A',label:'警卫'},{id:'B',label:'间谍'},{id:'C',label:'平民'}] },
  { id:5, playerCount:8, targetRounds:38, immortalIndices:[], actionNoise:0, perceptionNoise:0,
    preplaced:[{role:'sucker',count:4,positions:'even'},{role:'cheater',count:4,positions:'odd'}],
    options:[{id:'A',label:'冤大头'},{id:'B',label:'强盗'},{id:'C',label:'互相制衡'}] },
  { id:6, playerCount:12, targetRounds:50, immortalIndices:[], actionNoise:0, perceptionNoise:0,
    preplaced:[{role:'copycat',count:8,positions:[0,1,2,3,4,5,10,11]},{role:'cheater',count:4,positions:[6,7,8,9]}],
    options:[{id:'A',label:'镜子人'},{id:'B',label:'沙匪'},{id:'C',label:'同归于尽'}] },
  { id:7, playerCount:10, targetRounds:30, immortalIndices:[], actionNoise:0.05, perceptionNoise:0,
    preplaced:[{role:'copycat',count:5,positions:[0,2,4,6,8]},{role:'forgiving',count:5,positions:[1,3,5,7,9]}],
    options:[{id:'A',label:'镜子人'},{id:'B',label:'缓冲者'},{id:'C',label:'同归于尽'}] },
  { id:8, playerCount:10, targetRounds:38, immortalIndices:[], actionNoise:0.05, perceptionNoise:0,
    preplaced:[{role:'copycat',count:10,positions:'all'}],
    options:[{id:'A',label:'继续合作'},{id:'B',label:'仇恨螺旋'},{id:'C',label:'一半一半'}] },
  { id:9, playerCount:10, targetRounds:38, immortalIndices:[], actionNoise:0.05, perceptionNoise:0.05,
    preplaced:[{role:'copycat',count:7,positions:[0,1,2,3,4,5,6]},{role:'generous_copycat',count:3,positions:[7,8,9]}],
    options:[{id:'A',label:'镜子人'},{id:'B',label:'宽宏者'},{id:'C',label:'谁也阻止不了'}] },
  { id:10, playerCount:12, targetRounds:50, immortalIndices:[], actionNoise:0, perceptionNoise:0,
    preplaced:[{role:'detective',count:4,positions:[0,3,6,9]},{role:'cooperator',count:4,positions:[1,4,7,10]},{role:'cheater',count:4,positions:[2,5,8,11]}],
    options:[{id:'A',label:'侦探'},{id:'B',label:'老实人'},{id:'C',label:'惯犯'}] },
  { id:11, playerCount:12, targetRounds:50, immortalIndices:[], actionNoise:0, perceptionNoise:0,
    preplaced:[{role:'pavlov',count:4,positions:[0,3,6,9]},{role:'copycat',count:4,positions:[1,4,7,10]},{role:'cheater',count:4,positions:[2,5,8,11]}],
    options:[{id:'A',label:'变色龙'},{id:'B',label:'镜子鸟'},{id:'C',label:'毒蛇'}] },
  { id:12, playerCount:12, targetRounds:38, immortalIndices:[], actionNoise:0, perceptionNoise:0,
    preplaced:[{role:'prober',count:3,positions:[0,4,8]},{role:'sucker',count:9,positions:'remaining'}],
    options:[{id:'A',label:'被感化'},{id:'B',label:'猎手统治'},{id:'C',label:'同归于尽'}] },
  { id:13, playerCount:24, targetRounds:25, immortalIndices:[0], actionNoise:0, perceptionNoise:0,
    preplaced:[{role:'cheater',count:1,positions:[0]},{role:'conformist',count:23,positions:'remaining'}],
    options:[{id:'A',label:'合作互助'},{id:'B',label:'背叛蔓延'},{id:'C',label:'保持混乱'}] },
  { id:14, playerCount:24, targetRounds:38, immortalIndices:[], actionNoise:0, perceptionNoise:0,
    preplaced:[{role:'grudger',count:8,positions:'everyThird'},{role:'cheater',count:8,positions:'everyThirdOffset1'},{role:'firm_but_fair',count:8,positions:'everyThirdOffset2'}],
    options:[{id:'A',label:'调解成功'},{id:'B',label:'调解失败'},{id:'C',label:'三方混战'}] },
  { id:15, playerCount:36, targetRounds:50, immortalIndices:[], actionNoise:0, perceptionNoise:0,
    preplaced:[{role:'copycat',count:12,positions:'everyThird'},{role:'cheater',count:12,positions:'everyThirdOffset1'},{role:'detective',count:12,positions:'everyThirdOffset2'}],
    options:[{id:'A',label:'互惠派'},{id:'B',label:'背叛派'},{id:'C',label:'信息派'}] },
];

function pickWinner(lesson, result) {
  const { counts, dominant, tied, N, coopRate } = result;
  const c = counts;
  if (lesson.id === 5) {
    const s = c.sucker || 0, ch = c.cheater || 0;
    if (Math.abs(s - ch) <= 1) return 'C';
    return s > ch ? 'A' : 'B';
  }
  if (lesson.id === 7) {
    if (dominant === 'forgiving') return 'B';
    if (dominant === 'copycat') return 'A';
    const f = c.forgiving || 0, cp = c.copycat || 0;
    return f >= cp ? 'B' : 'A';
  }
  if (lesson.id === 8) {
    if (dominant === 'copycat') return 'B';
    if (coopRate > 0.55) return 'A';
    return 'C';
  }
  if (lesson.id === 13) {
    const conf = c.conformist || 0;
    if (conf >= N * 0.85 && coopRate < 0.2) return 'B';
    if (coopRate > 0.5) return 'A';
    return 'C';
  }
  if (lesson.id === 14) {
    const f = c.firm_but_fair || 0;
    const g = c.grudger || 0;
    const ch = c.cheater || 0;
    const top = Math.max(f, g, ch);
    const leaders = [f, g, ch].filter(x => x === top).length;
    if (leaders >= 2 || (top <= 9 && Math.abs(f - g) <= 2 && Math.abs(g - ch) <= 2)) return 'C';
    if (f > g && f > ch && f >= 8) return 'A';
    if (f < 6 && (g > f || ch > f)) return 'B';
    return 'C';
  }
  if (lesson.id === 15) {
    const entries = Object.entries(c).sort((a, b) => b[1] - a[1]);
    if (entries.length < 2) return 'A';
    const spread = entries[0][1] - entries[1][1];
    if (spread <= 3) return 'tie14';
    const role = entries[0][0];
    if (role === 'copycat') return 'A';
    if (role === 'cheater') return 'B';
    return 'C';
  }
  if (lesson.id === 10) {
    if (dominant === 'cheater') return 'C';
    if (dominant === 'detective') return 'A';
    if (dominant === 'cooperator') return 'B';
    const top = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
    if (top && top[0] === 'cheater') return 'C';
    if (top && top[0] === 'detective') return 'A';
    return 'B';
  }
  if (lesson.id === 11) {
    if (dominant === 'cheater') return 'C';
    if (dominant === 'copycat') return 'B';
    if (dominant === 'pavlov') return 'A';
    return 'C';
  }
  if (lesson.id === 12) {
    const p = c.prober || 0;
    if (p >= 3) return 'B';
    return 'A';
  }
  const roleToOpt = {
    cooperator: 'A', cheater: 'B', copycat: 'A', sucker: 'A', generous_copycat: 'B',
    forgiving: 'B', detective: 'A', pavlov: 'A', conformist: 'B', firm_but_fair: 'A', prober: 'B'
  };
  if (lesson.id === 4 && dominant === 'cooperator') return 'C';
  if (tied.length > 1) return 'C';
  return roleToOpt[dominant] || 'C';
}

function simulateLesson(lesson) {
  const wins = {};
  const domCounts = {};
  let monoEarly = 0;
  let coopSum = 0, defectSum = 0;
  const roleEnd = {};
  for (let t = 0; t < TRIALS; t++) {
    const r = runLessonOnce(lesson);
    const w = pickWinner(lesson, r);
    wins[w] = (wins[w] || 0) + 1;
    domCounts[r.dominant] = (domCounts[r.dominant] || 0) + 1;
    coopSum += r.coopRate;
    defectSum += r.defectRate;
    if (r.mono && r.round < lesson.targetRounds) monoEarly++;
    for (const [role, cnt] of Object.entries(r.counts)) {
      roleEnd[role] = (roleEnd[role] || 0) + cnt;
    }
  }
  const optionPct = {};
  for (const o of lesson.options) {
    const key = o.id;
    const n = wins[key] || (key === 'A' && wins.tie14 ? 0 : 0);
    optionPct[key] = Math.round(((wins[key] || 0) / TRIALS) * 1000) / 10;
  }
  if (lesson.id === 15) {
    optionPct.A = Math.round(((wins.A || 0) / TRIALS) * 1000) / 10;
    optionPct.B = Math.round(((wins.B || 0) / TRIALS) * 1000) / 10;
    optionPct.C = Math.round(((wins.C || 0) / TRIALS) * 1000) / 10;
    optionPct.tie = Math.round(((wins.tie14 || 0) / TRIALS) * 1000) / 10;
  }
  const dominantPct = {};
  const totalDom = Object.values(domCounts).reduce((a, b) => a + b, 0) || 1;
  for (const [role, n] of Object.entries(domCounts).sort((a, b) => b[1] - a[1])) {
    dominantPct[role] = Math.round((n / totalDom) * 1000) / 10;
  }
  const avgShare = {};
  const slots = TRIALS * lesson.playerCount;
  for (const [role, sum] of Object.entries(roleEnd).sort((a, b) => b[1] - a[1])) {
    avgShare[role] = Math.round((sum / slots) * 1000) / 10;
  }
  return {
    trials: TRIALS,
    optionPct,
    dominantPct,
    avgShare,
    monoEarlyPct: Math.round((monoEarly / TRIALS) * 1000) / 10,
    avgCoopInteractPct: Math.round((coopSum / TRIALS) * 1000) / 10,
    avgDefectInteractPct: Math.round((defectSum / TRIALS) * 1000) / 10
  };
}

const allStats = {};
for (const lesson of lessons) {
  allStats[lesson.id] = simulateLesson(lesson);
  if (!process.argv.includes('--json')) {
    const s = allStats[lesson.id];
    console.log(`\nLesson ${lesson.id}:`, JSON.stringify(s));
  }
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(allStats, null, 2));
}

if (process.argv.includes('--embed-html')) {
  const htmlPath = 'e:/AAA/Gamemakebyme/EvolutionaryMonkey/演化人类.html';
  const statsLine = JSON.stringify(allStats);
  let html = fs.readFileSync(htmlPath, 'utf8');
  const startMarker = '/** 2000 次蒙特卡洛';
  const endMarker = 'const SIM_ROLE_LABELS';
  const startIdx = html.indexOf(startMarker);
  const endIdx = html.indexOf(endMarker);
  if (startIdx < 0 || endIdx < 0) throw new Error('markers not found');
  const replacement =
    '/** 2000 次蒙特卡洛，规则与游戏一致（死亡 1/6、近5轮权重、激进繁殖胜率、新生儿均分继承）。由 simulate-lessons.mjs 生成 */\n' +
    `const LESSON_SIM_STATS = ${statsLine};\n\n`;
  html = html.slice(0, startIdx) + replacement + html.slice(endIdx);
  fs.writeFileSync(htmlPath, html, 'utf8');
  console.log('embedded', statsLine.length, 'chars');
}
