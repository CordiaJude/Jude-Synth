// Web MIDI out: everything on the event bus (live parts and looper tracks) can also drive external synths
// or a DAW. Messages are timestamped from the audio clock so MIDI lands in time with the sound. MIDI
// access is only requested when the user switches it on (browsers ask for permission).

import { create } from 'zustand';
import { MidiTranslator, type ChannelLayout, type MidiMessage } from '../export/midiTranslate';
import { useLooper } from './looper';
import { bus, getEngine, onSessionStop } from './music';

export type MidiStatus = 'off' | 'requesting' | 'on' | 'denied' | 'unsupported';

interface MidiUi {
  supported: boolean;
  status: MidiStatus;
  ports: Array<{ id: string; name: string }>;
  portId: string | null;
  layout: 'split' | 'single';
  /** 0-based channel for the 'single' layout. */
  channel: number;
  /** Messages sent this session (shown so users can see it is working). */
  sent: number;
  error: string | null;
}

const SETTINGS_KEY = 'handwave.midi.v1';
const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as Partial<MidiUi> | null;
  } catch {
    return null;
  }
})();

const supported = typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;

export const useMidi = create<MidiUi>()(() => ({
  supported,
  status: supported ? 'off' : 'unsupported',
  ports: [],
  portId: saved?.portId ?? null,
  layout: saved?.layout === 'single' ? 'single' : 'split',
  channel: typeof saved?.channel === 'number' ? Math.max(0, Math.min(15, saved.channel)) : 0,
  sent: 0,
  error: null,
}));

useMidi.subscribe((s, prev) => {
  if (s.portId !== prev.portId || s.layout !== prev.layout || s.channel !== prev.channel) {
    try {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ portId: s.portId, layout: s.layout, channel: s.channel }),
      );
    } catch {
      /* not persisted */
    }
  }
});

let access: MIDIAccess | null = null;
let output: MIDIOutput | null = null;
const translator = new MidiTranslator();
let pending = 0;

const layout = (): ChannelLayout => {
  const s = useMidi.getState();
  return s.layout === 'single' ? { kind: 'single', channel: s.channel } : { kind: 'split' };
};

function send(msgs: MidiMessage[]) {
  if (!output || !msgs.length) return;
  const engine = getEngine();
  const nowMs = performance.now();
  for (const m of msgs) {
    // Same moment as the audio reaches the speakers; anything already due goes out immediately.
    const at = engine ? engine.heardAt(m.time) - performance.timeOrigin : nowMs;
    try {
      if (at > nowMs + 1) output.send(m.data, at);
      else output.send(m.data);
    } catch (err) {
      console.warn('[midi] send failed', err);
    }
  }
  pending += msgs.length;
}

// Count sent messages for the UI at a gentle rate.
setInterval(() => {
  if (pending) {
    useMidi.setState((s) => ({ sent: s.sent + pending }));
    pending = 0;
  }
}, 500);

bus.on((e) => {
  if (output) send(translator.translate(e));
});

function refreshPorts() {
  if (!access) return;
  const ports = [...access.outputs.values()].map((p) => ({ id: p.id, name: p.name ?? p.id }));
  const s = useMidi.getState();
  const portId = ports.some((p) => p.id === s.portId) ? s.portId : (ports[0]?.id ?? null);
  useMidi.setState({ ports, portId });
  selectPort(portId);
}

function selectPort(id: string | null) {
  const next = id && access ? (access.outputs.get(id) ?? null) : null;
  if (next === output) return;
  if (output) send(translator.panic(0));
  output = next;
}

useLooper.subscribe((s, prev) => {
  if (s.project.tracks !== prev.project.tracks) translator.setTracks(s.project.tracks.map((t) => t.id));
});
translator.setTracks(useLooper.getState().project.tracks.map((t) => t.id));

onSessionStop(() => send(translator.panic(0)));

export const midi = {
  async enable(): Promise<void> {
    if (!supported) return;
    useMidi.setState({ status: 'requesting', error: null });
    try {
      access = await navigator.requestMIDIAccess({ sysex: false });
      access.onstatechange = refreshPorts;
      translator.setLayout(layout());
      useMidi.setState({ status: 'on' });
      refreshPorts();
    } catch (err) {
      access = null;
      useMidi.setState({ status: 'denied', error: err instanceof Error ? err.message : String(err) });
    }
  },
  disable(): void {
    send(translator.panic(0));
    output = null;
    if (access) access.onstatechange = null;
    access = null;
    useMidi.setState({ status: supported ? 'off' : 'unsupported', ports: [] });
  },
  selectPort(id: string): void {
    useMidi.setState({ portId: id });
    selectPort(id);
  },
  setLayout(kind: 'split' | 'single', channel?: number): void {
    send(translator.panic(0));
    useMidi.setState({ layout: kind, ...(channel !== undefined ? { channel } : {}) });
    translator.setLayout(layout());
  },
  panic(): void {
    send(translator.panic(0));
  },
};
