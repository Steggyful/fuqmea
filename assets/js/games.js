// FuqMeA mini-games — fun tokens only (localStorage). Not synced or secured.

(function () {
  'use strict';

  const STORAGE_KEY = 'fuqmea_fun_wallet_v1';
  const HISTORY_KEY = 'fuqmea_fun_history_v1';
  const DEFAULT_TOKENS = 100;
  const DAILY_BONUS = 25;
  const MAX_COIN_STREAK_BONUS = 5;
  const MAX_HISTORY = 35;
  const BET_CHOICES = [5, 10, 25];
  const SLOT_SYMBOLS = [
    { id: 'ecat', label: 'E CAT', emoji: '🐱', image: 'assets/images/slots/e Cat - Floride.JPG' },
    { id: 'butt', label: 'BUTT', emoji: '🍑', image: 'assets/images/slots/Emoji - Butt.PNG' },
    { id: 'periot', label: 'PERIOT', emoji: '😮', image: 'assets/images/slots/Emoji - Periot.JPG' },
    { id: 'toes', label: 'TOES', emoji: '🦶', image: 'assets/images/slots/Toes.JPG' },
    { id: 'bonk', label: 'BONK', emoji: '💥', image: 'assets/images/slots/Bonk.png' },
    { id: 'shronk', label: 'SHRONK', emoji: '🗿', image: 'assets/images/slots/Shronk.jpg' },
    { id: 'twin', label: 'TWIN', emoji: '👯', image: 'assets/images/slots/Twin.JPG' }
  ];

  const GAME_LABEL = { coin: 'COIN', rps: 'RPS', slots: 'SLOTS', bj: 'BJ', daily: 'DAILY', reset: 'RESET' };

  const BJ_RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
  const BJ_SUITS = ['\u2660', '\u2665', '\u2666', '\u2663'];

  const bjState = {
    deck: [],
    playerHands: [],
    handStakes: [],
    handDoubled: [],
    dealer: [],
    phase: 'idle',
    baseBet: 0,
    activeHand: 0,
    splitAces: false,
    holeHidden: false,
    roundStartBalance: 0
  };

  function bjNewDeck() {
    const d = [];
    for (let ri = 0; ri < BJ_RANKS.length; ri++) {
      for (let si = 0; si < BJ_SUITS.length; si++) {
        d.push({ r: BJ_RANKS[ri], s: BJ_SUITS[si] });
      }
    }
    return d;
  }

  function bjShuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  function bjHandValue(cards) {
    let t = 0;
    let nA = 0;
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      if (c.r === 'A') nA++;
      else if ('TJQK'.includes(c.r)) t += 10;
      else t += Number(c.r);
    }
    for (let k = 0; k < nA; k++) {
      if (t + 11 <= 21) t += 11;
      else t += 1;
    }
    return t;
  }

  function bjIsSoftHand(cards) {
    if (!cards.some((c) => c.r === 'A')) return false;
    let low = 0;
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      if (c.r === 'A') low += 1;
      else if ('TJQK'.includes(c.r)) low += 10;
      else low += Number(c.r);
    }
    return low + 10 <= 21;
  }

  function bjIsSoft17(cards) {
    return bjHandValue(cards) === 17 && bjIsSoftHand(cards);
  }

  function bjDealerShouldHit(hand) {
    const v = bjHandValue(hand);
    if (v < 17) return true;
    if (v > 17) return false;
    return bjIsSoft17(hand);
  }

  function bjIsNaturalBj(cards) {
    return cards.length === 2 && bjHandValue(cards) === 21;
  }

  function bjDraw() {
    let c = bjState.deck.pop();
    if (!c) {
      bjState.deck = bjShuffle(bjNewDeck());
      c = bjState.deck.pop();
    }
    return c;
  }

  function bjCardEl(card, hidden) {
    const wrap = document.createElement('div');
    if (hidden) {
      wrap.className = 'games-bj-card games-bj-card--back';
      wrap.textContent = 'FUQ';
      wrap.setAttribute('aria-hidden', 'true');
      return wrap;
    }
    const red = card.s === '\u2665' || card.s === '\u2666';
    wrap.className = 'games-bj-card' + (red ? ' games-bj-card--red' : '');
    const rank = card.r === 'T' ? '10' : card.r;
    const top = document.createElement('span');
    top.textContent = rank;
    const suit = document.createElement('span');
    suit.setAttribute('aria-hidden', 'true');
    suit.textContent = card.s;
    wrap.appendChild(top);
    wrap.appendChild(suit);
    return wrap;
  }

  function bjRenderHands() {
    const dEl = document.getElementById('bj-dealer-cards');
    const zone = document.getElementById('bj-player-hands');
    const dScore = document.getElementById('bj-dealer-score');
    if (!dEl || !zone) return;

    dEl.innerHTML = '';
    zone.innerHTML = '';

    const dh = bjState.holeHidden && bjState.dealer.length >= 2;
    bjState.dealer.forEach((c, i) => {
      dEl.appendChild(bjCardEl(c, dh && i === 1));
    });

    const multi = bjState.playerHands.length > 1;
    bjState.playerHands.forEach((hand, i) => {
      const row = document.createElement('div');
      const active =
        bjState.phase === 'player' && i === bjState.activeHand && bjState.playerHands.length > 0;
      row.className = 'games-bj-split-hand' + (active ? ' games-bj-split-hand--active' : '');
      const head = document.createElement('div');
      head.className = 'games-bj-split-hand-head';
      const lab = document.createElement('span');
      lab.className = 'games-bj-split-hand-label';
      lab.textContent = multi ? `Hand ${i + 1}` : 'Your cards';
      const sc = document.createElement('span');
      sc.className = 'games-bj-hand-score';
      sc.textContent = hand.length ? String(bjHandValue(hand)) : '—';
      head.appendChild(lab);
      head.appendChild(sc);
      const cards = document.createElement('div');
      cards.className = 'games-bj-cards';
      for (let j = 0; j < hand.length; j++) {
        cards.appendChild(bjCardEl(hand[j], false));
      }
      row.appendChild(head);
      row.appendChild(cards);
      zone.appendChild(row);
    });

    if (dScore) {
      if (!bjState.dealer.length) {
        dScore.textContent = '—';
      } else if (dh) {
        const up = [bjState.dealer[0]];
        dScore.textContent = `${bjHandValue(up)} / ?`;
      } else {
        dScore.textContent = String(bjHandValue(bjState.dealer));
      }
    }
  }

  function bjSetBetDisabled(disabled) {
    document.querySelectorAll('input[name="bj-bet"]').forEach((inp) => {
      inp.disabled = disabled;
      const lab = inp.closest('label');
      if (lab) lab.style.pointerEvents = disabled ? 'none' : '';
      if (lab) lab.style.opacity = disabled ? '0.55' : '';
    });
  }

  function bjConcealPlayRow(row) {
    if (!row) return;
    row.hidden = true;
    row.classList.add('games-bj-play-row--concealed');
    row.setAttribute('aria-hidden', 'true');
  }

  function bjRevealPlayRow(row) {
    if (!row) return;
    row.hidden = false;
    row.classList.remove('games-bj-play-row--concealed');
    row.removeAttribute('aria-hidden');
  }

  function bjUiIdle() {
    const deal = document.getElementById('bj-deal-btn');
    const row = document.getElementById('bj-play-buttons');
    if (deal) {
      deal.hidden = false;
      deal.classList.remove('games-bj-deal-hidden');
    }
    bjConcealPlayRow(row);
    bjSetBetDisabled(false);
  }

  function bjUiPlayerTurn() {
    const deal = document.getElementById('bj-deal-btn');
    const row = document.getElementById('bj-play-buttons');
    if (deal) {
      deal.hidden = true;
      deal.classList.add('games-bj-deal-hidden');
    }
    bjRevealPlayRow(row);
    bjSetBetDisabled(true);
    const w = loadWallet();
    const ah = bjState.activeHand;
    const h = bjState.playerHands[ah];
    const dbl = document.getElementById('bj-double-btn');
    if (dbl) {
      const ok =
        bjState.phase === 'player' &&
        h &&
        h.length === 2 &&
        !bjState.handDoubled[ah] &&
        !bjState.splitAces &&
        w.tokens >= bjState.handStakes[ah];
      dbl.disabled = !ok;
    }
    const spl = document.getElementById('bj-split-btn');
    if (spl) {
      const h0 = bjState.playerHands[0];
      const canSplit =
        bjState.phase === 'player' &&
        bjState.playerHands.length === 1 &&
        h0 &&
        h0.length === 2 &&
        h0[0].r === h0[1].r &&
        w.tokens >= bjState.baseBet &&
        !bjState.handDoubled[0];
      spl.disabled = !canSplit;
    }
    const hit = document.getElementById('bj-hit-btn');
    if (hit) {
      hit.disabled = !h || bjHandValue(h) >= 21;
    }
  }

  function bjUiDealerTurn() {
    const row = document.getElementById('bj-play-buttons');
    bjConcealPlayRow(row);
    const deal = document.getElementById('bj-deal-btn');
    if (deal) {
      deal.hidden = true;
      deal.classList.add('games-bj-deal-hidden');
    }
    const spl = document.getElementById('bj-split-btn');
    if (spl) spl.disabled = true;
  }

  function bjFinishRound(detail, mood, sub) {
    const w = loadWallet();
    saveWallet(w);
    renderWallet(w);
    const delta = w.tokens - bjState.roundStartBalance;
    pushHistory('bj', detail, delta, w.tokens);
    setGameOutcome('bj', mood, sub);
    bjState.phase = 'done';
    bjState.holeHidden = false;
    bjRenderHands();
    bjUiIdle();
  }

  function bjSettleRoundVsDealer() {
    const w = loadWallet();
    const dv = bjHandValue(bjState.dealer);
    const dealerBust = dv > 21;
    const parts = [];

    for (let i = 0; i < bjState.playerHands.length; i++) {
      const h = bjState.playerHands[i];
      const stake = bjState.handStakes[i];
      const pv = bjHandValue(h);
      if (pv > 21) {
        parts.push(`H${i + 1} bust`);
        continue;
      }
      if (dealerBust) {
        w.tokens += 2 * stake;
        parts.push(`H${i + 1} win (${pv})`);
      } else if (pv > dv) {
        w.tokens += 2 * stake;
        parts.push(`H${i + 1} ${pv}>${dv}`);
      } else if (pv < dv) {
        parts.push(`H${i + 1} lose`);
      } else {
        w.tokens += stake;
        parts.push(`H${i + 1} push`);
      }
    }
    saveWallet(w);

    const net = w.tokens - bjState.roundStartBalance;
    let mood = 'tie';
    if (net > 0) mood = 'win';
    else if (net < 0) mood = 'lose';
    const sub =
      net > 0
        ? `Net +${net} FUQ. Dealer ${dv}${dealerBust ? ' busts' : ''}.`
        : net < 0
          ? `Net ${net} FUQ. Dealer ${dv}.`
          : `Net even. Dealer ${dv}.`;
    bjFinishRound(parts.join(' · '), mood, sub);
  }

  function bjStartDealerPhase() {
    bjState.phase = 'dealer';
    bjState.holeHidden = false;
    bjRenderHands();
    bjUiDealerTurn();

    const allBust = bjState.playerHands.every((h) => bjHandValue(h) > 21);
    if (allBust) {
      bjFinishRound(
        bjState.playerHands.map((h, i) => `H${i + 1} bust`).join(' · ') + ' · dealer shows',
        'lose',
        'All hands bust.'
      );
      return;
    }

    while (bjDealerShouldHit(bjState.dealer)) {
      bjState.dealer.push(bjDraw());
    }
    bjRenderHands();
    bjSettleRoundVsDealer();
  }

  function bjFinishCurrentHandAndAdvance() {
    if (bjState.activeHand < bjState.playerHands.length - 1) {
      bjState.activeHand += 1;
      const h = bjState.playerHands[bjState.activeHand];
      if (h.length === 1) {
        h.push(bjDraw());
        bjRenderHands();
        const v = bjHandValue(h);
        if (v > 21 || v === 21) {
          bjFinishCurrentHandAndAdvance();
          return;
        }
      }
      bjState.phase = 'player';
      bjRenderHands();
      bjUiPlayerTurn();
      const nh = bjState.activeHand + 1;
      setGameOutcome(
        'bj',
        'pending',
        bjState.playerHands.length > 1 ? `Hand ${nh} — hit, stand, or double.` : 'Hit, stand, or double?'
      );
      return;
    }
    bjStartDealerPhase();
  }

  function bjDeal() {
    if (bjState.phase !== 'idle' && bjState.phase !== 'done') return;

    const bet = getBetAmount('bj-bet');
    const w = loadWallet();
    if (w.tokens < bet) {
      setGameOutcome('bj', 'pending', 'Need more FUQ coins for that bet.');
      return;
    }

    bjState.roundStartBalance = w.tokens;
    w.tokens -= bet;
    saveWallet(w);
    renderWallet(w);

    bjState.baseBet = bet;
    bjState.splitAces = false;
    bjState.activeHand = 0;
    bjState.deck = bjShuffle(bjNewDeck());
    bjState.playerHands = [[bjDraw(), bjDraw()]];
    bjState.handStakes = [bet];
    bjState.handDoubled = [false];
    bjState.dealer = [bjDraw(), bjDraw()];
    bjState.phase = 'player';
    bjState.holeHidden = true;

    const h0 = bjState.playerHands[0];
    const pBJ = bjState.playerHands.length === 1 && bjIsNaturalBj(h0);
    const dBJ = bjIsNaturalBj(bjState.dealer);

    if (pBJ || dBJ) {
      bjState.holeHidden = false;
      bjRenderHands();
      bjUiDealerTurn();

      if (pBJ && dBJ) {
        w.tokens += bet;
        saveWallet(w);
        bjFinishRound('Blackjack push', 'tie', 'Both have blackjack. Push.');
        return;
      }
      if (pBJ) {
        const pay = Math.floor((bet * 5) / 2);
        const net = pay - bet;
        w.tokens += pay;
        saveWallet(w);
        bjFinishRound('Player blackjack 3:2', 'jackpot', `Blackjack pays 3:2. Net +${net} FUQ.`);
        return;
      }
      bjFinishRound('Dealer blackjack', 'lose', 'Dealer has blackjack.');
      return;
    }

    bjRenderHands();
    bjUiPlayerTurn();
    setGameOutcome('bj', 'pending', 'Hit, stand, double, or split a pair.');
  }

  function bjHit() {
    if (bjState.phase !== 'player') return;
    const h = bjState.playerHands[bjState.activeHand];
    h.push(bjDraw());
    bjRenderHands();

    if (bjHandValue(h) > 21) {
      bjFinishCurrentHandAndAdvance();
    } else {
      bjUiPlayerTurn();
    }
  }

  function bjStand() {
    if (bjState.phase !== 'player') return;
    bjFinishCurrentHandAndAdvance();
  }

  function bjDouble() {
    if (bjState.phase !== 'player') return;
    if (bjState.splitAces) return;
    const ah = bjState.activeHand;
    const h = bjState.playerHands[ah];
    if (!h || h.length !== 2 || bjState.handDoubled[ah]) return;

    const w = loadWallet();
    const extra = bjState.handStakes[ah];
    if (w.tokens < extra) {
      setGameOutcome('bj', 'pending', 'Not enough coins to double.');
      return;
    }

    w.tokens -= extra;
    bjState.handStakes[ah] = extra * 2;
    bjState.handDoubled[ah] = true;
    saveWallet(w);
    renderWallet(w);

    h.push(bjDraw());
    bjRenderHands();

    if (bjHandValue(h) > 21) {
      bjFinishCurrentHandAndAdvance();
      return;
    }
    bjFinishCurrentHandAndAdvance();
  }

  function bjSplit() {
    if (bjState.phase !== 'player') return;
    if (bjState.playerHands.length !== 1) return;
    const h0 = bjState.playerHands[0];
    if (!h0 || h0.length !== 2 || h0[0].r !== h0[1].r) return;

    const w = loadWallet();
    if (w.tokens < bjState.baseBet) {
      setGameOutcome('bj', 'pending', 'Not enough coins to split.');
      return;
    }

    w.tokens -= bjState.baseBet;
    saveWallet(w);
    renderWallet(w);

    const c1 = h0[0];
    const c2 = h0[1];
    bjState.playerHands = [[c1], [c2]];
    bjState.handStakes = [bjState.baseBet, bjState.baseBet];
    bjState.handDoubled = [false, false];
    bjState.splitAces = c1.r === 'A';
    bjState.activeHand = 0;

    bjState.playerHands[0].push(bjDraw());
    if (bjState.splitAces) {
      bjState.playerHands[1].push(bjDraw());
      bjRenderHands();
      setGameOutcome('bj', 'pending', 'Split aces — one card each. Dealer plays.');
      bjStartDealerPhase();
      return;
    }

    bjRenderHands();
    const v0 = bjHandValue(bjState.playerHands[0]);
    if (v0 > 21 || v0 === 21) {
      bjFinishCurrentHandAndAdvance();
      return;
    }
    bjUiPlayerTurn();
    setGameOutcome('bj', 'pending', 'Hand 1 — hit, stand, or double.');
  }

  function initBlackjack() {
    bjUiIdle();
    bjRenderHands();
    document.getElementById('bj-deal-btn')?.addEventListener('click', bjDeal);
    document.getElementById('bj-hit-btn')?.addEventListener('click', bjHit);
    document.getElementById('bj-stand-btn')?.addEventListener('click', bjStand);
    document.getElementById('bj-double-btn')?.addEventListener('click', bjDouble);
    document.getElementById('bj-split-btn')?.addEventListener('click', bjSplit);
  }

  function todayKey() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function loadWallet() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return { tokens: DEFAULT_TOKENS, coinStreak: 0, lastDaily: '' };
      }
      const w = JSON.parse(raw);
      return {
        tokens: Math.max(0, Math.floor(Number(w.tokens)) || 0),
        coinStreak: Math.max(0, Math.floor(Number(w.coinStreak)) || 0),
        lastDaily: typeof w.lastDaily === 'string' ? w.lastDaily : ''
      };
    } catch {
      return { tokens: DEFAULT_TOKENS, coinStreak: 0, lastDaily: '' };
    }
  }

  function saveWallet(w) {
    w.tokens = Math.max(0, Math.floor(w.tokens));
    w.coinStreak = Math.max(0, Math.floor(w.coinStreak));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(w));
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (!raw) return [];
      const list = JSON.parse(raw);
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  function saveHistory(list) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, MAX_HISTORY)));
  }

  function pushHistory(game, detail, delta, balanceAfter) {
    const row = {
      at: Date.now(),
      game,
      detail: String(detail || '').slice(0, 120),
      delta: Math.round(delta),
      balance: Math.max(0, Math.floor(balanceAfter))
    };
    const next = [row, ...loadHistory()].slice(0, MAX_HISTORY);
    saveHistory(next);
    renderHistory(next);
  }

  function clearHistory() {
    localStorage.removeItem(HISTORY_KEY);
    renderHistory([]);
  }

  function formatHistoryTime(ts) {
    try {
      return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    } catch {
      return '—';
    }
  }

  function renderHistory(list) {
    const container = document.getElementById('games-history-list');
    if (!container) return;
    container.innerHTML = '';
    if (!list.length) {
      const p = document.createElement('p');
      p.className = 'games-history-empty';
      p.textContent = 'Play a round — each result shows here with your net change.';
      container.appendChild(p);
      return;
    }
    const HISTORY_GAME_CLASS = { coin: 'coin', rps: 'rps', slots: 'slots', bj: 'bj', daily: 'daily' };

    list.forEach((row) => {
      const d = document.createElement('div');
      const delta = row.delta;
      let mood = 'flat';
      if (delta > 0) mood = 'up';
      else if (delta < 0) mood = 'down';
      const gameSlug = HISTORY_GAME_CLASS[row.game];
      const gameClass = mood === 'up' && gameSlug ? ` games-history-row--game-${gameSlug}` : '';
      d.className = `games-history-row games-history-row--${mood}${gameClass}`;
      d.innerHTML = `
        <span class="games-history-time">${formatHistoryTime(row.at)}</span>
        <span class="games-history-game">${GAME_LABEL[row.game] || row.game}</span>
        <span class="games-history-detail">${escapeHtml(row.detail)}</span>
        <span class="games-history-delta">${delta > 0 ? '+' : ''}${delta}</span>
        <span class="games-history-after">→ ${row.balance}</span>
      `;
      container.appendChild(d);
    });
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function getBetAmount(name) {
    const el = document.querySelector(`input[name="${name}"]:checked`);
    return el ? Number(el.value) : BET_CHOICES[0];
  }

  const OUTCOME_MOODS = ['games-outcome--pending', 'games-outcome--win', 'games-outcome--lose', 'games-outcome--tie', 'games-outcome--jackpot'];

  function setGameOutcome(slug, mood, sub) {
    const wrap = document.getElementById(`${slug}-outcome`);
    const badge = document.getElementById(`${slug}-outcome-badge`);
    const subEl = document.getElementById(`${slug}-outcome-sub`);
    const card = wrap ? wrap.closest('.games-card') : null;
    if (!wrap || !badge) return;

    OUTCOME_MOODS.forEach((c) => wrap.classList.remove(c));
    wrap.classList.add(`games-outcome--${mood}`);

    const labels = {
      pending: '···',
      win: 'WIN',
      lose: 'LOSE',
      tie: 'TIE',
      jackpot: 'JACKPOT'
    };
    if (slug === 'coin' && mood === 'lose') {
      badge.textContent = 'MISS';
    } else {
      badge.textContent = labels[mood] || '···';
    }
    if (subEl) subEl.textContent = sub || '';

    wrap.classList.remove('games-outcome--pop');
    void wrap.offsetWidth;
    wrap.classList.add('games-outcome--pop');

    if (!card) return;
    const flash = `games-card-flash--${mood}`;
    card.classList.remove(
      'games-card-flash--pending',
      'games-card-flash--win',
      'games-card-flash--lose',
      'games-card-flash--tie',
      'games-card-flash--jackpot'
    );
    if (mood !== 'pending') {
      void card.offsetWidth;
      card.classList.add(flash);
    }
  }

  function renderWallet(w) {
    const text = String(w.tokens);
    document.querySelectorAll('.js-games-balance').forEach((el) => {
      el.textContent = text;
    });
    const streak = document.getElementById('games-coin-streak');
    if (streak) streak.textContent = String(w.coinStreak);
    const nextBonus = document.getElementById('games-streak-next-bonus');
    if (nextBonus) {
      nextBonus.textContent = String(Math.min(w.coinStreak, MAX_COIN_STREAK_BONUS));
    }
    const claimed = w.lastDaily === todayKey();
    document.querySelectorAll('.js-games-daily').forEach((btn) => {
      btn.disabled = claimed;
      btn.textContent = claimed ? 'DAILY BONUS CLAIMED' : `CLAIM +${DAILY_BONUS} DAILY`;
    });
  }

  function wireBetRadios(name, prefix) {
    BET_CHOICES.forEach((n) => {
      const id = `${prefix}-bet-${n}`;
      const input = document.getElementById(id);
      if (!input) return;
      input.addEventListener('change', () => {
        document.querySelectorAll(`input[name="${name}"]`).forEach((inp) => {
          const label = inp.closest('label');
          if (label) label.classList.toggle('games-bet-active', inp.checked);
        });
      });
    });
  }

  function initWalletUi() {
    const w = loadWallet();
    renderWallet(w);
    renderHistory(loadHistory());

    function claimDailyBonus() {
      const cur = loadWallet();
      const day = todayKey();
      if (cur.lastDaily === day) return;
      const before = cur.tokens;
      cur.tokens += DAILY_BONUS;
      cur.lastDaily = day;
      saveWallet(cur);
      renderWallet(cur);
      pushHistory('daily', `Claimed +${DAILY_BONUS}`, cur.tokens - before, cur.tokens);
    }
    document.querySelectorAll('.js-games-daily').forEach((btn) => {
      btn.addEventListener('click', claimDailyBonus);
    });

    document.getElementById('games-reset-btn')?.addEventListener('click', () => {
      if (!window.confirm('Reset your FUQ wallet balance on this device? Coins go back to 100.')) return;
      localStorage.removeItem(STORAGE_KEY);
      clearHistory();
      const fresh = loadWallet();
      renderWallet(fresh);
      pushHistory('reset', 'Wallet cleared', 0, fresh.tokens);
    });

    document.getElementById('games-history-clear')?.addEventListener('click', () => {
      if (!window.confirm('Clear play history log only? (coins stay.)')) return;
      clearHistory();
    });
  }

  function playCoinFlip() {
    const pickEl = document.querySelector('input[name="coin-side"]:checked');
    const pick = pickEl ? pickEl.value : 'heads';
    const bet = getBetAmount('coin-bet');
    const w = loadWallet();
    const before = w.tokens;
    if (w.tokens < bet) {
      setGameOutcome('coin', 'pending', 'Need more FUQ coins for that bet.');
      return;
    }
    w.tokens -= bet;
    const outcome = Math.random() < 0.5 ? 'heads' : 'tails';
    const win = outcome === pick;
    const display = document.getElementById('coin-display');
    if (display) {
      display.textContent = outcome === 'heads' ? '● HEADS' : '○ TAILS';
      display.classList.remove('games-flash');
      void display.offsetWidth;
      display.classList.add('games-flash');
    }
    let detail = `${pick.toUpperCase()} vs ${outcome.toUpperCase()} · bet ${bet}`;
    if (win) {
      const streakBonus = Math.min(w.coinStreak, MAX_COIN_STREAK_BONUS);
      w.coinStreak += 1;
      const payout = bet * 2 + streakBonus;
      w.tokens += payout;
      detail += ` · WIN +${payout - bet} net`;
    } else {
      w.coinStreak = 0;
      detail += ' · MISS';
    }
    saveWallet(w);
    renderWallet(w);
    pushHistory('coin', detail, w.tokens - before, w.tokens);
    const net = w.tokens - before;
    if (win) {
      setGameOutcome('coin', 'win', `You called ${pick.toUpperCase()} · landed ${outcome.toUpperCase()} · ${net >= 0 ? '+' : ''}${net} coins`);
    } else {
      setGameOutcome('coin', 'lose', `Landed ${outcome.toUpperCase()} · ${net} coins · streak reset`);
    }
  }

  function playRps() {
    const pickEl = document.querySelector('input[name="rps-choice"]:checked');
    const pick = pickEl ? pickEl.value : 'rock';
    const bet = getBetAmount('rps-bet');
    const w = loadWallet();
    const before = w.tokens;
    if (w.tokens < bet) {
      setGameOutcome('rps', 'pending', 'Need more FUQ coins for that bet.');
      return;
    }
    w.tokens -= bet;
    const choices = ['rock', 'paper', 'scissors'];
    const house = choices[Math.floor(Math.random() * 3)];
    const labels = { rock: '✊ ROCK', paper: '✋ PAPER', scissors: '✌ SCISSORS' };
    const short = { rock: 'R', paper: 'P', scissors: 'S' };
    const houseEl = document.getElementById('rps-house');
    if (houseEl) houseEl.textContent = labels[house];

    let delta = 0;
    let detail = `${short[pick]} vs ${short[house]} · ${bet}`;
    if (pick === house) {
      delta = bet;
      detail += ' · TIE';
    } else if (
      (pick === 'rock' && house === 'scissors') ||
      (pick === 'paper' && house === 'rock') ||
      (pick === 'scissors' && house === 'paper')
    ) {
      delta = bet * 2;
      detail += ' · WIN';
    } else {
      detail += ' · LOSE';
    }
    w.tokens += delta;
    saveWallet(w);
    renderWallet(w);
    pushHistory('rps', detail, w.tokens - before, w.tokens);
    const net = w.tokens - before;
    if (pick === house) {
      setGameOutcome('rps', 'tie', `Both played ${pick.toUpperCase()} · bet returned`);
    } else if (delta === bet * 2) {
      setGameOutcome('rps', 'win', `Beat ${house.toUpperCase()} · +${bet} profit (${net >= 0 ? '+' : ''}${net} coins)`);
    } else {
      setGameOutcome('rps', 'lose', `Lost to ${house.toUpperCase()} · ${net} coins`);
    }
  }

  function renderSlotSymbol(el, symbol) {
    if (!el || !symbol) return;
    el.innerHTML = '';
    const img = document.createElement('img');
    img.className = 'games-slot-icon';
    img.alt = symbol.label;
    img.loading = 'eager';
    img.decoding = 'async';
    img.src = symbol.image;

    const fallback = document.createElement('span');
    fallback.className = 'games-slot-fallback';
    fallback.textContent = symbol.emoji;

    let loaded = false;
    img.addEventListener('load', () => {
      loaded = true;
      fallback.remove();
    });
    img.addEventListener('error', () => {
      if (!loaded) img.remove();
    });

    el.appendChild(img);
    el.appendChild(fallback);
  }

  function formatSlotsLineSymbols(final) {
    return final.map((s) => s.emoji).join('');
  }

  function settleSlots(final, bet) {
    const cur = loadWallet();
    let prize = 0;
    let line = '';
    if (final[0].id === final[1].id && final[1].id === final[2].id) {
      prize = bet * 8;
      line = `Bet ${bet} · ${formatSlotsLineSymbols(final)} · TRIPLE`;
    } else if (final[0].id === final[1].id) {
      prize = bet * 2;
      line = `Bet ${bet} · ${formatSlotsLineSymbols(final)} · DOUBLE`;
    } else {
      line = `Bet ${bet} · ${formatSlotsLineSymbols(final)} · MISS`;
    }
    const net = prize - bet;
    cur.tokens += prize;
    saveWallet(cur);
    renderWallet(cur);
    line += ` (${net >= 0 ? '+' : ''}${net})`;
    pushHistory('slots', line, net, cur.tokens);
    const spinBtn = document.getElementById('slots-spin-btn');
    if (spinBtn) spinBtn.disabled = false;

    const sub = `${final.map((s) => s.label).join(' / ')} · ${net >= 0 ? '+' : ''}${net} coins`;
    if (final[0].id === final[1].id && final[1].id === final[2].id) {
      setGameOutcome('slots', 'jackpot', `Triple ${final[0].label} · ${sub}`);
    } else if (final[0].id === final[1].id) {
      setGameOutcome('slots', 'win', `First two match · ${sub}`);
    } else {
      setGameOutcome('slots', 'lose', `No line hit · ${sub}`);
    }
  }

  function spinSlots() {
    const bet = getBetAmount('slots-bet');
    const w = loadWallet();
    if (w.tokens < bet) {
      setGameOutcome('slots', 'pending', 'Need more FUQ coins for that bet.');
      return;
    }
    w.tokens -= bet;
    saveWallet(w);
    renderWallet(w);
    setGameOutcome('slots', 'pending', 'Reels rolling…');

    const reels = [
      document.getElementById('slot-reel-0'),
      document.getElementById('slot-reel-1'),
      document.getElementById('slot-reel-2')
    ];
    const spinBtn = document.getElementById('slots-spin-btn');
    if (spinBtn) spinBtn.disabled = true;

    const final = [
      SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)],
      SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)],
      SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)]
    ];

    const reduceMotion =
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      reels.forEach((el, i) => {
        renderSlotSymbol(el, final[i]);
      });
      settleSlots(final, bet);
      return;
    }

    let ticks = 0;
    const maxTicks = 18;
    const interval = setInterval(() => {
      ticks += 1;
      reels.forEach((el, i) => {
        if (!el) return;
        if (ticks > maxTicks - 3 + i) {
          renderSlotSymbol(el, final[i]);
        } else {
          renderSlotSymbol(el, SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)]);
        }
      });
      if (ticks >= maxTicks) {
        clearInterval(interval);
        settleSlots(final, bet);
      }
    }, 70);
  }

  function initGameTabs() {
    const tablist = document.querySelector('.games-tablist');
    const tabs = tablist ? Array.from(tablist.querySelectorAll('.games-tab')) : [];
    const panels = document.querySelectorAll('.games-tab-panel');
    if (!tabs.length || !panels.length) return;

    const order = ['bj', 'coin', 'rps', 'slots'];

    function selectTab(id) {
      const next = order.includes(id) ? id : 'bj';
      tabs.forEach((t) => {
        const sel = t.getAttribute('data-tab') === next;
        t.setAttribute('aria-selected', sel ? 'true' : 'false');
        t.tabIndex = sel ? 0 : -1;
      });
      panels.forEach((p) => {
        p.hidden = p.getAttribute('data-tab-panel') !== next;
      });
      try {
        const url = new URL(window.location.href);
        if (next === 'bj') url.searchParams.delete('game');
        else url.searchParams.set('game', next);
        const q = url.searchParams.toString();
        window.history.replaceState({}, '', `${url.pathname}${q ? `?${q}` : ''}${url.hash}`);
      } catch (_) {}
    }

    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        selectTab(tab.getAttribute('data-tab'));
        tab.focus();
      });
    });

    if (tablist) {
      tablist.addEventListener('keydown', (e) => {
        const key = e.key;
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return;
        const current = tabs.find((t) => t.getAttribute('aria-selected') === 'true');
        let ix = order.indexOf(current?.getAttribute('data-tab') || 'bj');
        if (key === 'ArrowRight') ix = Math.min(order.length - 1, ix + 1);
        else if (key === 'ArrowLeft') ix = Math.max(0, ix - 1);
        else if (key === 'Home') ix = 0;
        else if (key === 'End') ix = order.length - 1;
        e.preventDefault();
        selectTab(order[ix]);
        tabs.find((t) => t.getAttribute('data-tab') === order[ix])?.focus();
      });
    }

    const g = new URLSearchParams(window.location.search).get('game');
    if (g === 'rps' || g === 'slots' || g === 'coin' || g === 'bj') selectTab(g);
    else selectTab('bj');
  }

  document.getElementById('coin-flip-btn')?.addEventListener('click', playCoinFlip);
  document.getElementById('rps-play-btn')?.addEventListener('click', playRps);
  document.getElementById('slots-spin-btn')?.addEventListener('click', spinSlots);
  [
    document.getElementById('slot-reel-0'),
    document.getElementById('slot-reel-1'),
    document.getElementById('slot-reel-2')
  ].forEach((el) => {
    renderSlotSymbol(el, SLOT_SYMBOLS[3]);
  });

  wireBetRadios('coin-bet', 'coin');
  wireBetRadios('rps-bet', 'rps');
  wireBetRadios('slots-bet', 'slots');
  wireBetRadios('bj-bet', 'bj');

  function initHistoryDetailsOpen() {
    const el = document.getElementById('games-history-details');
    if (!el) return;
    const mq = window.matchMedia('(min-width: 960px)');
    function sync() {
      el.open = mq.matches;
    }
    sync();
    mq.addEventListener('change', sync);
  }

  initWalletUi();
  initHistoryDetailsOpen();
  initBlackjack();
  initGameTabs();
})();
