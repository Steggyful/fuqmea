// FuqMeA mini-games — local-first fun tokens with optional cloud sync + leaderboard.

(function () {
  'use strict';

  const STORAGE_KEY = 'fuqmea_fun_wallet_v1';
  const HISTORY_KEY = 'fuqmea_fun_history_v1';
  const WIN_STREAK_KEY = 'fuqmea_game_win_streak_v1';
  const RAKEBACK_STATE_KEY = 'fuqmea_arcade_rakeback_v1';
  const QUEST_UI_KEY = 'fuqmea_arcade_quest_ui_v1';
  const DEFAULT_TOKENS = 200;
  /** Picks economy so dailies + quests cover dry spells; synced to games-page hint text in renderWallet */
  const DAILY_BONUS = 30;
  const MAX_COIN_STREAK_BONUS = 3;
  const COIN_FLIP_DURATION_MS = 1100;
  let coinFlipYDeg = 0;
  let coinFlipAnimating = false;
  const RPS_SHUFFLE_TICK_MS = 86;
  const RPS_SHUFFLE_STEPS = 13;
  const RPS_LAND_POP_MS = 400;
  const RPS_ORDER = ['rock', 'paper', 'scissors'];
  const RPS_GLYPHS = { rock: '✊', paper: '✋', scissors: '✌' };
  let rpsRoundBusy = false;
  const MAX_HISTORY = 35;
  const BET_CHOICES = [5, 10, 25];
  const cloudClient = window.FuqCloud || null;
  const LEADERBOARD_REFRESH_DEBOUNCE_MS = 900;
  let leaderboardRefreshTimer = null;

  function scheduleLeaderboardRefresh() {
    if (!cloudClient?.refreshLeaderboard) return;
    if (leaderboardRefreshTimer) window.clearTimeout(leaderboardRefreshTimer);
    leaderboardRefreshTimer = window.setTimeout(() => {
      leaderboardRefreshTimer = null;
      cloudClient.refreshLeaderboard().catch(() => {});
    }, LEADERBOARD_REFRESH_DEBOUNCE_MS);
  }
  const SLOT_SYMBOLS = [
    { id: 'ecat', label: 'E CAT', emoji: '🐱', image: 'assets/images/slots/e Cat - Floride.JPG' },
    { id: 'butt', label: 'BUTT', emoji: '🍑', image: 'assets/images/slots/Emoji - Butt.PNG' },
    { id: 'periot', label: 'PERIOT', emoji: '😮', image: 'assets/images/slots/Emoji - Periot.JPG' },
    { id: 'toes', label: 'TOES', emoji: '🦶', image: 'assets/images/slots/Toes.JPG' },
    { id: 'bonk', label: 'BONK', emoji: '💥', image: 'assets/images/slots/Bonk.png' },
    { id: 'shronk', label: 'SHRONK', emoji: '🗿', image: 'assets/images/slots/Shronk.jpg' },
    { id: 'twin', label: 'TWIN', emoji: '👯', image: 'assets/images/slots/Twin.JPG' }
  ];

  const GAME_LABEL = {
    coin: 'COIN',
    rps: 'RPS',
    slots: 'SLOTS',
    bj: 'BJ',
    crash: 'AURA',
    daily: 'DAILY',
    rakeback: 'RAKEBACK',
    reset: 'RESET',
    quest: 'QUEST',
    quest_weekly: 'WEEK'
  };

  /** Guest-only slots (legacy keys — unchanged for backward compatibility). */
  const QUEST_STATE_KEY_GUEST = 'fuqmea_arcade_quests_v1';
  const WEEKLY_QUEST_STATE_KEY_GUEST = 'fuqmea_arcade_weekly_quests_v1';
  const QUEST_STATE_KEY_ACCOUNT = 'fuqmea_arcade_quests_account_v1';
  const WEEKLY_QUEST_STATE_KEY_ACCOUNT = 'fuqmea_arcade_weekly_quests_account_v1';
  /** Snapshot of guest quest JSON before sign-in (like wallet guest backup). */
  const GUEST_QUEST_BUNDLE_KEY = 'fuqmea_guest_quest_bundle_v1';
  const ACCOUNT_QUEST_MIGRATION_FLAG = 'fuqmea_account_quest_migrated_v2';

  function isQuestAccountMode() {
    return !!(cloudClient && cloudClient.isSignedIn && cloudClient.isSignedIn());
  }

  function questDailyStorageKey() {
    return isQuestAccountMode() ? QUEST_STATE_KEY_ACCOUNT : QUEST_STATE_KEY_GUEST;
  }

  function questWeeklyStorageKey() {
    return isQuestAccountMode() ? WEEKLY_QUEST_STATE_KEY_ACCOUNT : WEEKLY_QUEST_STATE_KEY_GUEST;
  }

  /** Surge + grind + flex + full-floor sampler — four dailies, RNG’d per bucket */
  const QUEST_CAT_SURGE = [
    'surge_play_3',
    'surge_play_5',
    'surge_cash_25',
    'surge_cash_4',
    'surge_first'
  ];
  const QUEST_CAT_GRIND = [
    'bj_rounds_2',
    'bj_rounds_4',
    'coin_3',
    'coin_5',
    'rps_3',
    'rps_5',
    'slots_4',
    'slots_5'
  ];
  const QUEST_CAT_FLEX = [
    'wins_any_2',
    'explorer',
    'bj_win_1',
    'bj_long_4',
    'bj_long_5',
    'bet_big',
    'spree_8',
    'slots_line_1',
    'aura_profit_2',
    'spree_12'
  ];

  /** “Play each machine once today” variants—same mechanic (uniqueGames → 5), different joke */
  const QUEST_CAT_SAMPLER = [
    'daily_tour_fuq',
    'daily_grand_sampling',
    'daily_cabinet_crawl',
    'daily_stamp_rally',
    'daily_five_stop_shuffle',
    'daily_full_floor_pass'
  ];

  const QUEST_DEFS = {
    surge_play_3: {
      title: 'Aura hat trick',
      flavor: 'Three aura rounds on the board. Ride the line three times.',
      reward: 18,
      target: 3,
      progKey: 'crashRounds'
    },
    surge_play_5: {
      title: 'Five alarm aura',
      flavor: 'Stack five aura runs. The chart remembers.',
      reward: 24,
      target: 5,
      progKey: 'crashRounds'
    },
    surge_cash_25: {
      title: 'Lock at 2.5×',
      flavor: 'Bank once at 2.5× aura or hotter.',
      reward: 22,
      target: 1,
      progKey: 'surgeCashHigh'
    },
    surge_cash_4: {
      title: 'Big aura energy',
      flavor: 'Bank once at 4× aura or higher. Chef’s kiss.',
      reward: 26,
      target: 1,
      progKey: 'surgeCash4'
    },
    surge_first: {
      title: 'First aura stop',
      flavor: 'Kick off one aura round. The line starts climbing as soon as you tap in.',
      reward: 12,
      target: 1,
      progKey: 'crashRounds'
    },
    bj_rounds_2: {
      title: 'Two seats at the table',
      flavor: 'Finish two blackjack rounds. Deal, hit, stand, repeat.',
      reward: 14,
      target: 2,
      progKey: 'bjRounds'
    },
    bj_rounds_4: {
      title: 'Four-deal energy',
      flavor: 'Four blackjack rounds. Same deck, different attitudes.',
      reward: 19,
      target: 4,
      progKey: 'bjRounds'
    },
    coin_3: {
      title: 'Three coin calls',
      flavor: 'Pick a side and flip three times. No take-backs.',
      reward: 12,
      target: 3,
      progKey: 'coinRounds'
    },
    coin_5: {
      title: 'Coin flip crusade',
      flavor: 'Five flips. You’re warmed up.',
      reward: 15,
      target: 5,
      progKey: 'coinRounds'
    },
    rps_3: {
      title: 'Triple throwdown',
      flavor: 'Rock, paper, scissors ×3.',
      reward: 12,
      target: 3,
      progKey: 'rpsRounds'
    },
    rps_5: {
      title: 'Five throw sessions',
      flavor: 'Rock, paper, scissors. Five full rounds. House picks random.',
      reward: 16,
      target: 5,
      progKey: 'rpsRounds'
    },
    slots_4: {
      title: 'Four pulls',
      flavor: 'Four slot spins. The reels thirst.',
      reward: 14,
      target: 4,
      progKey: 'slotsRounds'
    },
    slots_5: {
      title: 'Jackpot warmup',
      flavor: 'Five spins. Luck is a skill issue.',
      reward: 16,
      target: 5,
      progKey: 'slotsRounds'
    },
    wins_any_2: {
      title: 'Two trophies',
      flavor: 'Win any games twice. RNG owes you.',
      reward: 20,
      target: 2,
      progKey: 'winsAny'
    },
    explorer: {
      title: 'Island hopper',
      flavor: 'Play three different games today.',
      reward: 26,
      target: 3,
      progKey: 'uniqueGames'
    },
    bj_win_1: {
      title: 'Beat the dealer',
      flavor: 'One clean blackjack dub.',
      reward: 18,
      target: 1,
      progKey: 'bjWins'
    },
    bj_long_4: {
      title: 'Long hand (4)',
      flavor: 'Win blackjack with a four-card hand at least once.',
      reward: 26,
      target: 1,
      progKey: 'bjLong4Wins'
    },
    bj_long_5: {
      title: 'Long hand (5)',
      flavor: 'Win blackjack with a five-card hand at least once.',
      reward: 32,
      target: 1,
      progKey: 'bjLong5Wins'
    },
    bet_big: {
      title: 'Whale alert',
      flavor: 'Slap a 25 FUQ bet on anything once.',
      reward: 16,
      target: 1,
      progKey: 'bet25'
    },
    spree_8: {
      title: 'Eight-stop route',
      flavor: 'Play eight rounds total. Bounce cabinets, stack progress.',
      reward: 26,
      target: 8,
      progKey: 'totalRounds'
    },
    spree_12: {
      title: 'Turbo dozen',
      flavor: 'Twelve rounds mixed. Touch everything.',
      reward: 30,
      target: 12,
      progKey: 'totalRounds'
    },
    slots_line_1: {
      title: 'Line cook',
      flavor: 'Hit a slots double or triple once.',
      reward: 22,
      target: 1,
      progKey: 'slotsLineHits'
    },
    aura_profit_2: {
      title: 'Pay the duck',
      flavor: 'Bank aura twice with net profit on cash-out.',
      reward: 24,
      target: 2,
      progKey: 'crashProfitBanks'
    },
    daily_tour_fuq: {
      title: 'Tour de Fuq',
      flavor: 'Play all five games once today.',
      reward: 30,
      target: 5,
      progKey: 'uniqueGames'
    },
    daily_grand_sampling: {
      title: 'Grand sampling menu',
      flavor: 'Try each game one time today.',
      reward: 30,
      target: 5,
      progKey: 'uniqueGames'
    },
    daily_cabinet_crawl: {
      title: 'Cabinet crawl',
      flavor: 'Run one round in every game.',
      reward: 30,
      target: 5,
      progKey: 'uniqueGames'
    },
    daily_stamp_rally: {
      title: 'Stamp rally survivor',
      flavor: 'Get credit in all five game modes.',
      reward: 30,
      target: 5,
      progKey: 'uniqueGames'
    },
    daily_five_stop_shuffle: {
      title: 'Five-stop shuffle',
      flavor: 'Complete one round in each game type.',
      reward: 30,
      target: 5,
      progKey: 'uniqueGames'
    },
    daily_full_floor_pass: {
      title: 'Whole-floor wristband',
      flavor: 'Play blackjack, aura, coin, RPS, and slots once each.',
      reward: 30,
      target: 5,
      progKey: 'uniqueGames'
    }
  };

  /** Weekly: high round totals + cumulative FUQ won from arcade games (claims/daily excluded) */
  const WEEKLY_CAT_ROUNDS = ['week_rounds_150', 'week_rounds_185', 'week_rounds_220'];
  const WEEKLY_CAT_EARN = ['week_fuq_earn_850', 'week_fuq_earn_1150', 'week_fuq_earn_1450'];

  const WEEKLY_QUEST_DEFS = {
    week_rounds_150: {
      title: 'One-fifty club',
      flavor: '150 rounds before Monday’s reset hits. Every cabinet counts.',
      reward: 76,
      target: 150,
      progKey: 'totalRounds'
    },
    week_rounds_185: {
      title: '185-ticket week',
      flavor: '185 rounds waiting for you. The floor’s wide open till Monday resets.',
      reward: 84,
      target: 185,
      progKey: 'totalRounds'
    },
    week_rounds_220: {
      title: 'Two-twenty ticket dump',
      flavor: '220 rounds in one week. It is oversized on purpose. Slam tokens through every cabinet till you nail it.',
      reward: 90,
      target: 220,
      progKey: 'totalRounds'
    },
    week_fuq_earn_850: {
      title: 'Win column (850)',
      flavor: '+850 net FUQ from games this week. Wins/settles only, not daily bonus or quest rewards.',
      reward: 78,
      target: 850,
      progKey: 'fuqEarned'
    },
    week_fuq_earn_1150: {
      title: 'Profit goblin (1.15k)',
      flavor: '+1,150 net FUQ from the machines before the weekly clock resets.',
      reward: 84,
      target: 1150,
      progKey: 'fuqEarned'
    },
    week_fuq_earn_1450: {
      title: 'Whale-ish week (1.45k)',
      flavor: '+1,450 net FUQ scraped from payouts. RNG rent is due.',
      reward: 90,
      target: 1450,
      progKey: 'fuqEarned'
    }
  };

  /** ~20 ticks/s; slight spacing vs 48ms reads smoother vs typical crypto crash UIs */
  const CRASH_TICK_MS = 50;
  /** Perceptual Y curve; slightly lower = punchier-looking climb (fill/glow removed) */
  const CRASH_CHART_Y_CURVE = 0.53;
  /** Long surges trim oldest samples only */
  const CRASH_CHART_MAX_POINTS = 380;
  /** Matches server/game ceiling (~88 crash sample, ~89 clamp); avoids chart flatline above ~22× */
  const CRASH_CHART_MULT_VIS_MAX = 89;
  const CRASH_CHART_X_LEFT = 2;
  const CRASH_CHART_X_RIGHT_CAP = 95;
  /** Curve ends at LEFT + span × ASYM × n/(n+H): approaches the right but never uses the full width */
  const CRASH_CHART_X_ASYM = 0.9;
  const CRASH_CHART_X_TAIL_PAD = 14;
  /** <1 spreads early samples a bit farther on X → shallower slopes at the start */
  const CRASH_CHART_X_EASE = 0.83;
  /** Light sine squiggle on the trace (viewBox units); disabled when prefers-reduced-motion */
  const CRASH_CHART_WOBBLE_AMP_Y1 = 0.62;
  const CRASH_CHART_WOBBLE_AMP_Y2 = 0.24;
  const CRASH_CHART_WOBBLE_AMP_X = 0.28;
  /** Keeps curve + mascot off the top of the viewBox; nudged down for rider headroom */
  const CRASH_CHART_Y_VIEW_TOP = 15.85;
  /** Pull last vertex back (viewBox units) so the stroke reads as hitting the deck, not the torso. */
  const CRASH_CHART_TAIL_TRIM = 3.45;
  /** Sprite % anchor: tail-side of deck (see .games-crash-chart --crash-rider-ax/ay). */
  const CRASH_RIDER_ANCHOR_AX = 43;
  const CRASH_RIDER_ANCHOR_AY = 87;
  const CRASH_CHART_WOBBLE_I1 = 0.69;
  const CRASH_CHART_WOBBLE_I2 = 1.17;
  const CRASH_CHART_WOBBLE_IX = 0.56;

  /** While farming, swap to the fire board at/above this multiplier (only climbs, no flicker). */
  const CRASH_RIDER_HOT_MULT = 6;

  const CRASH_RIDER_ART = {
    farm: encodeURI('assets/images/aura farm/Farming Board.png'),
    farmHot: encodeURI('assets/images/aura farm/Farming Board High X.png'),
    win: encodeURI('assets/images/aura farm/Fuq Yeah Board.png'),
    lose: encodeURI('assets/images/aura farm/Aura Lost Board.png')
  };

  const BJ_RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
  const BJ_SUITS = ['\u2660', '\u2665', '\u2666', '\u2663'];
  const BJ_DEALER_DRAW_DELAY_MS = 1050;
  /** Pause with hole card still face-down before flip + dealer hits (after stand / all hands done). */
  const BJ_DEALER_HOLE_REVEAL_MS = 720;
  const BJ_OPENING_DEAL_DELAY_MS = 580;
  const BJ_OPENING_SETTLE_MS = 520;
  const BJ_PLAYER_HIT_DELAY_MS = 420;

  const bjState = {
    deck: [],
    playerHands: [],
    handStakes: [],
    handDoubled: [],
    handOutcomes: [],
    dealer: [],
    phase: 'idle',
    baseBet: 0,
    activeHand: 0,
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

  function bjHandLowValue(cards) {
    let low = 0;
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      if (c.r === 'A') low += 1;
      else if ('TJQK'.includes(c.r)) low += 10;
      else low += Number(c.r);
    }
    return low;
  }

  /** Soft total as hi/low only while that hand is still in play; after stand (or other hands) show locked best total. */
  function bjPlayerHandScoreText(hand, handIndex) {
    if (!hand.length) return '—';
    const hi = bjHandValue(hand);
    const low = bjHandLowValue(hand);
    if (hi === low) return String(hi);
    const ph = bjState.phase;
    const isActive = handIndex === bjState.activeHand;
    const showDual =
      ph === 'dealing' || ((ph === 'player' || ph === 'hit') && isActive);
    return showDual ? `${hi}/${low}` : String(hi);
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

  function bjWait(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  function bjPrefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function bjAnimateDealerCard(index) {
    if (bjPrefersReducedMotion()) return;
    const wrap = document.getElementById('bj-dealer-cards');
    if (!wrap) return;
    const cards = wrap.querySelectorAll('.games-bj-card');
    if (!cards.length) return;
    const ix = Number.isInteger(index) ? index : cards.length - 1;
    const card = cards[ix];
    if (!card) return;
    card.classList.remove('games-bj-card--dealer-draw');
    void card.offsetWidth;
    card.classList.add('games-bj-card--dealer-draw');
  }

  function bjAnimateDealerLastCard() {
    if (bjPrefersReducedMotion()) return;
    const wrap = document.getElementById('bj-dealer-cards');
    if (!wrap) return;
    const cards = wrap.querySelectorAll('.games-bj-card');
    if (!cards.length) return;
    const card = cards[cards.length - 1];
    card.classList.remove('games-bj-card--deal-in', 'games-bj-card--hit-in', 'games-bj-card--dealer-draw');
    void card.offsetWidth;
    card.classList.add('games-bj-card--deal-in');
  }

  function bjAnimatePlayerHandLastCard(handIndex, style) {
    if (bjPrefersReducedMotion()) return;
    const zone = document.getElementById('bj-player-hands');
    if (!zone) return;
    const rows = zone.querySelectorAll('.games-bj-split-hand');
    const row = rows[handIndex];
    if (!row) return;
    const tray = row.querySelector('.games-bj-cards');
    if (!tray) return;
    const list = tray.querySelectorAll('.games-bj-card');
    if (!list.length) return;
    const card = list[list.length - 1];
    const hit = style === 'hit';
    const anim = hit ? 'games-bj-card--hit-in' : 'games-bj-card--deal-in';
    const other = hit ? 'games-bj-card--deal-in' : 'games-bj-card--hit-in';
    card.classList.remove('games-bj-card--dealer-draw', other, anim);
    void card.offsetWidth;
    card.classList.add(anim);
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
      sc.textContent = hand.length ? bjPlayerHandScoreText(hand, i) : '—';
      head.appendChild(lab);
      head.appendChild(sc);
      const handOutcome = bjState.handOutcomes[i];
      if (handOutcome) {
        const tag = document.createElement('span');
        tag.className = `games-bj-hand-outcome games-bj-hand-outcome--${handOutcome}`;
        tag.textContent = handOutcome.toUpperCase();
        head.appendChild(tag);
      }
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
        w.tokens >= bjState.handStakes[ah];
      dbl.disabled = !ok;
    }
    const spl = document.getElementById('bj-split-btn');
    if (spl) {
      const hCur = bjState.playerHands[ah];
      const canSplit =
        bjState.phase === 'player' &&
        hCur &&
        hCur.length === 2 &&
        hCur[0].r === hCur[1].r &&
        !bjState.handDoubled[ah] &&
        w.tokens >= bjState.handStakes[ah];
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
    const dbl = document.getElementById('bj-double-btn');
    if (dbl) dbl.disabled = true;
  }

  function bjFinishRound(detail, mood, sub) {
    const maxStake =
      bjState.handStakes && bjState.handStakes.length > 0
        ? Math.max(...bjState.handStakes)
        : bjState.baseBet || 0;
    arcadeNoteBet(maxStake);
    arcadeNoteRound('bj', maxStake);
    if (mood === 'win' || mood === 'jackpot') arcadeNoteWin('bj');
    applyArcadeWinStreak('bj', mood);
    const w = loadWallet();
    saveWallet(w);
    renderWallet(w);
    const delta = w.tokens - bjState.roundStartBalance;
    bumpWeeklyFuqEarnedFromGames(delta);
    pushHistory('bj', detail, delta, w.tokens, { wager_amount: bjState.baseBet });
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
    let wonLong4 = false;
    let wonLong5 = false;

    for (let i = 0; i < bjState.playerHands.length; i++) {
      const h = bjState.playerHands[i];
      const stake = bjState.handStakes[i];
      const pv = bjHandValue(h);
      if (pv > 21) {
        parts.push(`H${i + 1} bust`);
        bjState.handOutcomes[i] = 'bust';
        continue;
      }
      if (dealerBust) {
        w.tokens += 2 * stake;
        parts.push(`H${i + 1} win (${pv})`);
        bjState.handOutcomes[i] = 'win';
        if (h.length >= 4) wonLong4 = true;
        if (h.length >= 5) wonLong5 = true;
      } else if (pv > dv) {
        w.tokens += 2 * stake;
        parts.push(`H${i + 1} ${pv}>${dv}`);
        bjState.handOutcomes[i] = 'win';
        if (h.length >= 4) wonLong4 = true;
        if (h.length >= 5) wonLong5 = true;
      } else if (pv < dv) {
        parts.push(`H${i + 1} lose`);
        bjState.handOutcomes[i] = 'lose';
      } else {
        w.tokens += stake;
        parts.push(`H${i + 1} push`);
        bjState.handOutcomes[i] = 'push';
      }
    }
    saveWallet(w);

    const net = w.tokens - bjState.roundStartBalance;
    addRakebackFromLoss(net);
    let mood = 'tie';
    if (net > 0) mood = 'win';
    else if (net < 0) mood = 'lose';
    const sub =
      net > 0
        ? `Net +${net} FUQ. Dealer ${dv}${dealerBust ? ' busts' : ''}.`
        : net < 0
          ? `Net ${net} FUQ. Dealer ${dv}.`
          : `Net even. Dealer ${dv}.`;
    arcadeNoteBjLongWins(wonLong4, wonLong5);
    bjFinishRound(parts.join(' · '), mood, sub);
  }

  async function bjStartDealerPhase() {
    bjState.phase = 'dealer';
    bjUiDealerTurn();

    const allBust = bjState.playerHands.every((h) => bjHandValue(h) > 21);
    if (allBust) {
      const revealMs = bjPrefersReducedMotion() ? 0 : BJ_DEALER_HOLE_REVEAL_MS;
      if (revealMs > 0) {
        await bjWait(revealMs);
      }
      bjState.holeHidden = false;
      bjState.handOutcomes = bjState.playerHands.map(() => 'bust');
      bjRenderHands();
      bjAnimateDealerCard(1);
      bjFinishRound(
        bjState.playerHands.map((h, i) => `H${i + 1} bust`).join(' · ') + ' · dealer shows',
        'lose',
        'All hands bust.'
      );
      return;
    }

    const revealMs = bjPrefersReducedMotion() ? 0 : BJ_DEALER_HOLE_REVEAL_MS;
    if (revealMs > 0) {
      await bjWait(revealMs);
    }
    bjState.holeHidden = false;
    bjRenderHands();
    bjAnimateDealerCard(1);

    const drawDelay = bjPrefersReducedMotion() ? 0 : BJ_DEALER_DRAW_DELAY_MS;
    if (drawDelay > 0) {
      await bjWait(drawDelay);
    }

    while (bjDealerShouldHit(bjState.dealer)) {
      bjState.dealer.push(bjDraw());
      bjRenderHands();
      bjAnimateDealerCard();
      setGameOutcome('bj', 'pending', 'Dealer draws...');
      if (drawDelay > 0) {
        await bjWait(drawDelay);
      }
    }
    bjRenderHands();
    setGameOutcome('bj', 'pending', 'Dealer stands...');
    bjSettleRoundVsDealer();
  }

  function bjFinishCurrentHandAndAdvance() {
    if (bjState.activeHand < bjState.playerHands.length - 1) {
      bjState.activeHand += 1;
      const h = bjState.playerHands[bjState.activeHand];
      if (h.length === 1) {
        h.push(bjDraw());
        bjRenderHands();
        bjAnimatePlayerHandLastCard(bjState.activeHand, 'hit');
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

  async function bjDeal() {
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
    bjState.activeHand = 0;
    bjState.deck = bjShuffle(bjNewDeck());
    bjState.playerHands = [[]];
    bjState.handStakes = [bet];
    bjState.handDoubled = [false];
    bjState.handOutcomes = [''];
    bjState.dealer = [];
    bjState.phase = 'dealing';
    bjState.holeHidden = true;
    bjRenderHands();
    bjUiDealerTurn();
    setGameOutcome('bj', 'pending', 'Dealing');
    const openingDelay = bjPrefersReducedMotion() ? 0 : BJ_OPENING_DEAL_DELAY_MS;
    const settleMs = bjPrefersReducedMotion() ? 0 : BJ_OPENING_SETTLE_MS;
    const dealSteps = [
      () => {
        bjState.playerHands[0].push(bjDraw());
        bjRenderHands();
        bjAnimatePlayerHandLastCard(0, 'deal');
      },
      () => {
        bjState.dealer.push(bjDraw());
        bjRenderHands();
        bjAnimateDealerLastCard();
      },
      () => {
        bjState.playerHands[0].push(bjDraw());
        bjRenderHands();
        bjAnimatePlayerHandLastCard(0, 'deal');
      },
      () => {
        bjState.dealer.push(bjDraw());
        bjRenderHands();
        bjAnimateDealerLastCard();
      }
    ];

    for (let i = 0; i < dealSteps.length; i++) {
      dealSteps[i]();
      if (openingDelay > 0) {
        await bjWait(openingDelay);
      }
    }

    if (settleMs > 0) {
      await bjWait(settleMs);
    }

    bjState.phase = 'player';

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
        bjState.handOutcomes = ['push'];
        bjFinishRound('Blackjack push', 'tie', 'Both have blackjack. Push.');
        return;
      }
      if (pBJ) {
        const pay = Math.floor((bet * 5) / 2);
        const net = pay - bet;
        w.tokens += pay;
        saveWallet(w);
        bjState.handOutcomes = ['blackjack'];
        bjFinishRound('Player blackjack 3:2', 'jackpot', `Blackjack pays 3:2. Net +${net} FUQ.`);
        return;
      }
      bjState.handOutcomes = ['lose'];
      bjFinishRound('Dealer blackjack', 'lose', `Dealer has blackjack. −${bet} FUQ.`);
      return;
    }

    bjRenderHands();
    bjUiPlayerTurn();
    setGameOutcome('bj', 'pending', 'Hit, stand, double, or split a pair.');
  }

  async function bjHit() {
    if (bjState.phase !== 'player') return;
    const ah = bjState.activeHand;
    const h = bjState.playerHands[ah];
    const hitDelay = bjPrefersReducedMotion() ? 0 : BJ_PLAYER_HIT_DELAY_MS;
    bjState.phase = 'hit';
    h.push(bjDraw());
    bjRenderHands();
    bjAnimatePlayerHandLastCard(ah, 'hit');
    setGameOutcome('bj', 'pending', 'You draw...');
    bjUiPlayerTurn();

    if (hitDelay > 0) {
      await bjWait(hitDelay);
    }

    const total = bjHandValue(h);
    if (total > 21) {
      bjFinishCurrentHandAndAdvance();
    } else if (total === 21) {
      setGameOutcome('bj', 'pending', '21 — standing.');
      bjFinishCurrentHandAndAdvance();
    } else {
      bjState.phase = 'player';
      bjUiPlayerTurn();
      setGameOutcome(
        'bj',
        'pending',
        bjState.playerHands.length > 1 ? `Hand ${ah + 1} — hit, stand, or double.` : 'Hit, stand, or double?'
      );
    }
  }

  function bjStand() {
    if (bjState.phase !== 'player') return;
    bjFinishCurrentHandAndAdvance();
  }

  function bjDouble() {
    if (bjState.phase !== 'player') return;
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
    bjAnimatePlayerHandLastCard(ah, 'hit');

    if (bjHandValue(h) > 21) {
      bjFinishCurrentHandAndAdvance();
      return;
    }
    bjFinishCurrentHandAndAdvance();
  }

  function bjSplit() {
    if (bjState.phase !== 'player') return;
    const ah = bjState.activeHand;
    const h = bjState.playerHands[ah];
    if (!h || h.length !== 2 || h[0].r !== h[1].r) return;
    if (bjState.handDoubled[ah]) return;

    const w = loadWallet();
    const splitStake = bjState.handStakes[ah];
    if (w.tokens < splitStake) {
      setGameOutcome('bj', 'pending', 'Not enough coins to split.');
      return;
    }

    w.tokens -= splitStake;
    saveWallet(w);
    renderWallet(w);

    const c1 = h[0];
    const c2 = h[1];
    bjState.playerHands.splice(ah, 1, [c1], [c2]);
    bjState.handStakes.splice(ah, 1, splitStake, splitStake);
    bjState.handDoubled.splice(ah, 1, false, false);
    bjState.handOutcomes.splice(ah, 1, '', '');
    bjState.activeHand = ah;

    bjState.playerHands[ah].push(bjDraw());
    bjRenderHands();
    bjAnimatePlayerHandLastCard(ah, 'hit');
    const v0 = bjHandValue(bjState.playerHands[ah]);
    if (v0 > 21 || v0 === 21) {
      bjFinishCurrentHandAndAdvance();
      return;
    }
    bjUiPlayerTurn();
    setGameOutcome('bj', 'pending', `Hand ${ah + 1} split. Hit, stand, double, or split again.`);
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

  /** Day boundary is global midnight Mountain Time (America/Denver) so dailies, weeklies,
   *  and the daily bonus reset at the same instant for every player on every device. */
  function todayKey() {
    try {
      const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Denver',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      return fmt.format(new Date());
    } catch (_) {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }

  /** ISO week id (Monday start) computed from the MT day key so the weekly reset also
   *  rolls over at midnight MT for everyone, not at each device's local midnight. */
  function weekKey() {
    const dayStr = todayKey();
    const parts = dayStr.split('-').map(Number);
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
      return `${new Date().getFullYear()}-W01`;
    }
    const [y, m, d] = parts;
    const date = new Date(Date.UTC(y, m - 1, d));
    date.setUTCDate(date.getUTCDate() + 3 - ((date.getUTCDay() + 6) % 7));
    const isoYear = date.getUTCFullYear();
    const weekNum =
      Math.floor((date.getTime() - Date.UTC(isoYear, 0, 4)) / 604800000) + 1;
    const wSafe = Number.isFinite(weekNum) && weekNum > 0 ? weekNum : 1;
    return `${isoYear}-W${String(wSafe).padStart(2, '0')}`;
  }

  function hashDaySeed(day) {
    let h = 2166136261;
    for (let i = 0; i < day.length; i++) {
      h ^= day.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function rng() {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), a | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), a | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function dailyQuestPicker(day) {
    const rng = mulberry32(hashDaySeed(day));
    const pick = (arr) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
    return {
      surge: pick(QUEST_CAT_SURGE),
      grind: pick(QUEST_CAT_GRIND),
      flex: pick(QUEST_CAT_FLEX),
      sampler: pick(QUEST_CAT_SAMPLER)
    };
  }

  /** Fourth daily slot ID only—burns RNG in same order as full pick so migrating 3-slot saves stays consistent */
  function pickDailySamplerAppendOnly(day) {
    const p = dailyQuestPicker(day);
    return p.sampler;
  }

  function pickDailyQuestIds(day) {
    const p = dailyQuestPicker(day);
    return [p.surge, p.grind, p.flex, p.sampler];
  }

  function hashWeekSeed(week) {
    return hashDaySeed(`${week}|arcadeWeekly`);
  }

  function pickWeeklyQuestIds(week) {
    const rng = mulberry32(hashWeekSeed(week));
    const pick = (arr) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
    return [pick(WEEKLY_CAT_ROUNDS), pick(WEEKLY_CAT_EARN)];
  }

  function defaultWeeklyQuestProg() {
    return {
      totalRounds: 0,
      fuqEarned: 0
    };
  }

  function loadWeeklyQuestStateRaw() {
    try {
      const raw = localStorage.getItem(questWeeklyStorageKey());
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (!o || typeof o.week !== 'string' || !Array.isArray(o.ids)) return null;
      return o;
    } catch {
      return null;
    }
  }

  function readGuestQuestBackupBundle() {
    try {
      const raw = localStorage.getItem(GUEST_QUEST_BUNDLE_KEY);
      if (!raw) return null;
      const o = JSON.parse(raw);
      return o && typeof o === 'object' ? o : null;
    } catch {
      return null;
    }
  }

  /** Idempotent: first sign-in after a guest stretch — called from cloud-sync before account keys are used. */
  function snapshotGuestQuestBundleIfNeeded() {
    if (readGuestQuestBackupBundle()) return;
    const dailyRaw = localStorage.getItem(QUEST_STATE_KEY_GUEST);
    const weeklyRaw = localStorage.getItem(WEEKLY_QUEST_STATE_KEY_GUEST);
    try {
      localStorage.setItem(
        GUEST_QUEST_BUNDLE_KEY,
        JSON.stringify({ dailyRaw: dailyRaw || null, weeklyRaw: weeklyRaw || null })
      );
    } catch (_) {
      /**/
    }
  }

  /** Sign-out: restore guest keys from bundle (same session shape as snapshot). */
  function restoreGuestQuestBundleToGuestKeys() {
    const b = readGuestQuestBackupBundle();
    try {
      localStorage.removeItem(GUEST_QUEST_BUNDLE_KEY);
    } catch (_) {
      /**/
    }
    if (!b || typeof b !== 'object') return;
    if (typeof b.dailyRaw === 'string' && b.dailyRaw.length) {
      try {
        localStorage.setItem(QUEST_STATE_KEY_GUEST, b.dailyRaw);
      } catch (_) {
        /**/
      }
    }
    if (typeof b.weeklyRaw === 'string' && b.weeklyRaw.length) {
      try {
        localStorage.setItem(WEEKLY_QUEST_STATE_KEY_GUEST, b.weeklyRaw);
      } catch (_) {
        /**/
      }
    }
  }

  /** One-time: pre-split users had quest progress only in legacy guest keys — seed account slot so cloud sync isn’t empty. */
  function maybeSeedAccountQuestsFromLegacyOnce() {
    if (!isQuestAccountMode()) return;
    try {
      if (localStorage.getItem(ACCOUNT_QUEST_MIGRATION_FLAG)) return;
    } catch (_) {
      return;
    }
    const accD = localStorage.getItem(QUEST_STATE_KEY_ACCOUNT);
    const gD = localStorage.getItem(QUEST_STATE_KEY_GUEST);
    if (!accD && gD) {
      try {
        localStorage.setItem(QUEST_STATE_KEY_ACCOUNT, gD);
        const gW = localStorage.getItem(WEEKLY_QUEST_STATE_KEY_GUEST);
        if (gW) localStorage.setItem(WEEKLY_QUEST_STATE_KEY_ACCOUNT, gW);
      } catch (_) {
        /**/
      }
    }
    try {
      localStorage.setItem(ACCOUNT_QUEST_MIGRATION_FLAG, '1');
    } catch (_) {
      /**/
    }
  }

  const QUEST_CLOUD_DEBOUNCE_MS = 450;
  let questCloudTimer = null;

  function buildQuestCloudPatch() {
    const d = loadQuestState();
    const w = loadWeeklyQuestState();
    return {
      daily: {
        day: d.day,
        ids: d.ids,
        prog: d.prog,
        claimed: d.claimed
      },
      weekly: {
        week: w.week,
        ids: w.ids,
        prog: w.prog,
        claimed: w.claimed
      }
    };
  }

  function scheduleQuestCloudPush() {
    if (!cloudClient?.mergeQuestState || !cloudClient.enabled?.() || !cloudClient.isSignedIn?.()) return;
    if (questCloudTimer) window.clearTimeout(questCloudTimer);
    questCloudTimer = window.setTimeout(() => {
      questCloudTimer = null;
      const patch = buildQuestCloudPatch();
      void cloudClient.mergeQuestState(patch).catch(() => {});
    }, QUEST_CLOUD_DEBOUNCE_MS);
  }

  function saveWeeklyQuestState(state, opts) {
    localStorage.setItem(questWeeklyStorageKey(), JSON.stringify(state));
    if (!opts || !opts.skipCloudPush) scheduleQuestCloudPush();
  }

  function loadWeeklyQuestState() {
    const wk = weekKey();
    let o = loadWeeklyQuestStateRaw();
    if (!o || o.week !== wk) {
      o = {
        week: wk,
        ids: pickWeeklyQuestIds(wk),
        prog: defaultWeeklyQuestProg(),
        claimed: []
      };
      saveWeeklyQuestState(o);
    }
    if (!o.prog || typeof o.prog !== 'object') o.prog = defaultWeeklyQuestProg();
    if (typeof o.prog.totalRounds !== 'number') o.prog.totalRounds = 0;
    if (typeof o.prog.fuqEarned !== 'number') o.prog.fuqEarned = Math.max(0, Math.floor(Number(o.prog.fuqEarned)) || 0);
    delete o.prog.weeklyPlayedSlugs;
    if (!Array.isArray(o.claimed)) o.claimed = [];

    const needIds =
      !Array.isArray(o.ids) ||
      o.ids.length !== 2 ||
      o.ids.some((qid) => !WEEKLY_QUEST_DEFS[qid]);
    if (needIds) {
      o.ids = pickWeeklyQuestIds(wk);
      const next = new Set(o.ids);
      o.claimed = o.claimed.filter((cid) => next.has(cid));
      saveWeeklyQuestState(o);
    }
    return o;
  }

  function weeklyQuestProgressFor(id) {
    const def = WEEKLY_QUEST_DEFS[id];
    if (!def) return 0;
    const st = loadWeeklyQuestState();
    const k = def.progKey;
    if (k === 'fuqEarned') {
      return Math.max(0, Math.floor(Number(st.prog.fuqEarned)) || 0);
    }
    return Math.max(0, Number(st.prog[k]) || 0);
  }

  function weeklyQuestDisplayedProgress(id) {
    const def = WEEKLY_QUEST_DEFS[id];
    if (!def) return 0;
    return Math.min(weeklyQuestProgressFor(id), def.target);
  }

  function bumpWeeklyQuestRound(/* slug kept for callers */) {
    const o = loadWeeklyQuestState();
    o.prog.totalRounds = Math.max(0, Math.floor(Number(o.prog.totalRounds) || 0)) + 1;
    saveWeeklyQuestState(o);
  }

  /** Arcade games only: signed net FUQ toward weekly earn quests (omit daily/quest payouts). */
  function bumpWeeklyFuqEarnedFromGames(netFuq) {
    const net = Number(netFuq) || 0;
    const delta = net >= 0 ? Math.floor(net) : Math.ceil(net);
    if (delta === 0) return;
    const o = loadWeeklyQuestState();
    const cur = Math.max(0, Math.floor(Number(o.prog.fuqEarned) || 0));
    o.prog.fuqEarned = Math.max(0, cur + delta);
    saveWeeklyQuestState(o);
    renderWeeklyQuests();
  }

  function defaultQuestProg() {
    return {
      crashRounds: 0,
      surgeCashHigh: 0,
      surgeCash4: 0,
      bjRounds: 0,
      coinRounds: 0,
      rpsRounds: 0,
      slotsRounds: 0,
      slotsLineHits: 0,
      winsAny: 0,
      uniqueGames: 0,
      playedSlugs: {},
      bjWins: 0,
      bjLong4Wins: 0,
      bjLong5Wins: 0,
      bet25: 0,
      totalRounds: 0,
      crashProfitBanks: 0
    };
  }

  function loadQuestStateRaw() {
    try {
      const raw = localStorage.getItem(questDailyStorageKey());
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (!o || typeof o.day !== 'string' || !Array.isArray(o.ids)) return null;
      return o;
    } catch {
      return null;
    }
  }

  function saveQuestState(state, opts) {
    localStorage.setItem(questDailyStorageKey(), JSON.stringify(state));
    if (!opts || !opts.skipCloudPush) scheduleQuestCloudPush();
  }

  function loadQuestState() {
    const day = todayKey();
    let o = loadQuestStateRaw();
    if (!o || o.day !== day) {
      o = {
        day,
        ids: pickDailyQuestIds(day),
        prog: defaultQuestProg(),
        claimed: []
      };
      saveQuestState(o);
    } else if (o.day === day) {
      const canon = pickDailyQuestIds(day);
      let repaired = false;
      if (!Array.isArray(o.ids)) {
        o.ids = canon.slice();
        o.claimed = [];
        repaired = true;
      } else if (o.ids.length === 3) {
        o.ids.push(pickDailySamplerAppendOnly(day));
        repaired = true;
      } else if (o.ids.length !== 4 || o.ids.some((qid) => !QUEST_DEFS[qid])) {
        const prev = new Set(o.ids);
        o.ids = canon.slice();
        if (Array.isArray(o.claimed)) {
          o.claimed = o.claimed.filter((c) => prev.has(c) && o.ids.includes(c));
        }
        repaired = true;
      }
      if (repaired) saveQuestState(o);
    }
    if (!o.prog || typeof o.prog !== 'object') o.prog = defaultQuestProg();
    if (!o.prog.playedSlugs || typeof o.prog.playedSlugs !== 'object') o.prog.playedSlugs = {};
    const numKeys = ['surgeCash4', 'slotsLineHits', 'crashProfitBanks', 'bjLong4Wins', 'bjLong5Wins'];
    for (let i = 0; i < numKeys.length; i++) {
      const k = numKeys[i];
      if (!(k in o.prog)) o.prog[k] = 0;
    }
    if (!Array.isArray(o.claimed)) o.claimed = [];
    return o;
  }

  function unionQuestClaimed(a, b) {
    const s = new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]);
    return [...s];
  }

  function mergeQuestProgObjects(loc, rem) {
    const out = { ...defaultQuestProg(), ...(loc && typeof loc === 'object' ? loc : {}) };
    const R = rem && typeof rem === 'object' ? rem : {};
    const keys = new Set([...Object.keys(out), ...Object.keys(R)]);
    keys.forEach((k) => {
      if (k === 'playedSlugs') {
        const pm = { ...(out.playedSlugs || {}) };
        const ps = R.playedSlugs && typeof R.playedSlugs === 'object' ? R.playedSlugs : {};
        Object.keys(ps).forEach((g) => {
          pm[g] = Math.max(Math.floor(Number(pm[g]) || 0), Math.floor(Number(ps[g]) || 0));
        });
        out.playedSlugs = pm;
      } else {
        out[k] = Math.max(Math.floor(Number(out[k]) || 0), Math.floor(Number(R[k]) || 0));
      }
    });
    return out;
  }

  function normalizeDailyQuestFromRemote(r, dayFallback) {
    const day = (r && r.day) || dayFallback || todayKey();
    const canon = pickDailyQuestIds(day);
    const ids = Array.isArray(r?.ids) && r.ids.length === 4 ? r.ids.slice() : canon.slice();
    return {
      day,
      ids,
      prog: mergeQuestProgObjects(defaultQuestProg(), r?.prog),
      claimed: unionQuestClaimed([], r?.claimed).filter((id) => ids.includes(id))
    };
  }

  function mergeDailyQuestRemote(localSt, remoteDaily) {
    if (!remoteDaily || typeof remoteDaily !== 'object' || !remoteDaily.day) return localSt;
    const locDay = localSt.day;
    const remDay = remoteDaily.day;
    if (!locDay || locDay < remDay) {
      return normalizeDailyQuestFromRemote(remoteDaily, remDay);
    }
    if (locDay > remDay) return localSt;
    const canon = pickDailyQuestIds(locDay);
    const ids =
      Array.isArray(remoteDaily.ids) && remoteDaily.ids.length === 4 ? remoteDaily.ids.slice() : canon.slice();
    return {
      day: locDay,
      ids,
      prog: mergeQuestProgObjects(localSt.prog, remoteDaily.prog),
      claimed: unionQuestClaimed(localSt.claimed, remoteDaily.claimed).filter((id) => ids.includes(id))
    };
  }

  function normalizeWeeklyQuestFromRemote(r, weekFallback) {
    const week = (r && r.week) || weekFallback || weekKey();
    const canon = pickWeeklyQuestIds(week);
    const ids = Array.isArray(r?.ids) && r.ids.length === 2 ? r.ids.slice() : canon.slice();
    const pr = r?.prog && typeof r.prog === 'object' ? r.prog : {};
    return {
      week,
      ids,
      prog: {
        totalRounds: Math.max(0, Math.floor(Number(pr.totalRounds) || 0)),
        fuqEarned: Math.max(0, Math.floor(Number(pr.fuqEarned) || 0))
      },
      claimed: unionQuestClaimed([], r?.claimed).filter((id) => ids.includes(id))
    };
  }

  function mergeWeeklyQuestRemote(localSt, remoteW) {
    if (!remoteW || typeof remoteW !== 'object' || !remoteW.week) return localSt;
    const locW = localSt.week;
    const remW = remoteW.week;
    if (!locW || locW < remW) {
      return normalizeWeeklyQuestFromRemote(remoteW, remW);
    }
    if (locW > remW) return localSt;
    const canon = pickWeeklyQuestIds(locW);
    const ids =
      Array.isArray(remoteW.ids) && remoteW.ids.length === 2 ? remoteW.ids.slice() : canon.slice();
    const lp = localSt.prog || defaultWeeklyQuestProg();
    const rp = remoteW.prog && typeof remoteW.prog === 'object' ? remoteW.prog : {};
    return {
      week: locW,
      ids,
      prog: {
        totalRounds: Math.max(
          Math.floor(Number(lp.totalRounds) || 0),
          Math.floor(Number(rp.totalRounds) || 0)
        ),
        fuqEarned: Math.max(
          Math.floor(Number(lp.fuqEarned) || 0),
          Math.floor(Number(rp.fuqEarned) || 0)
        )
      },
      claimed: unionQuestClaimed(localSt.claimed, remoteW.claimed).filter((id) => ids.includes(id))
    };
  }

  function applyQuestCloudPayload(qs) {
    if (!qs || typeof qs !== 'object') return;
    if (!isQuestAccountMode()) return;
    let changed = false;
    if (qs.daily && typeof qs.daily === 'object' && qs.daily.day) {
      const next = mergeDailyQuestRemote(loadQuestState(), qs.daily);
      saveQuestState(next, { skipCloudPush: true });
      changed = true;
    }
    if (qs.weekly && typeof qs.weekly === 'object' && qs.weekly.week) {
      const next = mergeWeeklyQuestRemote(loadWeeklyQuestState(), qs.weekly);
      saveWeeklyQuestState(next, { skipCloudPush: true });
      changed = true;
    }
    if (changed) renderQuestPanels();
  }

  function questProgressFor(id) {
    const def = QUEST_DEFS[id];
    if (!def) return 0;
    const st = loadQuestState();
    if (def.progKey === 'uniqueGames') {
      return Object.keys(st.prog.playedSlugs || {}).length;
    }
    return Math.max(0, Number(st.prog[def.progKey]) || 0);
  }

  function questDone(id) {
    const def = QUEST_DEFS[id];
    if (!def) return false;
    return questProgressFor(id) >= def.target;
  }

  /** UI cap so progress never shows past the goal (e.g. 12/8) after you keep playing */
  function questDisplayedProgress(id) {
    const def = QUEST_DEFS[id];
    if (!def) return 0;
    return Math.min(questProgressFor(id), def.target);
  }

  function arcadeNoteBet(amount) {
    const bet = Math.max(0, Math.floor(Number(amount)) || 0);
    if (bet < 25) return;
    const st = loadQuestState();
    if (st.day !== todayKey()) return;
    st.prog.bet25 = Math.max(st.prog.bet25, 1);
    saveQuestState(st);
    renderQuestPanels();
  }

  function arcadeNoteSlotsLineHit() {
    const st = loadQuestState();
    if (st.day !== todayKey()) return;
    st.prog.slotsLineHits += 1;
    saveQuestState(st);
    renderQuestPanels();
  }

  function arcadeNoteCrashProfitBank() {
    const st = loadQuestState();
    if (st.day !== todayKey()) return;
    st.prog.crashProfitBanks += 1;
    saveQuestState(st);
    renderQuestPanels();
  }

  function arcadeNoteRound(slug, betAmount) {
    bumpWeeklyQuestRound();
    const st = loadQuestState();
    if (st.day !== todayKey()) return;
    arcadeNoteBet(betAmount);
    const p = st.prog;
    const sk = `${slug}`;
    if (!p.playedSlugs[sk]) {
      p.playedSlugs[sk] = true;
      p.uniqueGames = Object.keys(p.playedSlugs).length;
    }
    p.totalRounds += 1;
    if (sk === 'bj') p.bjRounds += 1;
    if (sk === 'coin') p.coinRounds += 1;
    if (sk === 'rps') p.rpsRounds += 1;
    if (sk === 'slots') p.slotsRounds += 1;
    if (sk === 'crash') p.crashRounds += 1;
    saveQuestState(st);
    renderQuestPanels();
  }

  function arcadeNoteWin(slug) {
    const st = loadQuestState();
    if (st.day !== todayKey()) return;
    st.prog.winsAny += 1;
    if (slug === 'bj') st.prog.bjWins += 1;
    saveQuestState(st);
    renderQuestPanels();
  }

  function arcadeNoteSurgeCash(mult) {
    const st = loadQuestState();
    if (st.day !== todayKey()) return;
    const m = Number(mult) || 0;
    if (m >= 2.5) st.prog.surgeCashHigh = 1;
    if (m >= 4) st.prog.surgeCash4 = 1;
    saveQuestState(st);
    renderQuestPanels();
  }

  function arcadeNoteBjLongWins(hasLong4, hasLong5) {
    if (!hasLong4 && !hasLong5) return;
    const st = loadQuestState();
    if (st.day !== todayKey()) return;
    if (hasLong4) st.prog.bjLong4Wins += 1;
    if (hasLong5) st.prog.bjLong5Wins += 1;
    saveQuestState(st);
    renderQuestPanels();
  }

  function renderQuestPanels() {
    renderDailyQuests();
    renderWeeklyQuests();
  }

  function loadQuestUiState() {
    try {
      const raw = localStorage.getItem(QUEST_UI_KEY);
      const o = raw ? JSON.parse(raw) : {};
      return {
        dailyCollapsed: !!o.dailyCollapsed,
        weeklyCollapsed: !!o.weeklyCollapsed
      };
    } catch {
      return { dailyCollapsed: false, weeklyCollapsed: false };
    }
  }

  function saveQuestUiState(next) {
    localStorage.setItem(
      QUEST_UI_KEY,
      JSON.stringify({
        dailyCollapsed: !!next.dailyCollapsed,
        weeklyCollapsed: !!next.weeklyCollapsed
      })
    );
  }

  function applyQuestCollapseState() {
    const ui = loadQuestUiState();
    const mapping = [
      ['daily', ui.dailyCollapsed],
      ['weekly', ui.weeklyCollapsed]
    ];
    mapping.forEach(([slug, collapsed]) => {
      const sec = document.querySelector(`.games-${slug}-quests`);
      const body = document.getElementById(`${slug}-quests-body`);
      const btn = document.getElementById(`${slug}-quests-toggle`);
      if (!sec || !body || !btn) return;
      sec.classList.toggle('games-quest-panel--collapsed', collapsed);
      body.hidden = collapsed;
      btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      btn.textContent = collapsed ? 'Expand' : 'Collapse';
    });
  }

  function initQuestCollapseControls() {
    applyQuestCollapseState();
    const dailyBtn = document.getElementById('daily-quests-toggle');
    const weeklyBtn = document.getElementById('weekly-quests-toggle');
    if (dailyBtn) {
      dailyBtn.addEventListener('click', () => {
        const ui = loadQuestUiState();
        ui.dailyCollapsed = !ui.dailyCollapsed;
        saveQuestUiState(ui);
        applyQuestCollapseState();
      });
    }
    if (weeklyBtn) {
      weeklyBtn.addEventListener('click', () => {
        const ui = loadQuestUiState();
        ui.weeklyCollapsed = !ui.weeklyCollapsed;
        saveQuestUiState(ui);
        applyQuestCollapseState();
      });
    }
  }

  function initGameRulesDisclosures() {
    const desktopMq = window.matchMedia('(min-width: 960px)');
    const openByDefault = desktopMq.matches;
    document.querySelectorAll('.games-card > .games-rules').forEach((rulesP) => {
      if (rulesP.parentElement?.classList.contains('games-rules-details')) return;
      const wrap = document.createElement('details');
      wrap.className = 'games-rules-details';
      wrap.open = openByDefault;
      const sum = document.createElement('summary');
      sum.className = 'games-rules-summary';
      sum.textContent = 'How it works';
      rulesP.parentNode.insertBefore(wrap, rulesP);
      wrap.appendChild(sum);
      wrap.appendChild(rulesP);
    });
  }

  function renderDailyQuests() {
    const root = document.getElementById('games-daily-quests-list');
    if (!root) return;
    const st = loadQuestState();
    root.innerHTML = '';
    let doneCount = 0;
    st.ids.forEach((qid) => {
      const def = QUEST_DEFS[qid];
      if (!def) return;
      const cur = questProgressFor(qid);
      const displayCur = questDisplayedProgress(qid);
      const claimed = st.claimed.includes(qid);
      const done = cur >= def.target;
      if (claimed) doneCount += 1;
      const pct = Math.min(100, (displayCur / def.target) * 100);
      const li = document.createElement('li');
      li.className = 'games-daily-quest-item';
      if (claimed) li.classList.add('games-daily-quest-item--claimed');

      const row = document.createElement('div');
      row.className = 'games-daily-quest-top';
      const text = document.createElement('div');
      text.className = 'games-daily-quest-text';
      const metaText = claimed
        ? `Claimed · +${def.reward} FUQ`
        : `${displayCur}/${def.target} · +${def.reward} FUQ`;
      const flavor = def.flavor ? `<span class="games-daily-quest-flavor">${escapeHtml(def.flavor)}</span>` : '';
      text.innerHTML = `
        <span class="games-daily-quest-title">${escapeHtml(def.title)}</span>
        ${flavor}
        <span class="games-daily-quest-meta">${metaText}</span>
      `;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'games-daily-quest-claim';
      if (claimed) {
        btn.disabled = true;
        btn.textContent = 'DONE';
      } else if (done) {
        btn.textContent = 'CLAIM';
        btn.addEventListener('click', () => claimDailyQuest(qid));
      } else {
        btn.disabled = true;
        btn.textContent = '···';
      }
      row.appendChild(text);
      row.appendChild(btn);

      const track = document.createElement('div');
      track.className = 'games-daily-quest-track';
      track.setAttribute('aria-hidden', 'true');
      track.innerHTML = `<span class="games-daily-quest-fill" style="width:${pct}%"></span>`;

      li.appendChild(row);
      li.appendChild(track);
      root.appendChild(li);
    });
    const sum = document.getElementById('daily-quests-summary');
    if (sum) sum.textContent = `${doneCount}/${st.ids.length}`;
    const allClaimed = st.ids.length > 0 && doneCount >= st.ids.length;
    const sec = document.querySelector('.games-daily-quests');
    const body = document.getElementById('daily-quests-body');
    const btn = document.getElementById('daily-quests-toggle');
    const note = document.getElementById('daily-quests-closed-note');
    if (allClaimed) {
      const ui = loadQuestUiState();
      if (!ui.dailyCollapsed) {
        ui.dailyCollapsed = true;
        saveQuestUiState(ui);
      }
      if (sec) sec.classList.add('games-quest-panel--collapsed');
      if (body) body.hidden = true;
      if (btn) {
        btn.disabled = true;
        btn.setAttribute('aria-expanded', 'false');
        btn.textContent = 'Done today';
      }
      if (note) note.hidden = false;
    } else {
      if (btn) btn.disabled = false;
      if (note) note.hidden = true;
      applyQuestCollapseState();
    }
  }

  function renderWeeklyQuests() {
    const root = document.getElementById('games-weekly-quests-list');
    if (!root) return;
    const st = loadWeeklyQuestState();
    root.innerHTML = '';
    let doneCount = 0;
    st.ids.forEach((qid) => {
      const def = WEEKLY_QUEST_DEFS[qid];
      if (!def) return;
      const cur = weeklyQuestProgressFor(qid);
      const displayCur = weeklyQuestDisplayedProgress(qid);
      const claimed = st.claimed.includes(qid);
      const done = cur >= def.target;
      if (claimed) doneCount += 1;
      const pct = Math.min(100, (displayCur / def.target) * 100);
      const li = document.createElement('li');
      li.className = 'games-weekly-quest-item';
      if (claimed) li.classList.add('games-weekly-quest-item--claimed');

      const row = document.createElement('div');
      row.className = 'games-weekly-quest-top';
      const text = document.createElement('div');
      text.className = 'games-weekly-quest-text';
      const metaText = claimed
        ? `Claimed · +${def.reward} FUQ`
        : def.progKey === 'fuqEarned'
          ? `${displayCur.toLocaleString()} / ${def.target.toLocaleString()} net FUQ from games · +${def.reward} FUQ`
          : `${displayCur}/${def.target} rounds · +${def.reward} FUQ`;
      const flavor = def.flavor ? `<span class="games-weekly-quest-flavor">${escapeHtml(def.flavor)}</span>` : '';
      text.innerHTML = `
        <span class="games-weekly-quest-title">${escapeHtml(def.title)}</span>
        ${flavor}
        <span class="games-weekly-quest-meta">${metaText}</span>
      `;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'games-weekly-quest-claim';
      if (claimed) {
        btn.disabled = true;
        btn.textContent = 'DONE';
      } else if (done) {
        btn.textContent = 'CLAIM';
        btn.addEventListener('click', () => claimWeeklyQuest(qid));
      } else {
        btn.disabled = true;
        btn.textContent = '···';
      }
      row.appendChild(text);
      row.appendChild(btn);

      const track = document.createElement('div');
      track.className = 'games-weekly-quest-track';
      track.setAttribute('aria-hidden', 'true');
      track.innerHTML = `<span class="games-weekly-quest-fill" style="width:${pct}%"></span>`;

      li.appendChild(row);
      li.appendChild(track);
      root.appendChild(li);
    });
    const sum = document.getElementById('weekly-quests-summary');
    if (sum) sum.textContent = `${doneCount}/${st.ids.length}`;
  }

  function claimWeeklyQuest(qid) {
    const st = loadWeeklyQuestState();
    if (st.week !== weekKey() || st.claimed.includes(qid)) return;
    const def = WEEKLY_QUEST_DEFS[qid];
    if (!def || weeklyQuestProgressFor(qid) < def.target) return;
    st.claimed.push(qid);
    saveWeeklyQuestState(st);
    const w = loadWallet();
    w.tokens += def.reward;
    saveWallet(w);
    renderWallet(w);
    pushHistory('quest_weekly', `Weekly: ${def.title.slice(0, 36)}`, def.reward, w.tokens, {
      quest_period_key: weekKey(),
      quest_id: qid
    });
    renderWeeklyQuests();
  }

  function claimDailyQuest(qid) {
    const st = loadQuestState();
    if (st.day !== todayKey() || st.claimed.includes(qid)) return;
    const def = QUEST_DEFS[qid];
    if (!def || questProgressFor(qid) < def.target) return;
    st.claimed.push(qid);
    saveQuestState(st);
    const w = loadWallet();
    w.tokens += def.reward;
    saveWallet(w);
    renderWallet(w);
    pushHistory('quest', `Quest: ${def.title.slice(0, 40)}`, def.reward, w.tokens, {
      quest_period_key: todayKey(),
      quest_id: qid
    });
    renderQuestPanels();
  }

  /** Nearest whole FUQ; .5 fractional parts round up (e.g. 12.5 → 13). */
  function crashCashPayoutTokens(bet, mult) {
    return Math.max(0, Math.round(bet * mult));
  }

  function crashFmtAura(mult) {
    return `${mult.toFixed(2)}× aura`;
  }

  const crashRuntime = {
    active: false,
    /** True from round start until crash or aborted for a new round (still ticks after BANK). */
    roundLive: false,
    timerId: null,
    crashPoint: 2,
    mult: 1,
    bet: 0,
    crashed: false,
    /** Multiplier at BANK AURA (for crash-after-bank copy only). */
    bankMult: null,
    multHistory: [],
    wobblePhaseA: null,
    wobblePhaseB: null,
    riderCelebrate: false,
    /** Win-board rider after crash when player already banked this round. */
    bustedAfterBank: false
  };

  function crashChartSetRunning(on) {
    document.querySelector('.games-crash-chart')?.classList.toggle('games-crash-chart--running', !!on);
  }

  function crashReadoutsSetAuraHeadline(on) {
    document
      .querySelector('.games-crash-readouts')
      ?.classList.toggle('games-crash-readouts--aura-headline', !!on);
  }

  function crashReadoutsSetBankShown(on) {
    document
      .querySelector('.games-crash-readouts')
      ?.classList.toggle('games-crash-readouts--bank-shown', !!on);
  }

  function crashClearCrashCheckDisplay() {
    const el = document.getElementById('crash-crash-check');
    if (el) {
      el.textContent = '';
      el.hidden = true;
    }
    crashReadoutsSetAuraHeadline(false);
  }

  function crashSetCrashCheckDisplay(bustAtFixed) {
    const el = document.getElementById('crash-crash-check');
    if (el) {
      el.textContent = `Aura Check @ ${bustAtFixed}×`;
      el.hidden = false;
    }
    crashReadoutsSetAuraHeadline(true);
  }

  function crashResetMultPresentation() {
    const multEl = document.getElementById('crash-mult-display');
    multEl?.classList.remove('games-crash-mult--spectate', 'games-crash-mult--concealed');
  }

  function crashBankSummaryHide() {
    const wrap = document.getElementById('crash-bank-summary');
    if (wrap) wrap.hidden = true;
    const check = document.getElementById('crash-summary-check');
    check?.classList.remove('games-crash-bank-summary-line--final');
    crashReadoutsSetBankShown(false);
  }

  /** After BANK: show locked-out mult; crash line pending until Aura Check. */
  function crashBankSummaryShowCashedOut(bankMult) {
    const wrap = document.getElementById('crash-bank-summary');
    const cashed = document.getElementById('crash-summary-cashed');
    const check = document.getElementById('crash-summary-check');
    if (!wrap || !cashed || !check) return;
    wrap.hidden = false;
    cashed.textContent = `Cashed out at ${bankMult.toFixed(2)}×`;
    check.textContent = 'Aura Check: wave still running…';
    check.classList.remove('games-crash-bank-summary-line--final');
    crashReadoutsSetBankShown(true);
  }

  /** After crash (banked earlier): cashed mult + Aura Check only. */
  function crashBankSummaryShowFinal(bankMult, bustAt) {
    const wrap = document.getElementById('crash-bank-summary');
    const cashed = document.getElementById('crash-summary-cashed');
    const check = document.getElementById('crash-summary-check');
    if (!wrap || !cashed || !check) return;
    wrap.hidden = false;
    cashed.textContent = `Cashed out at ${bankMult.toFixed(2)}×`;
    check.textContent = `Aura Check @ ${bustAt.toFixed(2)}×`;
    check.classList.add('games-crash-bank-summary-line--final');
    crashReadoutsSetBankShown(true);
  }

  function crashUpdateSpectateUi() {
    const hint = document.getElementById('crash-spectate-hint');
    const summary = document.getElementById('crash-bank-summary');
    const stage = document.querySelector('.games-crash-stage');
    const multEl = document.getElementById('crash-mult-display');
    const btn = document.getElementById('crash-main-btn');
    const show =
      crashRuntime.roundLive && !crashRuntime.active && !crashRuntime.crashed;
    const summaryVisible = summary && !summary.hidden;
    if (hint) hint.hidden = !show || !!summaryVisible;
    stage?.classList.toggle('games-crash-stage--spectate', !!show);
    multEl?.classList.toggle('games-crash-mult--spectate', !!show);
    btn?.classList.toggle('games-crash-btn-main--spectate', !!show);
  }

  /** Stop an in-flight round (spectate or abandoned) when starting a new bet. */
  function crashAbortInflightRound() {
    if (crashRuntime.timerId) {
      clearTimeout(crashRuntime.timerId);
      crashRuntime.timerId = null;
    }
    crashRuntime.roundLive = false;
    crashRuntime.active = false;
    crashRuntime.crashed = false;
    crashRuntime.bankMult = null;
    crashRuntime.bustedAfterBank = false;
    /* Keep chart “running” styling on — crashChartInitRound() sets it true next; toggling off/on caused a 1-frame flicker */
    document.querySelector('.games-crash-chart')?.classList.remove(
      'games-crash-chart--bust',
      'games-crash-chart--bust-safe'
    );
    crashRuntime.multHistory = [];
    crashClearCrashCheckDisplay();
    crashBankSummaryHide();
    crashResetMultPresentation();
    crashUpdateSpectateUi();
    const multEl = document.getElementById('crash-mult-display');
    if (multEl) {
      multEl.hidden = false;
      multEl.classList.remove('games-crash-mult--concealed');
      multEl.textContent = '1.00× aura';
    }
    crashChartRender();
  }

  function crashRiderHide() {
    const rider = document.getElementById('crash-rider');
    if (rider) {
      rider.hidden = true;
      rider.removeAttribute('src');
    }
  }

  /**
   * @returns {boolean} true if rider visible (suppress SVG head dot).
   */
  function crashRiderSync(pts, lastXY) {
    const chart = document.querySelector('.games-crash-chart');
    const rider = document.getElementById('crash-rider');
    if (!chart || !rider || !pts.length) {
      crashRiderHide();
      return false;
    }

    let tiltDeg = -10;
    if (pts.length >= 2) {
      const pa = pts[pts.length - 2].split(',').map(Number);
      const pb = pts[pts.length - 1].split(',').map(Number);
      const dx = pb[0] - pa[0];
      const dy = pb[1] - pa[1];
      if (Math.abs(dx) + Math.abs(dy) > 0.02) {
        tiltDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
      }
      const minHoriz = 0.52;
      if (Math.abs(dx) < minHoriz && Math.abs(dx) + Math.abs(dy) > 0.04) {
        const t = Math.abs(dx) / minHoriz;
        tiltDeg = tiltDeg * t + -9 * (1 - t);
      }
      tiltDeg = Math.max(-28, Math.min(26, tiltDeg));
    }

    const riderYy = Math.min(50.65, lastXY[1] + 0.38);
    chart.style.setProperty('--crash-rider-x', `${lastXY[0]}%`);
    chart.style.setProperty('--crash-rider-y', `${(riderYy / 56) * 100}%`);
    chart.style.setProperty('--crash-rider-tilt', `${tiltDeg}deg`);
    chart.style.setProperty('--crash-rider-ax', String(CRASH_RIDER_ANCHOR_AX));
    chart.style.setProperty('--crash-rider-ay', String(CRASH_RIDER_ANCHOR_AY));

    let src = '';
    let on = false;
    if (crashRuntime.roundLive && !crashRuntime.crashed) {
      src =
        crashRuntime.mult >= CRASH_RIDER_HOT_MULT ? CRASH_RIDER_ART.farmHot : CRASH_RIDER_ART.farm;
      on = true;
    } else if (crashRuntime.crashed && crashRuntime.bustedAfterBank) {
      src = CRASH_RIDER_ART.win;
      on = true;
    } else if (crashRuntime.crashed) {
      src = CRASH_RIDER_ART.lose;
      on = true;
    } else if (crashRuntime.riderCelebrate) {
      src = CRASH_RIDER_ART.win;
      on = true;
    }

    if (!on) {
      crashRiderHide();
      return false;
    }

    rider.hidden = false;
    rider.src = src;
    rider.alt = '';
    return true;
  }

  /** Map multiplier → chart Y; multCap expands the vertical scale so the trace uses the panel. */
  function crashChartYFromMult(mult, multCap) {
    const cap = Math.min(
      CRASH_CHART_MULT_VIS_MAX,
      typeof multCap === 'number' && multCap > 1 ? multCap : CRASH_CHART_MULT_VIS_MAX
    );
    const yBottom = 52;
    const ySpan = yBottom - CRASH_CHART_Y_VIEW_TOP;
    const mx = cap - 1;
    const clamped = Math.min(Math.max(mult, 1), cap);
    const t = (clamped - 1) / mx;
    const skew = Math.pow(t, CRASH_CHART_Y_CURVE);
    return yBottom - skew * ySpan;
  }

  function crashChartMultCapForHist(hist) {
    let run = 1;
    for (let i = 0; i < hist.length; i++) {
      if (hist[i] > run) run = hist[i];
    }
    const padded = Math.ceil(run * 118) / 100;
    return Math.min(CRASH_CHART_MULT_VIS_MAX, Math.max(3.05, padded));
  }

  function crashChartClearDynamicGrids() {
    const g = document.getElementById('crash-chart-hgrid');
    if (!g) return;
    while (g.firstChild) g.removeChild(g.firstChild);
  }

  function crashChartRebuildDynamicGrids(multCap) {
    const svgNS = 'http://www.w3.org/2000/svg';
    const gH = document.getElementById('crash-chart-hgrid');
    const yBottom = 52;
    const yTopPlot = CRASH_CHART_Y_VIEW_TOP - 2;
    const xPlotEnd = 97.5;

    if (!gH) return;
    while (gH.firstChild) gH.removeChild(gH.firstChild);
    [0.22, 0.45, 0.68].forEach((u) => {
      const mm = 1 + (multCap - 1) * u;
      const y = crashChartYFromMult(mm, multCap);
      if (y <= yTopPlot + 0.5 || y >= yBottom - 0.35) return;
      const ln = document.createElementNS(svgNS, 'line');
      ln.setAttribute('x1', '1.75');
      ln.setAttribute('x2', String(xPlotEnd));
      ln.setAttribute('y1', String(y));
      ln.setAttribute('y2', String(y));
      ln.setAttribute('class', 'games-crash-chart-dyn-grid games-crash-chart-dyn-grid--h');
      gH.appendChild(ln);
    });
  }

  function crashChartWobbleOff() {
    try {
      return (
        typeof window !== 'undefined' &&
        window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      );
    } catch {
      return false;
    }
  }

  function crashChartTrimTrailEnd(pts, trim) {
    if (!pts?.length || trim <= 0) return pts.slice();
    if (pts.length < 2) return pts.slice();
    const pb = pts[pts.length - 1].split(',').map(Number);
    const pa = pts[pts.length - 2].split(',').map(Number);
    let dx = pb[0] - pa[0];
    let dy = pb[1] - pa[1];
    const len = Math.hypot(dx, dy);
    if (len < 0.015) return pts.slice();
    const frac = trim / len;
    if (frac >= 1) {
      const rest = pts.slice(0, -1);
      return rest.length >= 2 ? rest : pts.slice();
    }
    dx /= len;
    dy /= len;
    const nx = pb[0] - dx * trim;
    const ny = pb[1] - dy * trim;
    return [...pts.slice(0, -1), `${nx},${ny}`];
  }

  function crashChartSquiggleOffset(i) {
    if (crashChartWobbleOff()) return { dx: 0, dy: 0 };
    const a = crashRuntime.wobblePhaseA;
    const b = crashRuntime.wobblePhaseB;
    if (a == null || b == null) return { dx: 0, dy: 0 };
    let dy =
      Math.sin(i * CRASH_CHART_WOBBLE_I1 + a) * CRASH_CHART_WOBBLE_AMP_Y1 +
      Math.sin(i * CRASH_CHART_WOBBLE_I2 + b) * CRASH_CHART_WOBBLE_AMP_Y2;
    let dx = Math.cos(i * CRASH_CHART_WOBBLE_IX + a * 0.65) * CRASH_CHART_WOBBLE_AMP_X;
    const damp = Math.min(1, 7 / (7 + Math.max(0, i)));
    dx *= damp;
    dy *= damp;
    return { dx, dy };
  }

  function crashChartRender() {
    const hist = crashRuntime.multHistory;
    const line = document.getElementById('crash-chart-line');
    const fill = document.getElementById('crash-chart-fill');
    const head = document.getElementById('crash-chart-head');
    if (!line || !head) return;
    if (!hist.length) {
      line.setAttribute('points', '');
      fill?.setAttribute('points', '');
      head.setAttribute('opacity', '0');
      crashRiderHide();
      crashChartClearDynamicGrids();
      return;
    }
    const n = hist.length;
    const yBottom = 52;
    const span = CRASH_CHART_X_RIGHT_CAP - CRASH_CHART_X_LEFT;
    const headX = CRASH_CHART_X_LEFT + span * CRASH_CHART_X_ASYM * (n / (n + CRASH_CHART_X_TAIL_PAD));
    const multCap = crashChartMultCapForHist(hist);

    const pts = hist.map((m, i) => {
      let xFrac;
      if (n === 1) xFrac = 0.14;
      else {
        const u = Math.max(i / (n - 1), 1e-9);
        xFrac = Math.pow(u, CRASH_CHART_X_EASE);
      }
      let x = CRASH_CHART_X_LEFT + (headX - CRASH_CHART_X_LEFT) * xFrac;
      let y = crashChartYFromMult(m, multCap);
      const { dx, dy } = crashChartSquiggleOffset(i);
      x += dx;
      y += dy;
      return `${x},${y}`;
    });
    const ptsDraw = crashChartTrimTrailEnd(pts, CRASH_CHART_TAIL_TRIM);
    const pointsAttr = ptsDraw.join(' ');
    line.setAttribute('points', pointsAttr);
    if (fill && ptsDraw.length >= 2) {
      const first = ptsDraw[0].split(',').map(Number);
      const last = ptsDraw[ptsDraw.length - 1].split(',').map(Number);
      fill.setAttribute(
        'points',
        `${pointsAttr} ${last[0]},${yBottom} ${first[0]},${yBottom}`
      );
    } else if (fill && ptsDraw.length === 1) {
      const [sx, sy] = ptsDraw[0].split(',').map(Number);
      fill.setAttribute('points', `${sx},${sy} ${sx},${yBottom} ${sx},${yBottom}`);
    } else if (fill) {
      fill.setAttribute('points', '');
    }
    const lastXY = ptsDraw[ptsDraw.length - 1].split(',').map(Number);
    head.setAttribute('cx', String(lastXY[0]));
    head.setAttribute('cy', String(lastXY[1]));
    const riderOn = crashRiderSync(ptsDraw, lastXY);
    head.setAttribute('opacity', riderOn ? '0' : '1');

    crashChartRebuildDynamicGrids(multCap);
  }

  function crashChartInitRound() {
    crashRuntime.multHistory = [1];
    crashRuntime.wobblePhaseA = Math.random() * Math.PI * 2;
    crashRuntime.wobblePhaseB = Math.random() * Math.PI * 2;
    crashRuntime.riderCelebrate = false;
    crashRuntime.bustedAfterBank = false;
    crashClearCrashCheckDisplay();
    crashBankSummaryHide();
    crashResetMultPresentation();
    const wrap = document.querySelector('.games-crash-chart');
    wrap?.classList.remove('games-crash-chart--bust', 'games-crash-chart--bust-safe');
    crashChartSetRunning(true);
    crashChartRender();
  }

  function crashChartSetBust(safeAfterBank) {
    crashChartSetRunning(false);
    const wrap = document.querySelector('.games-crash-chart');
    if (!wrap) return;
    wrap.classList.remove('games-crash-chart--bust', 'games-crash-chart--bust-safe');
    wrap.classList.add(safeAfterBank ? 'games-crash-chart--bust-safe' : 'games-crash-chart--bust');
  }

  /**
   * Crash-point tail (~inverse-power); numerator near 1 targets competitive crash RTP (~97–99%).
   * See scripts/aura-farm-monte-carlo.mjs for sampled stats.
   */
  function sampleCrashPoint() {
    const u = Math.max(1e-9, Math.random());
    let m = 0.99 / Math.pow(u, 0.92);
    m = Math.min(88, Math.max(1.02, m));
    return Math.round(m * 100) / 100;
  }

  /** Cloud settle payload for Aura peak (server clamps 1–89). */
  function crashPeakForCloud(mult) {
    const m = Number(mult);
    if (!Number.isFinite(m)) return undefined;
    return Math.round(Math.min(Math.max(m, 1), 89) * 100) / 100;
  }

  function crashTick() {
    if (!crashRuntime.roundLive || crashRuntime.crashed) return;
    crashRuntime.mult += 0.012 + crashRuntime.mult * 0.0048 + Math.random() * 0.01;
    crashRuntime.mult = Math.round(crashRuntime.mult * 100) / 100;
    const el = document.getElementById('crash-mult-display');
    if (el) {
      el.hidden = false;
      el.classList.remove('games-crash-mult--concealed');
      el.textContent = crashFmtAura(crashRuntime.mult);
    }
    crashRuntime.multHistory.push(crashRuntime.mult);
    while (crashRuntime.multHistory.length > CRASH_CHART_MAX_POINTS) {
      crashRuntime.multHistory.shift();
    }
    crashChartRender();
    crashUpdateSpectateUi();
    if (crashRuntime.mult >= crashRuntime.crashPoint) {
      crashBust();
      return;
    }
    crashRuntime.timerId = window.setTimeout(crashTick, CRASH_TICK_MS);
  }

  function crashUpdatePrimaryBtn(running) {
    const btn = document.getElementById('crash-main-btn');
    if (!btn) return;
    if (running) {
      btn.textContent = 'BANK AURA';
      btn.classList.add('games-crash-btn--cashout');
      btn.removeAttribute('disabled');
      btn.setAttribute('aria-pressed', 'true');
      btn.setAttribute(
        'aria-label',
        'Bank your aura now at the current multiplier and lock in FUQ payout'
      );
    } else {
      btn.textContent = 'FARM AURA';
      btn.classList.remove('games-crash-btn--cashout');
      btn.removeAttribute('disabled');
      btn.setAttribute('aria-pressed', 'false');
      btn.setAttribute('aria-label', 'Start aura farming with the selected stake');
    }
  }

  function crashBust() {
    const alreadyBanked = !crashRuntime.active;
    crashRuntime.active = false;
    crashRuntime.roundLive = false;
    crashRuntime.crashed = true;
    if (crashRuntime.timerId) {
      clearTimeout(crashRuntime.timerId);
      crashRuntime.timerId = null;
    }
    crashUpdatePrimaryBtn(false);
    const bustAt = crashRuntime.crashPoint.toFixed(2);
    const stacked = crashRuntime.mult.toFixed(2);

    if (!alreadyBanked) {
      crashBankSummaryHide();
      applyArcadeWinStreak('crash', 'lose');
      const wBust = loadWallet();
      pushHistory(
        'crash',
        `Aura Check @ ${bustAt}× — stacked ${stacked}×`,
        -crashRuntime.bet,
        wBust.tokens,
        { crash_peak_mult: crashPeakForCloud(crashRuntime.mult), wager_amount: crashRuntime.bet }
      );
      setGameOutcome(
        'crash',
        'lose',
        `Aura Check hit at ${bustAt}× - you had ${stacked}× aura stacked`
      );
      addRakebackFromLoss(-crashRuntime.bet);
      arcadeNoteRound('crash', crashRuntime.bet);
    } else {
      const bankedStr =
        crashRuntime.bankMult != null ? crashRuntime.bankMult.toFixed(2) : '—';
      const bk = crashRuntime.bankMult != null ? crashRuntime.bankMult : 1;
      crashBankSummaryShowFinal(bk, crashRuntime.crashPoint);
      setGameOutcome(
        'crash',
        'win',
        `Cashed out at ${bankedStr}× · Aura Check @ ${bustAt}×`
      );
    }

    crashRuntime.bankMult = null;
    if (alreadyBanked) {
      crashRuntime.bustedAfterBank = true;
      crashRuntime.riderCelebrate = true;
    } else {
      crashRuntime.bustedAfterBank = false;
      crashRuntime.riderCelebrate = false;
    }
    crashChartSetBust(!!alreadyBanked);
    if (alreadyBanked) {
      crashClearCrashCheckDisplay();
    } else {
      crashSetCrashCheckDisplay(bustAt);
    }
    const el = document.getElementById('crash-mult-display');
    if (el) {
      el.hidden = false;
      crashResetMultPresentation();
      if (alreadyBanked) {
        el.textContent = '\u00a0';
        el.classList.add('games-crash-mult--concealed');
      } else {
        el.textContent = 'RIP AURA';
      }
    }
    crashUpdateSpectateUi();
    crashChartRender();
    wireBetRadiosState('crash-bet', true);
  }

  function crashCashOut() {
    if (!crashRuntime.active || crashRuntime.crashed) return;
    const bet = crashRuntime.bet;
    const mult = crashRuntime.mult;
    crashRuntime.active = false;
    crashRuntime.bankMult = mult;
    crashUpdatePrimaryBtn(false);
    crashChartSetRunning(true);
    wireBetRadiosState('crash-bet', true);
    crashBankSummaryShowCashedOut(mult);
    crashUpdateSpectateUi();
    const payout = crashCashPayoutTokens(bet, mult);
    const w = loadWallet();
    w.tokens += payout;
    saveWallet(w);
    renderWallet(w);
    const net = payout - bet;
    arcadeNoteSurgeCash(mult);
    arcadeNoteRound('crash', bet);
    bumpWeeklyFuqEarnedFromGames(net);
    if (net > 0) {
      arcadeNoteCrashProfitBank();
      arcadeNoteWin('crash');
    }
    const mood = net > 0 ? 'win' : net < 0 ? 'lose' : 'tie';
    {
      const st = loadWinStreaks();
      if (st.crash) {
        st.crash.peakBankMult = Math.max(Number(st.crash.peakBankMult) || 0, mult);
        saveWinStreaks(st);
      }
    }
    applyArcadeWinStreak('crash', mood === 'tie' ? 'tie' : mood);
    pushHistory(
      'crash',
      net > 0
        ? `Farmed ${mult.toFixed(2)}× · +${net} FUQ (paid ${payout})`
        : net < 0
          ? `Farmed ${mult.toFixed(2)}× · ${net} FUQ (paid ${payout})`
          : `Farmed ${mult.toFixed(2)}× · even (paid ${payout})`,
      net,
      w.tokens,
      { crash_peak_mult: crashPeakForCloud(mult), wager_amount: bet }
    );
    setGameOutcome(
      'crash',
      mood,
      net > 0
        ? `Farmed ${mult.toFixed(2)}× aura. +${net} FUQ (paid ${payout})`
        : net < 0
          ? `Farmed ${mult.toFixed(2)}× aura. ${net} FUQ (paid ${payout})`
          : `Farmed ${mult.toFixed(2)}× aura. break-even (${payout} FUQ)`
    );
    crashRuntime.riderCelebrate = net >= 0;
    crashChartRender();
  }

  function wireBetRadiosState(name, enabled) {
    document.querySelectorAll(`input[name="${name}"]`).forEach((inp) => {
      inp.disabled = !enabled;
    });
  }

  function crashStartRound() {
    if (crashRuntime.active) return;
    if (crashRuntime.roundLive && !crashRuntime.crashed) {
      crashAbortInflightRound();
    }
    crashRuntime.riderCelebrate = false;
    crashRuntime.bustedAfterBank = false;
    const bet = getBetAmount('crash-bet');
    const w = loadWallet();
    if (w.tokens < bet) {
      setGameOutcome('crash', 'pending', 'Need more FUQ to farm aura.');
      return;
    }
    w.tokens -= bet;
    saveWallet(w);
    renderWallet(w);
    arcadeNoteBet(bet);
    crashRuntime.bet = bet;
    crashRuntime.crashPoint = sampleCrashPoint();
    crashRuntime.mult = 1;
    crashRuntime.crashed = false;
    crashRuntime.bankMult = null;
    crashRuntime.roundLive = true;
    crashRuntime.active = true;
    crashUpdatePrimaryBtn(true);
    wireBetRadiosState('crash-bet', false);
    setGameOutcome('crash', 'pending', 'Aura climbing… farm carefully.');
    const el = document.getElementById('crash-mult-display');
    if (el) {
      el.hidden = false;
      el.classList.remove('games-crash-mult--concealed');
      el.textContent = crashFmtAura(1);
    }
    crashChartInitRound();
    crashRuntime.timerId = window.setTimeout(crashTick, CRASH_TICK_MS);
  }

  function initCrashGame() {
    document.getElementById('crash-main-btn')?.addEventListener('click', () => {
      if (crashRuntime.active && !crashRuntime.crashed) crashCashOut();
      else crashStartRound();
    });
    wireBetRadios('crash-bet', 'crash');
    crashUpdatePrimaryBtn(false);
  }

  function loadWallet() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return { tokens: DEFAULT_TOKENS, coinStreak: 0, lastDaily: '', rakebackPool: 0 };
      }
      const w = JSON.parse(raw);
      return {
        tokens: Math.max(0, Math.floor(Number(w.tokens)) || 0),
        coinStreak: Math.max(0, Math.floor(Number(w.coinStreak)) || 0),
        lastDaily: typeof w.lastDaily === 'string' ? w.lastDaily : '',
        rakebackPool: Math.max(0, Math.round(Number(w.rakebackPool) * 100) / 100) || 0
      };
    } catch {
      return { tokens: DEFAULT_TOKENS, coinStreak: 0, lastDaily: '', rakebackPool: 0 };
    }
  }

  function saveWallet(w, opts) {
    w.tokens = Math.max(0, Math.floor(w.tokens));
    w.coinStreak = Math.max(0, Math.floor(w.coinStreak));
    if (typeof w.rakebackPool !== 'number') w.rakebackPool = 0;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(w));
  }

  /** After a successful settlement, server tokens are authoritative; merge streak/daily defensively. */
  function mergeLastDailyStr(a, b) {
    const x = typeof a === 'string' ? a.trim().slice(0, 32) : '';
    const y = typeof b === 'string' ? b.trim().slice(0, 32) : '';
    if (!x) return y;
    if (!y) return x;
    return x >= y ? x : y;
  }

  function applyCloudWalletSettlement(serverW, opts) {
    const trustServerTokens = opts && opts.trustServerTokens;
    const st =
      typeof serverW === 'object' && serverW
        ? serverW
        : { tokens: DEFAULT_TOKENS, coinStreak: 0, lastDaily: '' };
    const localNow = loadWallet();
    const rawTok = Number(st.tokens);
    const sTok = Number.isFinite(rawTok) ? Math.max(0, Math.floor(rawTok)) : 0;
    const rawStreak = Number(st.coinStreak ?? st.coin_streak);
    const sStreak = Number.isFinite(rawStreak) ? Math.max(0, Math.floor(rawStreak)) : 0;
    const sDaily = st.lastDaily ?? st.last_daily ?? '';
    /** apply_settlement returns rakeback_pool; settle-game echoes it as rakebackPool. Must merge here
     * or every successful round wipes the locally mirrored pool until the next tab-hydrate. */
    const rbSrc = st.rakebackPool ?? st.rakeback_pool;
    let sRake = localNow.rakebackPool ?? 0;
    if (rbSrc !== undefined && rbSrc !== null && rbSrc !== '') {
      const n = Number(rbSrc);
      if (Number.isFinite(n)) {
        sRake = Math.max(0, Math.round(n * 100) / 100);
      }
    }
    const merged = {
      tokens: trustServerTokens ? sTok : Math.max(localNow.tokens || 0, sTok),
      coinStreak: Math.max(localNow.coinStreak || 0, sStreak),
      lastDaily: mergeLastDailyStr(localNow.lastDaily, typeof sDaily === 'string' ? sDaily : ''),
      rakebackPool: trustServerTokens ? sRake : Math.max(localNow.rakebackPool || 0, sRake)
    };
    saveWallet(merged);
    return merged;
  }

  /** Rakeback is now server-driven (apply_settlement accrues 10% of |delta| on arcade losses
   *  for signed-in users). Guests don't accrue — sign-up incentive. */
  function addRakebackFromLoss(_net) {
    return;
  }

  /** Async claim via the claim_rakeback Postgres RPC. Server credits tokens and writes
   *  the game-event row; client just renders the new wallet + a local history line. */
  async function claimRakeback() {
    if (!cloudClient || !cloudClient.isSignedIn || !cloudClient.isSignedIn()) {
      return { ok: false, reason: 'guest' };
    }
    if (typeof cloudClient.claimRakeback !== 'function') {
      return { ok: false, reason: 'unsupported' };
    }
    const result = await cloudClient.claimRakeback();
    if (!result || !result.ok) {
      return { ok: false, reason: result && result.error ? result.error : 'failed' };
    }
    return { ok: true, paid: result.paid || 0, wallet: result.wallet };
  }

  function defaultWinStreaks() {
    return {
      coin: { best: 0 },
      rps: { current: 0, best: 0 },
      slots: { current: 0, best: 0 },
      bj: { current: 0, best: 0 },
      /** best = longest streak of profitable banks; peakBankMult = best multiplier locked by BANK */
      crash: { current: 0, best: 0, peakBankMult: 0 }
    };
  }

  function loadWinStreaks() {
    try {
      const raw = localStorage.getItem(WIN_STREAK_KEY);
      const d = defaultWinStreaks();
      if (!raw) return d;
      const o = JSON.parse(raw);
      const out = defaultWinStreaks();
      out.coin.best = Math.max(0, Math.floor(Number(o.coin?.best)) || 0);
      ['rps', 'slots', 'bj'].forEach((slug) => {
        const row = o[slug] || {};
        out[slug].current = Math.max(0, Math.floor(Number(row.current)) || 0);
        out[slug].best = Math.max(0, Math.floor(Number(row.best)) || 0);
      });
      {
        const row = o.crash || {};
        out.crash.current = Math.max(0, Math.floor(Number(row.current)) || 0);
        out.crash.best = Math.max(0, Math.floor(Number(row.best)) || 0);
        const pm = Number(row.peakBankMult);
        out.crash.peakBankMult = Number.isFinite(pm) && pm > 0 ? Math.round(pm * 100) / 100 : 0;
      }
      return out;
    } catch {
      return defaultWinStreaks();
    }
  }

  function saveWinStreaks(s, opts) {
    localStorage.setItem(WIN_STREAK_KEY, JSON.stringify(s));
    if (!opts || !opts.skipCloudPush) scheduleArcadeStreaksCloudPush();
  }

  const ARCADE_STREAKS_CLOUD_DEBOUNCE_MS = 450;
  let arcadeStreaksCloudTimer = null;

  function buildArcadeStreaksCloudPatch(s) {
    const patch = {
      rps: { best: Math.max(0, Math.floor(Number(s.rps?.best)) || 0) },
      slots: { best: Math.max(0, Math.floor(Number(s.slots?.best)) || 0) },
      bj: { best: Math.max(0, Math.floor(Number(s.bj?.best)) || 0) },
      crash: {
        best: Math.max(0, Math.floor(Number(s.crash?.best)) || 0)
      }
    };
    const pk = Number(s.crash?.peakBankMult) || 0;
    if (Number.isFinite(pk) && pk > 0) {
      patch.crash.peakBankMult = Math.round(pk * 100) / 100;
    }
    return patch;
  }

  function scheduleArcadeStreaksCloudPush() {
    if (!cloudClient?.mergeArcadeStreaks || !cloudClient.enabled?.() || !cloudClient.isSignedIn?.()) return;
    if (arcadeStreaksCloudTimer) window.clearTimeout(arcadeStreaksCloudTimer);
    arcadeStreaksCloudTimer = window.setTimeout(() => {
      arcadeStreaksCloudTimer = null;
      const patch = buildArcadeStreaksCloudPatch(loadWinStreaks());
      void cloudClient.mergeArcadeStreaks(patch).catch(() => {});
    }, ARCADE_STREAKS_CLOUD_DEBOUNCE_MS);
  }

  function applyArcadeStreaksFromCloud(cloud) {
    if (!cloud || typeof cloud !== 'object') return;
    const s = loadWinStreaks();
    let changed = false;
    ['rps', 'slots', 'bj'].forEach((slug) => {
      const row = cloud[slug];
      if (!row || typeof row !== 'object') return;
      if (row.best == null) return;
      const nb = Math.max(0, Math.floor(Number(row.best)) || 0);
      if (nb > (s[slug].best || 0)) {
        s[slug].best = nb;
        changed = true;
      }
    });
    if (cloud.crash && typeof cloud.crash === 'object') {
      if (cloud.crash.best != null) {
        const nb = Math.max(0, Math.floor(Number(cloud.crash.best)) || 0);
        if (nb > (s.crash.best || 0)) {
          s.crash.best = nb;
          changed = true;
        }
      }
      if (cloud.crash.peakBankMult != null) {
        const np = Number(cloud.crash.peakBankMult);
        if (Number.isFinite(np) && np > 0) {
          const cur = Number(s.crash.peakBankMult) || 0;
          if (np > cur) {
            s.crash.peakBankMult = Math.round(np * 100) / 100;
            changed = true;
          }
        }
      }
    }
    if (changed) {
      saveWinStreaks(s, { skipCloudPush: true });
      renderWinStreakBars();
    }
  }

  function syncCoinBestFromWallet(w) {
    const s = loadWinStreaks();
    s.coin.best = Math.max(s.coin.best || 0, w.coinStreak || 0);
    saveWinStreaks(s, { skipCloudPush: true });
  }

  function applyArcadeWinStreak(slug, mood) {
    if (mood === 'pending') return;
    if (slug !== 'bj' && slug !== 'rps' && slug !== 'slots' && slug !== 'crash') return;
    const s = loadWinStreaks();
    const row = s[slug];
    if (!row) return;
    if (mood === 'tie') {
      renderWinStreakBars();
      return;
    }
    if (mood === 'lose') {
      row.current = 0;
    } else {
      row.current += 1;
      row.best = Math.max(row.best, row.current);
    }
    saveWinStreaks(s);
    renderWinStreakBars();
  }

  function renderWinStreakBars() {
    const w = loadWallet();
    const s = loadWinStreaks();
    const coinBestEl = document.getElementById('games-coin-streak-best');
    if (coinBestEl) {
      coinBestEl.textContent = String(Math.max(s.coin.best || 0, w.coinStreak || 0));
    }
    const curCrash = document.getElementById('crash-win-streak-current');
    if (curCrash && s.crash) curCrash.textContent = String(s.crash.current);

    const rows = [
      ['bj', 'bj-win-streak-current', 'bj-win-streak-best'],
      ['rps', 'rps-win-streak-current', 'rps-win-streak-best'],
      ['slots', 'slots-win-streak-current', 'slots-win-streak-best']
    ];
    rows.forEach(([slug, idCur, idBest]) => {
      const r = s[slug];
      if (!r) return;
      const curEl = document.getElementById(idCur);
      const bestEl = document.getElementById(idBest);
      if (curEl) curEl.textContent = String(r.current);
      if (bestEl) bestEl.textContent = String(Math.max(r.best, r.current));
    });
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

  function pushHistory(game, detail, delta, balanceAfter, settleExtra) {
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
    // settleExtra._localOnly = skip the cloud settle (server-driven flows like rakeback claim
    // already inserted their own game_events row via RPC; sending another would double-count).
    const localOnly = !!(settleExtra && settleExtra._localOnly);
    if (!localOnly && cloudClient?.enabled?.()) {
      const payload = {
        game: row.game,
        detail: row.detail,
        delta: row.delta,
        balanceAfter: row.balance
      };
      if (settleExtra && typeof settleExtra === 'object') {
        const { _localOnly, ...rest } = settleExtra;
        Object.assign(payload, rest);
      }
      cloudClient
        .recordSettlement(payload)
        .then((result) => {
          if (!result || !result.ok || !result.wallet) {
            console.warn('[FuqMeA] settlement failed', result && result.error ? result.error : result);
            const errTxt = result && result.error != null ? String(result.error) : '';
            if (
              (row.game === 'quest' || row.game === 'quest_weekly') &&
              errTxt &&
              /already_claimed|period_mismatch|quest_already|invalid_quest/i.test(errTxt)
            ) {
              void cloudClient.refreshQuestStateFromWallet?.();
            }
            const msg = document.getElementById('games-cloud-msg');
            if (msg && result && result.status === 401) {
              msg.textContent = 'Session expired. Sign in again to save rounds.';
            } else if (msg && result && result.error === 'not_signed_in') {
              msg.textContent = 'Sign in to save rounds to the cloud.';
            }
            return;
          }
          const merged = applyCloudWalletSettlement(result.wallet, { trustServerTokens: true });
          syncCoinBestFromWallet(merged);
          renderWallet(merged);
          renderWinStreakBars();
        })
        .catch((err) => {
          console.warn('[FuqMeA] settlement threw', err);
        });
      scheduleLeaderboardRefresh();
    }
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
    const HISTORY_GAME_CLASS = {
      coin: 'coin',
      rps: 'rps',
      slots: 'slots',
      bj: 'bj',
      crash: 'crash',
      daily: 'daily',
      rakeback: 'daily',
      quest: 'quest',
      quest_weekly: 'quest'
    };

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
    } else if (slug === 'crash' && mood === 'win') {
      badge.textContent = 'Fuq Yeah';
    } else if (slug === 'crash' && mood === 'lose') {
      badge.textContent = 'RIP';
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

  function renderRakeback() {
    const w = loadWallet();
    const poolRaw = Math.max(0, Number(w.rakebackPool) || 0);
    const pool = Math.floor(poolRaw);
    const poolDisplay =
      poolRaw > 0 && poolRaw < 1
        ? poolRaw.toFixed(1)
        : pool >= 1
          ? pool.toLocaleString()
          : poolRaw.toFixed(1);
    const signedIn = !!(cloudClient && cloudClient.isSignedIn && cloudClient.isSignedIn());
    const hasPool = signedIn && pool > 0;
    document.querySelectorAll('.js-rakeback-pool').forEach((el) => {
      el.textContent = signedIn ? poolDisplay : '0';
    });
    document.querySelectorAll('.js-rakeback-claimed').forEach((el) => {
      el.textContent = signedIn ? pool.toLocaleString() : '—';
    });
    const panel = document.querySelector('.games-rakeback-stage');
    if (panel) {
      panel.classList.toggle('games-rakeback-stage--active', hasPool);
      panel.classList.toggle('games-rakeback-stage--guest', !signedIn);
    }
    const btn = document.getElementById('games-rakeback-claim');
    if (btn) {
      if (!signedIn) {
        btn.disabled = true;
        btn.textContent = 'SIGN IN TO EARN RAKEBACK';
      } else {
        btn.disabled = !hasPool;
        btn.textContent = hasPool ? `CLAIM ${pool} RAKEBACK` : 'NO RAKEBACK YET';
      }
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
    document.querySelectorAll('.js-daily-bonus-display').forEach((el) => {
      el.textContent = String(DAILY_BONUS);
    });
    document.querySelectorAll('.js-games-daily').forEach((btn) => {
      btn.disabled = claimed;
      btn.textContent = claimed ? 'DAILY BONUS CLAIMED' : `CLAIM +${DAILY_BONUS} DAILY`;
    });
    renderRakeback();
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

  /** Signed-in cloud users shouldn’t see a “reset device” affordance—it only wipes localStorage
   * and is misleading once the authoritative wallet lives on Supabase (next hydrate restores it). */
  function syncGamesResetButtonVisibility() {
    const btn = document.getElementById('games-reset-btn');
    if (!btn) return;
    const cloudOn = !!(cloudClient && cloudClient.enabled && cloudClient.enabled());
    const signedIn = !!(cloudClient && cloudClient.isSignedIn && cloudClient.isSignedIn());
    btn.hidden = !!(cloudOn && signedIn);
  }

  function initWalletUi() {
    maybeSeedAccountQuestsFromLegacyOnce();
    function paintWalletFromStorage() {
      const nw = loadWallet();
      syncCoinBestFromWallet(nw);
      renderWallet(nw);
      renderWinStreakBars();
    }

    window.addEventListener('fuqmea-wallet-hydrated', paintWalletFromStorage);
    window.addEventListener('fuqmea-cloud-init-complete', paintWalletFromStorage, { once: true });
    window.addEventListener('fuqmea-cloud-init-complete', () => syncGamesResetButtonVisibility(), { once: true });
    window.addEventListener('fuqmea-cloud-init-complete', () => scheduleQuestCloudPush(), { once: true });
    window.addEventListener('fuqmea-guest-quest-backup', () => snapshotGuestQuestBundleIfNeeded());
    window.addEventListener('fuqmea-restore-guest-quests', () => {
      restoreGuestQuestBundleToGuestKeys();
    });
    // Auth state flips the rakeback panel between "Sign in to earn" and live pool readout.
    window.addEventListener('fuqmea-cloud-auth-state', (ev) => {
      renderRakeback();
      syncGamesResetButtonVisibility();
      const signedIn = !!(ev && ev.detail && ev.detail.signedIn);
      if (signedIn) maybeSeedAccountQuestsFromLegacyOnce();
      renderQuestPanels();
      if (signedIn) scheduleQuestCloudPush();
    });

    window.addEventListener('fuqmea-aura-cloud-peak', (ev) => {
      const pk = ev && ev.detail && Number(ev.detail.peak);
      if (!Number.isFinite(pk) || pk <= 0) return;
      const s = loadWinStreaks();
      if (!s.crash) return;
      s.crash.peakBankMult = Math.max(Number(s.crash.peakBankMult) || 0, pk);
      saveWinStreaks(s);
      renderWinStreakBars();
    });

    window.addEventListener('fuqmea-arcade-streaks-cloud', (ev) => {
      applyArcadeStreaksFromCloud(ev && ev.detail);
    });

    window.addEventListener('fuqmea-quest-state-cloud', (ev) => {
      applyQuestCloudPayload(ev && ev.detail);
    });

    const w = loadWallet();
    syncCoinBestFromWallet(w);
    renderWallet(w);
    renderWinStreakBars();
    renderHistory(loadHistory());
    syncGamesResetButtonVisibility();

    function claimDailyBonus() {
      const cur = loadWallet();
      const day = todayKey();
      if (cur.lastDaily === day) return;
      const before = cur.tokens;
      cur.tokens += DAILY_BONUS;
      cur.lastDaily = day;
      saveWallet(cur);
      renderWallet(cur);
      pushHistory('daily', `Claimed +${DAILY_BONUS}`, cur.tokens - before, cur.tokens, { lastDaily: day });
    }
    document.querySelectorAll('.js-games-daily').forEach((btn) => {
      btn.addEventListener('click', claimDailyBonus);
    });

    document.getElementById('games-rakeback-claim')?.addEventListener('click', async () => {
      const btn = document.getElementById('games-rakeback-claim');
      if (btn && btn.disabled) return;
      const msg = document.getElementById('games-cloud-msg');
      const out = await claimRakeback();
      if (!out || !out.ok) {
        if (msg) {
          msg.textContent =
            out && out.reason === 'guest'
              ? 'Sign in to earn 10% rakeback on losses.'
              : out && out.reason === 'no_rakeback_to_claim'
                ? 'No rakeback to claim yet — keep playing.'
                : 'Rakeback claim failed — try again in a moment.';
        }
        renderRakeback();
        return;
      }
      const w = loadWallet();
      renderWallet(w);
      renderRakeback();
      // Local-only history row; the claim_rakeback RPC already wrote a game_events row server-side.
      pushHistory(
        'rakeback_claim',
        `Claimed ${out.paid} FUQ rakeback`,
        out.paid,
        w.tokens,
        { _localOnly: true }
      );
      if (msg) msg.textContent = `Claimed ${out.paid} FUQ rakeback.`;
    });

    document.getElementById('games-reset-btn')?.addEventListener('click', () => {
      if (
        !window.confirm(
          'Clear local guest stats only: FUQ balance snapshot, arcade win-streaks, daily / weekly quests, and the Recent runs log on this device? Does not delete or change a signed-in cloud account. Restart guest play at 200 FUQ.'
        )
      )
        return;
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(WIN_STREAK_KEY);
      localStorage.removeItem(QUEST_STATE_KEY_GUEST);
      localStorage.removeItem(WEEKLY_QUEST_STATE_KEY_GUEST);
      localStorage.removeItem(GUEST_QUEST_BUNDLE_KEY);
      localStorage.removeItem(QUEST_UI_KEY);
      // RAKEBACK_STATE_KEY removed: rakeback now lives on the server (wallets.rakeback_pool).
      try { localStorage.removeItem(RAKEBACK_STATE_KEY); } catch (_) { /* legacy clean-up */ }
      clearHistory();
      const fresh = loadWallet();
      renderWallet(fresh);
      renderWinStreakBars();
      renderQuestPanels();
      pushHistory(
        'reset',
        'Local guest stats cleared (quests, streaks, log)',
        0,
        fresh.tokens
      );
    });

    document.getElementById('games-history-clear')?.addEventListener('click', () => {
      if (!window.confirm('Clear play history log only? (coins stay.)')) return;
      clearHistory();
    });

    renderQuestPanels();

    /** Cloud mirrors wallet via cloud-sync hydrateWalletAfterLogin + fuqmea-wallet-hydrated. */
  }

  function coinNormRotateYDeg(deg) {
    let n = deg % 360;
    if (n < 0) n += 360;
    return n;
  }

  function gamesPrefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function coinFlipReducedMotion() {
    return gamesPrefersReducedMotion();
  }

  function setRpsControlsDisabled(disabled) {
    const btn = document.getElementById('rps-play-btn');
    if (btn) {
      btn.disabled = disabled;
      btn.setAttribute('aria-busy', disabled ? 'true' : 'false');
    }
    document.querySelectorAll('#games-panel-rps input[type="radio"]').forEach((inp) => {
      inp.disabled = disabled;
    });
  }

  function syncRpsBattlePlayerGlyph() {
    const pickEl = document.querySelector('input[name="rps-choice"]:checked');
    const pick = pickEl ? pickEl.value : 'rock';
    const pl = document.getElementById('rps-battle-player');
    if (pl && RPS_GLYPHS[pick]) pl.textContent = RPS_GLYPHS[pick];
  }

  function setCoinFlipControlsDisabled(disabled) {
    const flipBtn = document.getElementById('coin-flip-btn');
    if (flipBtn) {
      flipBtn.disabled = disabled;
      flipBtn.setAttribute('aria-busy', disabled ? 'true' : 'false');
    }
    document.querySelectorAll('#games-panel-coin input[type="radio"]').forEach((inp) => {
      inp.disabled = disabled;
    });
  }

  function playCoinFlip() {
    if (coinFlipAnimating) return;
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
    saveWallet(w);
    renderWallet(w);
    const outcome = Math.random() < 0.5 ? 'heads' : 'tails';
    const win = outcome === pick;

    const shell = document.getElementById('coin-display');
    const coin3d = document.getElementById('games-coin-3d');

    function settleCoinResult() {
      const prevStreak = w.coinStreak;
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
      arcadeNoteBet(bet);
      arcadeNoteRound('coin', bet);
      if (win) arcadeNoteWin('coin');
      const net = w.tokens - before;
      addRakebackFromLoss(net);
      bumpWeeklyFuqEarnedFromGames(net);
      pushHistory('coin', detail, net, w.tokens, { coinStreak: w.coinStreak, wager_amount: bet });
      if (win) {
        syncCoinBestFromWallet(w);
        setGameOutcome('coin', 'win', `You called ${pick.toUpperCase()} · landed ${outcome.toUpperCase()} · ${net >= 0 ? '+' : ''}${net} coins`);
      } else {
        setGameOutcome('coin', 'lose', prevStreak > 0
          ? `Landed ${outcome.toUpperCase()} · ${net} coins · ${prevStreak}-win streak lost`
          : `Landed ${outcome.toUpperCase()} · ${net} coins`);
      }
      renderWinStreakBars();
      coinFlipAnimating = false;
      setCoinFlipControlsDisabled(false);
    }

    function flashCoinShell() {
      if (!shell) return;
      shell.classList.remove('games-flash');
      void shell.offsetWidth;
      shell.classList.add('games-flash');
    }

    if (!coin3d || coinFlipReducedMotion()) {
      flashCoinShell();
      settleCoinResult();
      return;
    }

    coinFlipAnimating = true;
    setCoinFlipControlsDisabled(true);

    const landingY = outcome === 'heads' ? 0 : 180;
    const prevTotal = coinFlipYDeg;
    const currNorm = coinNormRotateYDeg(prevTotal);
    const spins = 5 + Math.floor(Math.random() * 4);
    const align = (landingY - currNorm + 360) % 360;
    const delta = spins * 360 + align;
    coinFlipYDeg = prevTotal + delta;

    const ease = 'cubic-bezier(0.2, 0.65, 0.25, 1)';
    let finished = false;
    const cleanup = () => {
      if (finished) return;
      finished = true;
      flashCoinShell();
      settleCoinResult();
    };

    coin3d.style.transition = 'none';
    coin3d.style.transform = `rotateY(${prevTotal}deg)`;
    coin3d.getBoundingClientRect();

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        coin3d.style.transition = `transform ${COIN_FLIP_DURATION_MS}ms ${ease}`;
        coin3d.style.transform = `rotateY(${coinFlipYDeg}deg)`;
      });
    });

    const timer = window.setTimeout(cleanup, COIN_FLIP_DURATION_MS + 120);

    function onTransitionEnd(ev) {
      if (ev.target !== coin3d || ev.propertyName !== 'transform') return;
      coin3d.removeEventListener('transitionend', onTransitionEnd);
      window.clearTimeout(timer);
      cleanup();
    }
    coin3d.addEventListener('transitionend', onTransitionEnd);
  }

  function finalizeRpsRound(w, before, pick, house, bet) {
    const labels = { rock: '✊ ROCK', paper: '✋ PAPER', scissors: '✌ SCISSORS' };
    const short = { rock: 'R', paper: 'P', scissors: 'S' };
    const houseEl = document.getElementById('rps-house');
    const houseEmojiEl = document.getElementById('rps-battle-house');

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
    if (houseEl) houseEl.textContent = `House plays ${labels[house]}`;
    if (houseEmojiEl) houseEmojiEl.textContent = RPS_GLYPHS[house];

    saveWallet(w);
    renderWallet(w);
    arcadeNoteBet(bet);
    arcadeNoteRound('rps', bet);
    if (delta === bet * 2) arcadeNoteWin('rps');
    const net = w.tokens - before;
    addRakebackFromLoss(net);
    bumpWeeklyFuqEarnedFromGames(net);
    pushHistory('rps', detail, net, w.tokens, { wager_amount: bet });
    if (pick === house) {
      applyArcadeWinStreak('rps', 'tie');
      setGameOutcome('rps', 'tie', `Both played ${pick.toUpperCase()} · bet returned`);
    } else if (delta === bet * 2) {
      applyArcadeWinStreak('rps', 'win');
      setGameOutcome('rps', 'win', `Beat ${house.toUpperCase()} · +${bet} profit (${net >= 0 ? '+' : ''}${net} coins)`);
    } else {
      applyArcadeWinStreak('rps', 'lose');
      setGameOutcome('rps', 'lose', `Lost to ${house.toUpperCase()} · ${net} coins`);
    }
    rpsRoundBusy = false;
    setRpsControlsDisabled(false);
    if (houseEmojiEl && houseEmojiEl.classList.contains('games-rps-battle-house-land')) {
      window.setTimeout(() => {
        houseEmojiEl.classList.remove('games-rps-battle-house-land');
      }, 340);
    }
  }

  function playRps() {
    if (rpsRoundBusy) return;
    const pickEl = document.querySelector('input[name="rps-choice"]:checked');
    const pick = pickEl ? pickEl.value : 'rock';
    const bet = getBetAmount('rps-bet');
    const w = loadWallet();
    const before = w.tokens;
    if (w.tokens < bet) {
      setGameOutcome('rps', 'pending', 'Need more FUQ coins for that bet.');
      return;
    }
    const houseEmojiEl = document.getElementById('rps-battle-house');
    const houseTxtEl = document.getElementById('rps-house');
    if (houseEmojiEl) {
      houseEmojiEl.classList.remove('games-rps-battle-house-land');
      houseEmojiEl.textContent = '⋯';
    }
    syncRpsBattlePlayerGlyph();

    w.tokens -= bet;
    saveWallet(w);
    renderWallet(w);

    const house = RPS_ORDER[Math.floor(Math.random() * RPS_ORDER.length)];

    rpsRoundBusy = true;
    setRpsControlsDisabled(true);
    setGameOutcome('rps', 'pending', `Throwing · bet ${bet} FUQ on the table…`);

    function landAndPay() {
      if (houseEmojiEl) houseEmojiEl.textContent = RPS_GLYPHS[house];
      if (gamesPrefersReducedMotion()) {
        if (houseTxtEl) houseTxtEl.textContent = `House picks…`;
        finalizeRpsRound(w, before, pick, house, bet);
        return;
      }
      if (houseEmojiEl) {
        void houseEmojiEl.offsetWidth;
        houseEmojiEl.classList.add('games-rps-battle-house-land');
      }
      window.setTimeout(() => finalizeRpsRound(w, before, pick, house, bet), RPS_LAND_POP_MS);
    }

    if (gamesPrefersReducedMotion()) {
      landAndPay();
      return;
    }

    let step = 0;
    const shuffleId = window.setInterval(() => {
      step += 1;
      if (!houseEmojiEl) {
        window.clearInterval(shuffleId);
        landAndPay();
        return;
      }
      const decoy = RPS_ORDER[step % 3];
      houseEmojiEl.textContent = RPS_GLYPHS[decoy];
      if (houseTxtEl) houseTxtEl.textContent = `House: ${houseEmojiEl.textContent} …`;
      if (step >= RPS_SHUFFLE_STEPS) {
        window.clearInterval(shuffleId);
        landAndPay();
      }
    }, RPS_SHUFFLE_TICK_MS);
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
      prize = bet * 10;
      line = `Bet ${bet} · ${formatSlotsLineSymbols(final)} · TRIPLE`;
    } else if (final[0].id === final[1].id) {
      prize = bet * 3;
      line = `Bet ${bet} · ${formatSlotsLineSymbols(final)} · DOUBLE`;
    } else {
      line = `Bet ${bet} · ${formatSlotsLineSymbols(final)} · MISS`;
    }
    const net = prize - bet;
    addRakebackFromLoss(net);
    cur.tokens += prize;
    saveWallet(cur);
    renderWallet(cur);
    arcadeNoteBet(bet);
    arcadeNoteRound('slots', bet);
    if (prize > bet) arcadeNoteSlotsLineHit();
    bumpWeeklyFuqEarnedFromGames(net);
    if (net > 0) arcadeNoteWin('slots');
    line += ` (${net >= 0 ? '+' : ''}${net})`;
    pushHistory('slots', line, net, cur.tokens, { wager_amount: bet });
    const spinBtn = document.getElementById('slots-spin-btn');
    if (spinBtn) spinBtn.disabled = false;

    const sub = `${final.map((s) => s.label).join(' / ')} · ${net >= 0 ? '+' : ''}${net} coins`;
    if (final[0].id === final[1].id && final[1].id === final[2].id) {
      applyArcadeWinStreak('slots', 'win');
      setGameOutcome('slots', 'jackpot', `Triple ${final[0].label} · ${sub}`);
    } else if (final[0].id === final[1].id) {
      applyArcadeWinStreak('slots', 'win');
      setGameOutcome('slots', 'win', `First two match · ${sub}`);
    } else {
      applyArcadeWinStreak('slots', 'lose');
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

    const order = ['bj', 'crash', 'coin', 'rps', 'slots'];

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
    if (g === 'rps' || g === 'slots' || g === 'coin' || g === 'bj' || g === 'crash') selectTab(g);
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
  document.querySelectorAll('input[name="rps-choice"]').forEach((inp) => {
    inp.addEventListener('change', syncRpsBattlePlayerGlyph);
  });
  syncRpsBattlePlayerGlyph();
  wireBetRadios('slots-bet', 'slots');
  wireBetRadios('bj-bet', 'bj');
  wireBetRadios('crash-bet', 'crash');

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
  initQuestCollapseControls();
  initGameRulesDisclosures();
  initHistoryDetailsOpen();
  document.getElementById('games-leaderboard-refresh')?.addEventListener('click', () => {
    cloudClient?.refreshLeaderboard?.().catch(() => {});
  });
  initBlackjack();
  initCrashGame();
  initGameTabs();
})();
