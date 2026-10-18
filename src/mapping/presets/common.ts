import type { DiscreteMapping } from '../types';

const DEG = Math.PI / 180;
export const deg = (d: number) => d * DEG;

/** Primary-hand chord selection shared by the chord presets: poses → degrees, fist → release, tilt → borrow. */
export const PRIMARY_CHORDS: DiscreteMapping[] = [
  {
    id: 'p-one',
    label: '1 finger → I',
    trigger: { kind: 'pose', role: 'primary', pose: 'one' },
    action: { type: 'chord.degree', degree: 1 },
  },
  {
    id: 'p-two',
    label: '2 fingers → ii',
    trigger: { kind: 'pose', role: 'primary', pose: 'two' },
    action: { type: 'chord.degree', degree: 2 },
  },
  {
    id: 'p-three',
    label: '3 fingers → iii',
    trigger: { kind: 'pose', role: 'primary', pose: 'three' },
    action: { type: 'chord.degree', degree: 3 },
  },
  {
    id: 'p-four',
    label: '4 fingers → IV',
    trigger: { kind: 'pose', role: 'primary', pose: 'four' },
    action: { type: 'chord.degree', degree: 4 },
  },
  {
    id: 'p-open',
    label: 'Open hand → V',
    trigger: { kind: 'pose', role: 'primary', pose: 'open' },
    action: { type: 'chord.degree', degree: 5 },
  },
  {
    id: 'p-ip',
    label: 'Index + pinky → vi',
    trigger: { kind: 'pose', role: 'primary', pose: 'indexPinky' },
    action: { type: 'chord.degree', degree: 6 },
  },
  {
    id: 'p-tip',
    label: 'Thumb + index + pinky → vii°',
    trigger: { kind: 'pose', role: 'primary', pose: 'thumbIndexPinky' },
    action: { type: 'chord.degree', degree: 7 },
  },
  {
    id: 'p-fist',
    label: 'Fist → release',
    trigger: { kind: 'pose', role: 'primary', pose: 'fist' },
    action: { type: 'chord.release' },
  },
  {
    id: 'p-lost',
    label: 'Hand leaves → release',
    trigger: { kind: 'event', role: 'primary', event: 'handLost' },
    action: { type: 'chord.release' },
  },
  {
    id: 'p-tilt',
    label: 'Tilt wrist past 30° → borrow from parallel mode',
    trigger: { kind: 'threshold', source: 'primary.rollAbs', above: deg(30), hysteresis: deg(12) },
    action: { type: 'chord.parallel', value: true },
    onExit: { type: 'chord.parallel', value: false },
  },
];
