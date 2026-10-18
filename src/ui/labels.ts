import type { PoseId } from '../gestures/types';

export const POSE_LABEL: Record<PoseId, string> = {
  fist: 'Fist',
  one: 'One',
  two: 'Two',
  three: 'Three',
  four: 'Four',
  open: 'Open hand',
  indexPinky: 'Index + pinky',
  thumbIndexPinky: 'Thumb + index + pinky',
  thumbOnly: 'Thumb only',
  pinch: 'Pinch (OK)',
  none: '—',
};

export const ROLE_LABEL = { primary: 'Primary', secondary: 'Secondary' } as const;
