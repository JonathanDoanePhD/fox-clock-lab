'use strict';

const $ = id => document.getElementById(id);
const storageKey = 'fox-clock-lab-v1';
const mod = (value, size) => ((value % size) + size) % size;
const random = max => Math.floor(Math.random() * (max + 1));
const integer = value => {
  const cleaned = value.trim().replace(/^−/, '-');
  return /^[+-]?\d+$/.test(cleaned) ? BigInt(cleaned) : null;
};

function gcd(a, b) {
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

function makeProblem(size, multiplication, straightforward, index) {
  const kinds = straightforward ? [['+', 2], ['−', 2]] : [
    ['+', 1], ['−', 1], ['+', 0], ['−', 0]
  ];
  const [operator, blank] = multiplication
    ? ['×', straightforward ? 2 : index % 2]
    : kinds[index % kinds.length];
  let a = random(size);
  let b = random(size);
  if (multiplication && straightforward) {
    const factors = [...new Set([0, 1, 2, 3, size].filter(value => value <= size))];
    a = factors[random(factors.length - 1)];
  }
  if (multiplication && !straightforward) {
    // A factor coprime to the modulus gives the blank one reduced answer.
    const factors = Array.from({ length: size }, (_, i) => i + 1).filter(value => gcd(value, size) === 1);
    const known = factors[random(factors.length - 1)];
    if (blank === 0) b = known;
    else a = known;
  }
  const result = operator === '+' ? a + b : operator === '−' ? a - b : a * b;
  return { operator, blank, terms: [a, b, result], raw: '', modular: '' };
}

const defaults = { initials: '', size: 5, inner: true, outer: true, multiply: false, missingNumber: false, sound: true };
let state = { attempts: [], sets: {}, ...defaults };
try {
  const previous = JSON.parse(localStorage.getItem(storageKey));
  if (previous) {
    state = { ...state, ...previous, ...defaults };
    delete state.straightforward;
    if (previous.set) {
      state.sets[previous.size + (previous.multiply ? '×' : '+')] = previous.set;
      delete state.set;
    }
    if (previous.students) {
      for (const [student, sets] of Object.entries(previous.students)) {
        for (const [key, set] of Object.entries(sets)) {
          const size = Number(key.replace('×', ''));
          for (const problem of set.problems) {
            for (const attempt of problem.attempts) {
              state.attempts.push(attemptRow(student === 'Guest' ? '' : student, size, problem, attempt));
            }
          }
        }
      }
      state.attempts.sort((a, b) => a.time.localeCompare(b.time));
      delete state.students;
    }
  }
} catch {}
const persist = () => {
  try { localStorage.setItem(storageKey, JSON.stringify(state)); }
  catch { showNotice('Browser storage is unavailable. Export before closing this page.'); }
};
const initials = () => state.initials.trim().toUpperCase();
function practiceKey() {
  return state.size + (state.multiply ? '×' : '+') + (state.missingNumber ? ':operand' : ':result');
}
function getSet() {
  return state.sets[practiceKey()] ??= { index: 0, problems: [makeProblem(state.size, state.multiply, !state.missingNumber, 0)] };
}
const current = () => getSet().problems[getSet().index];

let hour = 0;
let pointer = null;
let sweepStart = 0;
let sweepHours = 0;
let labels = [];
let sleeping = false;
let sleepTimer;
let feedbackTimer;
let audioContext;
let foxMood = 'curious';
const foxDescriptions = {
  curious: 'Curious fox',
  happy: 'Smiling fox',
  modular: 'Smiling fox in profile',
  retry: 'Puzzled fox',
  sleep: 'Sleeping fox'
};
function renderFox() {
  const mood = sleeping ? 'sleep' : foxMood;
  const fox = $('fox');
  fox.dataset.mood = mood;
  fox.setAttribute('aria-label', foxDescriptions[mood]);
}
function wake() {
  if (sleeping) {
    sleeping = false;
    renderFox();
  }
  clearTimeout(sleepTimer);
  sleepTimer = setTimeout(() => { sleeping = true; renderFox(); chime('sleep'); }, 60000);
}
for (const event of ['pointerdown', 'pointermove', 'keydown', 'input']) {
  document.addEventListener(event, wake, { passive: true });
}
wake();

const svgNS = 'http://www.w3.org/2000/svg';
function svgElement(tag, attributes, text) {
  const element = document.createElementNS(svgNS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  if (text !== undefined) element.textContent = text;
  $('marks').append(element);
  return element;
}
function drawClock() {
  $('practice-modulus').textContent = state.size;
  $('marks').replaceChildren();
  labels = [];
  for (let i = 0; i < state.size; i++) {
    const angle = 2 * Math.PI * i / state.size;
    const x = radius => 230 + radius * Math.sin(angle);
    const y = radius => 230 - radius * Math.cos(angle);
    const main = i || state.size;
    svgElement('line', { x1: x(172), y1: y(172), x2: x(182), y2: y(182), stroke: '#466a83', 'stroke-width': 4, 'stroke-linecap': 'round' });
    labels.push(svgElement('text', { x: x(151), y: y(151), class: 'hour' }, main));
    if (state.inner) svgElement('text', { x: x(127), y: y(127), class: 'inner-label' }, i ? '−' + (state.size - i) : '0');
    if (state.outer) svgElement('text', { x: x(205), y: y(205), class: 'outer-label' }, state.size + main);
  }
  $('hand').setAttribute('aria-valuemax', state.size - 1);
  settleSweep(sweepHours);
}
function rotateHand(degrees) {
  $('hand').setAttribute('transform', 'rotate(' + degrees + ' 230 230)');
}
function moveHand(value) {
  hour = mod(value, state.size);
  const main = hour || state.size;
  rotateHand(360 * hour / state.size);
  $('hand').setAttribute('aria-valuenow', hour);
  $('hand').setAttribute('aria-valuetext', main + ' o’clock, modular value ' + hour);
  labels.forEach((label, index) => label.classList.toggle('active', index === hour));
  $('readout').textContent = main + ' o’clock · modular value ' + hour;
}
function sweepPoint(degrees, radius) {
  const radians = degrees * Math.PI / 180;
  return [230 + radius * Math.sin(radians), 230 - radius * Math.cos(radians)];
}
function renderSweep(degrees) {
  const origin = 360 * sweepStart / state.size;
  const magnitude = Math.min(Math.abs(degrees), 360);
  const direction = Math.sign(degrees);
  const radius = 170;
  const start = sweepPoint(origin, radius);
  const end = sweepPoint(origin + direction * magnitude, radius);
  const sweepFlag = direction > 0 ? 1 : 0;
  let path = '';
  if (magnitude >= 360) {
    const opposite = sweepPoint(origin + 180, radius);
    path = `M ${start.join(' ')} A ${radius} ${radius} 0 0 ${sweepFlag} ${opposite.join(' ')} A ${radius} ${radius} 0 0 ${sweepFlag} ${start.join(' ')} Z`;
  } else if (magnitude > 0.01) {
    path = `M 230 230 L ${start.join(' ')} A ${radius} ${radius} 0 ${magnitude > 180 ? 1 : 0} ${sweepFlag} ${end.join(' ')} Z`;
  }
  $('sweep-shade').setAttribute('d', path);
  const hours = direction * Math.round(Math.abs(degrees) * state.size / 360);
  const [x, y] = sweepPoint(origin + direction * magnitude / 2, 90);
  const label = $('sweep-label');
  label.setAttribute('x', x);
  label.setAttribute('y', y);
  label.textContent = hours === 0 ? '' : String(hours).replace('-', '−');
}
function settleSweep(hours) {
  sweepHours = hours;
  moveHand(sweepStart + hours);
  renderSweep(360 * hours / state.size);
  if (hours) {
    const hand = $('hand');
    const direction = hours > 0 ? 'clockwise' : 'counterclockwise';
    const count = Math.abs(hours);
    hand.setAttribute('aria-valuetext', hand.getAttribute('aria-valuetext') +
      ', moved ' + count + (count === 1 ? ' hour ' : ' hours ') + direction);
  }
}
function pointerAngle(event) {
  const inverse = $('clock').getScreenCTM()?.inverse();
  if (!inverse) return;
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(inverse);
  const dx = point.x - 230;
  const dy = point.y - 230;
  if (Math.hypot(dx, dy) < 10) return;
  return Math.atan2(dx, -dy) * 180 / Math.PI;
}
function updateDrag(event) {
  const angle = pointerAngle(event);
  if (angle === undefined) return;
  // Unwrap each small change so crossing 12 or making a full turn preserves direction.
  pointer.travel += mod(angle - pointer.lastAngle + 180, 360) - 180;
  pointer.lastAngle = angle;
  rotateHand(360 * sweepStart / state.size + pointer.travel);
  renderSweep(pointer.travel);
}
$('hand').addEventListener('pointerdown', event => {
  if (pointer !== null || event.button !== 0) return;
  event.preventDefault();
  pointer = {
    id: event.pointerId,
    lastAngle: pointerAngle(event) ?? 360 * hour / state.size,
    travel: 360 * sweepHours / state.size
  };
  $('hand').setPointerCapture(pointer.id);
  $('hand').classList.add('dragging');
});
$('hand').addEventListener('pointermove', event => {
  if (event.pointerId === pointer?.id) updateDrag(event);
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  $('hand').addEventListener(name, event => {
    if (event.pointerId !== pointer?.id) return;
    if (name === 'pointerup') {
      updateDrag(event);
      const steps = Math.sign(pointer.travel) * Math.round(Math.abs(pointer.travel) * state.size / 360);
      settleSweep(steps);
    } else settleSweep(sweepHours);
    pointer = null;
    $('hand').classList.remove('dragging');
  });
}
$('hand').addEventListener('keydown', event => {
  const steps = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: -hour, End: state.size - 1 - hour };
  if (!Object.hasOwn(steps, event.key)) return;
  event.preventDefault();
  settleSweep(sweepHours + steps[event.key]);
});

function evaluate(problem, size, field) {
  const value = integer(problem[field]);
  const target = BigInt(mod(problem.terms[problem.blank], size));
  const residue = value === null ? null : mod(value, BigInt(size));
  const correct = value === null ? null : (field === 'raw' ? residue : value) === target;
  return { value, residue, correct };
}
const lampLabels = {
  empty: 'empty',
  ok: 'correct',
  equivalent: 'correct, with an equivalent value outside the modular range',
  retry: 'try again'
};
function lamp(id, field, status) {
  const element = $(id);
  element.dataset.status = status;
  const message = field + ' answer ' + lampLabels[status];
  element.setAttribute('aria-label', message);
  element.title = message;
}
function feedback(resetFox = false) {
  const problem = current();
  const raw = evaluate(problem, state.size, 'raw');
  const modular = evaluate(problem, state.size, 'modular');
  const rawStatus = raw.correct ? (raw.value === raw.residue ? 'ok' : 'equivalent') :
    problem.raw.trim() ? 'retry' : 'empty';
  const modularStatus = modular.correct ? 'ok' : problem.modular.trim() ? 'retry' : 'empty';
  lamp('raw-light', 'Regular', rawStatus);
  lamp('mod-light', 'Modular', modularStatus);
  $('conversion').textContent = raw.value !== null
    ? 'Wraps to ' + raw.residue
    : problem.raw.trim() ? 'Enter an integer.' : 'Wraps to …';
  if (modular.correct === false && (modular.value < 0n || modular.value >= BigInt(state.size))) {
    $('mod-light').title = 'Use a number from 0 to ' + (state.size - 1) + '.';
    $('mod-light').setAttribute('aria-label', $('mod-light').title);
  }
  const latest = problem.lastField === 'raw' ? raw : modular;
  foxMood = resetFox ? 'curious' : latest.correct === false ? 'retry' :
    latest.correct === true ? (latest === raw ? 'happy' : 'modular') :
    modular.correct === true ? 'modular' : raw.correct === true ? 'happy' :
    modular.correct === false || raw.correct === false ? 'retry' : 'curious';
  renderFox();
  const set = getSet();
  $('progress').textContent = 'Problem ' + (set.index + 1);
}
let displayedProblem;
function showProblem(resetFox = false) {
  const set = getSet();
  const problem = current();
  if (problem !== displayedProblem) {
    sweepStart = mod(problem.terms[problem.blank === 0 ? 1 : 0], state.size);
    settleSweep(0);
    displayedProblem = problem;
  }
  const tokens = [problem.terms[0], problem.operator, problem.terms[1], '=', problem.terms[2]];
  const spoken = [...tokens];
  spoken[problem.blank * 2] = 'blank';
  $('equation').setAttribute('aria-label', spoken.join(' '));
  $('equation').replaceChildren(...tokens.map((token, index) => {
    const span = document.createElement('span');
    span.setAttribute('aria-hidden', 'true');
    if (index === problem.blank * 2) {
      span.className = 'blank';
      span.textContent = '?';
    } else span.textContent = String(token).replace(/^-/, '−');
    return span;
  }));
  if (problem.answerOwner !== initials()) {
    problem.raw = '';
    problem.modular = '';
    problem.answerOwner = initials();
    problem.lastField = null;
  }
  $('raw').value = problem.raw;
  $('modular').value = problem.modular;
  $('modular').placeholder = '0–' + (state.size - 1);
  $('prev').disabled = set.index === 0;
  feedback(resetFox);
}
function unlockAudio() {
  if (!state.sound) return;
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!Audio) return;
  audioContext ??= new Audio();
  if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
}
function chime(mood) {
  if (!state.sound || !audioContext || audioContext.state !== 'running') return;
  const notes = {
    regular: [392, 523.25],
    modular: [523.25, 659.25, 783.99],
    retry: [146.83, 110],
    sleep: [130.81, 98]
  }[mood];
  notes.forEach((frequency, index) => {
    const start = audioContext.currentTime + index * .13;
    const oscillator = audioContext.createOscillator();
    const tone = audioContext.createBiquadFilter();
    const gain = audioContext.createGain();
    oscillator.type = 'sawtooth';
    oscillator.frequency.setValueAtTime(frequency * .96, start);
    oscillator.frequency.exponentialRampToValueAtTime(frequency, start + .05);
    tone.type = 'lowpass';
    tone.frequency.value = mood === 'sleep' ? 300 : mood === 'retry' ? 480 : 2100;
    gain.gain.setValueAtTime(.001, start);
    gain.gain.exponentialRampToValueAtTime(mood === 'sleep' ? .023 : .065, start + .045);
    gain.gain.exponentialRampToValueAtTime(.001, start + .22);
    oscillator.connect(tone).connect(gain).connect(audioContext.destination);
    oscillator.start(start);
    oscillator.stop(start + .23);
  });
}
function attemptRow(student, size, problem, attempt) {
  const [a, b, result] = problem.terms.map((value, index) => index === problem.blank ? '?' : value);
  return {
    student, size, equation: a + ' ' + problem.operator + ' ' + b + ' = ' + result,
    expected: mod(problem.terms[problem.blank], size), ...attempt
  };
}
let pending;
function recordAnswer(play = true) {
  clearTimeout(feedbackTimer);
  if (!pending) return;
  const { problem, size, field, student } = pending;
  pending = null;
  const { correct } = evaluate(problem, size, field);
  const answer = problem[field].trim();
  if (!answer) return;
  state.attempts.push(attemptRow(student, size, problem, {
    field, answer, correct, time: new Date().toISOString()
  }));
  persist();
  if (play && correct !== null) chime(correct ? (field === 'raw' ? 'regular' : 'modular') : 'retry');
}
for (const field of ['raw', 'modular']) {
  $(field).addEventListener('focus', unlockAudio);
  $(field).addEventListener('input', () => {
    const problem = current();
    if (pending?.field !== field) recordAnswer();
    if (problem[field] === $(field).value) return;
    problem[field] = $(field).value;
    problem.lastField = field;
    pending = { problem, size: state.size, field, student: initials() };
    persist();
    feedback();
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(recordAnswer, 550);
  });
  $(field).addEventListener('blur', () => recordAnswer());
}
$('answers').addEventListener('submit', event => {
  event.preventDefault();
  recordAnswer();
});
$('answers').addEventListener('keydown', event => {
  if (event.key === 'Enter' && event.target.matches('.answer')) {
    event.preventDefault();
    recordAnswer();
  }
});
window.addEventListener('pagehide', () => recordAnswer(false));

for (let size = 1; size <= 12; size++) $('size').add(new Option(size + '-clock', size));
$('size').value = state.size;
$('initials').value = state.initials;
for (const field of ['inner', 'outer', 'multiply', 'missingNumber', 'sound']) {
  $(field).checked = state[field];
  $(field).addEventListener('change', () => {
    recordAnswer();
    state[field] = $(field).checked;
    persist();
    if (field === 'sound') unlockAudio();
    if (field === 'multiply' || field === 'missingNumber') {
      showProblem();
      persist();
    }
    if (field === 'inner' || field === 'outer') drawClock();
  });
}
$('size').addEventListener('change', () => {
  recordAnswer();
  state.size = Number($('size').value);
  hour = 0;
  persist();
  drawClock();
  showProblem();
});
$('initials').addEventListener('input', () => {
  recordAnswer();
  const previous = initials();
  state.initials = $('initials').value;
  if (previous !== initials()) showProblem();
  persist();
});
for (const [button, step] of [['prev', -1], ['next', 1]]) {
  $(button).addEventListener('click', () => {
    recordAnswer();
    const set = getSet();
    set.index += step;
    if (!set.problems[set.index]) set.problems.push(makeProblem(state.size, state.multiply, !state.missingNumber, set.index));
    persist();
    showProblem(step > 0);
  });
}

function showNotice(message) {
  $('save-note').textContent = message;
  $('save-note').hidden = false;
}
let exportTimer;
$('export').addEventListener('click', () => {
  recordAnswer(false);
  if (!state.attempts.length) {
    showNotice('Answer a problem to export results.');
    return;
  }
  const url = URL.createObjectURL(makeAttemptWorkbook(state.attempts));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'fox-clock-results.xlsx';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  $('save-note').hidden = true;
  $('export').dataset.exported = '';
  $('export-label').textContent = '✓ Excel downloaded';
  clearTimeout(exportTimer);
  exportTimer = setTimeout(() => {
    delete $('export').dataset.exported;
    $('export-label').textContent = '↓ Export Excel';
  }, 2500);
});
drawClock();
showProblem();
persist();

document.addEventListener('click', unlockAudio, { once: true });
document.addEventListener('keydown', unlockAudio, { once: true });

const header = $('site-header');
const headerToggle = $('header-toggle');
function setHeaderOpen(open) {
  headerToggle.setAttribute('aria-expanded', String(open));
  header.classList.toggle('open', open);
}
headerToggle.addEventListener('click', () => setHeaderOpen(!header.classList.contains('open')));
document.addEventListener('pointerdown', event => {
  if (header.classList.contains('open') && !header.contains(event.target)) setHeaderOpen(false);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && header.classList.contains('open')) {
    setHeaderOpen(false);
    headerToggle.focus();
  }
});
