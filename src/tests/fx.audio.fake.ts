/**
 * Web Audio falso para probar el motor de audio en Node. Registra el grafo (nodos, conexiones, automatización)
 * y hace cumplir las reglas que un navegador real castiga con una excepción: rampas exponenciales a cero,
 * curvas superpuestas, detener una fuente que nunca arrancó, etc.
 */

type EventType = 'set' | 'linear' | 'exp' | 'target' | 'curve';

export interface ParamEvent {
  type: EventType;
  time: number;
  value?: number;
  timeConstant?: number;
  duration?: number;
  values?: Float32Array;
}

function checkTime(time: number): void {
  if (!Number.isFinite(time) || time < 0) throw new RangeError(`tiempo inválido: ${time}`);
}

export class FakeParam {
  readonly events: ParamEvent[] = [];
  private ctx: { currentTime: number };
  private current: number;

  constructor(ctx: { currentTime: number }, initial: number) {
    this.ctx = ctx;
    this.current = initial;
  }

  get value(): number {
    return this.current;
  }

  set value(v: number) {
    this.current = v;
    this.events.push({ type: 'set', time: this.ctx.currentTime, value: v });
  }

  private insert(ev: ParamEvent): this {
    checkTime(ev.time);
    for (const c of this.events) {
      if (c.type === 'curve' && ev.time > c.time && ev.time < c.time + (c.duration ?? 0)) {
        throw new Error(`evento en t=${ev.time} dentro de una curva (${c.time}..${c.time + (c.duration ?? 0)})`);
      }
    }
    this.events.push(ev);
    return this;
  }

  setValueAtTime(value: number, time: number): this {
    return this.insert({ type: 'set', time, value });
  }

  linearRampToValueAtTime(value: number, time: number): this {
    return this.insert({ type: 'linear', time, value });
  }

  exponentialRampToValueAtTime(value: number, time: number): this {
    if (!(value > 0)) throw new RangeError(`rampa exponencial a ${value}`);
    return this.insert({ type: 'exp', time, value });
  }

  setTargetAtTime(value: number, time: number, timeConstant: number): this {
    if (!(timeConstant >= 0)) throw new RangeError('constante de tiempo negativa');
    return this.insert({ type: 'target', time, value, timeConstant });
  }

  setValueCurveAtTime(values: ArrayLike<number>, time: number, duration: number): this {
    if (values.length < 2) throw new Error('una curva necesita al menos 2 valores');
    if (!(duration > 0)) throw new RangeError('duración de curva inválida');
    checkTime(time);
    for (const c of this.events) {
      const end = time + duration;
      if (c.type === 'curve') {
        if (time < c.time + (c.duration ?? 0) && c.time < end) throw new Error('curvas superpuestas');
      } else if (c.time > time && c.time < end) {
        throw new Error('la curva pisa un evento posterior');
      }
    }
    this.events.push({ type: 'curve', time, duration, values: Float32Array.from(values) });
    return this;
  }

  cancelScheduledValues(time: number): this {
    checkTime(time);
    for (let i = this.events.length - 1; i >= 0; i--) if (this.events[i].time >= time) this.events.splice(i, 1);
    return this;
  }
}

export class FakeNode {
  readonly context: FakeContext;
  readonly kind: string;
  readonly outputs = new Set<unknown>();
  disconnectCalls = 0;
  [key: string]: unknown;

  constructor(context: FakeContext, kind: string) {
    this.context = context;
    this.kind = kind;
  }

  connect<T>(dest: T): T {
    if (!dest) throw new TypeError('connect sin destino');
    this.outputs.add(dest);
    return dest;
  }

  disconnect(): void {
    this.disconnectCalls++;
    this.outputs.clear();
  }
}

export interface FakeSource extends FakeNode {
  started: boolean;
  startTime: number;
  stopTime: number;
  stopCalls: number;
  onended: (() => void) | null;
  start: (when?: number, offset?: number) => void;
  stop: (when?: number) => void;
  fireEnded: () => void;
}

export class FakeBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  private data: Float32Array[];

  constructor(channels: number, length: number, sampleRate: number) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.data = Array.from({ length: channels }, () => new Float32Array(length));
  }

  get duration(): number {
    return this.length / this.sampleRate;
  }

  getChannelData(c: number): Float32Array {
    return this.data[c];
  }

  copyToChannel(source: Float32Array, c: number): void {
    this.data[c].set(source);
  }
}

export class FakeContext {
  currentTime = 0;
  sampleRate = 48000;
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  readonly nodes: FakeNode[] = [];
  readonly destination: FakeNode;

  constructor() {
    this.destination = new FakeNode(this, 'destination');
  }

  private make<T extends FakeNode>(kind: string, extra: Record<string, unknown> = {}): T {
    const n = new FakeNode(this, kind);
    Object.assign(n, extra);
    this.nodes.push(n);
    return n as T;
  }

  private param(initial: number): FakeParam {
    return new FakeParam(this, initial);
  }

  createGain(): FakeNode {
    return this.make('gain', { gain: this.param(1) });
  }

  createBiquadFilter(): FakeNode {
    return this.make('biquad', { type: 'lowpass', frequency: this.param(350), Q: this.param(1), gain: this.param(0) });
  }

  createWaveShaper(): FakeNode {
    return this.make('shaper', { curve: null, oversample: 'none' });
  }

  createDynamicsCompressor(): FakeNode {
    return this.make('compressor', {
      threshold: this.param(-24), knee: this.param(30), ratio: this.param(12), attack: this.param(0.003), release: this.param(0.25),
    });
  }

  createConvolver(): FakeNode {
    return this.make('convolver', { buffer: null, normalize: true });
  }

  private source(kind: string, extra: Record<string, unknown>): FakeSource {
    const s = this.make<FakeSource>(kind, {
      ...extra, started: false, startTime: 0, stopTime: Infinity, stopCalls: 0, onended: null,
    });
    s.start = (when = 0) => {
      if (s.started) throw new Error('start() ya llamado');
      checkTime(when);
      s.started = true;
      s.startTime = when;
    };
    s.stop = (when = 0) => {
      if (!s.started) throw new Error('stop() antes de start()');
      checkTime(when);
      s.stopCalls++;
      s.stopTime = when;
    };
    s.fireEnded = () => s.onended?.();
    return s;
  }

  createOscillator(): FakeSource {
    return this.source('oscillator', { type: 'sine', frequency: this.param(440), detune: this.param(0) });
  }

  createBufferSource(): FakeSource {
    return this.source('bufferSource', { buffer: null, loop: false, playbackRate: this.param(1) });
  }

  createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer {
    return new FakeBuffer(channels, length, sampleRate);
  }
}

export class FakeAudioContext extends FakeContext {
  /** si es false, resume() "funciona" pero el contexto sigue suspendido (sin gesto del usuario) */
  static autoResume = true;
  static instances: FakeAudioContext[] = [];
  readonly options: unknown;

  constructor(options?: unknown) {
    super();
    this.options = options;
    FakeAudioContext.instances.push(this);
  }

  resume(): Promise<void> {
    if (FakeAudioContext.autoResume) this.state = 'running';
    return Promise.resolve();
  }

  static reset(): void {
    FakeAudioContext.autoResume = true;
    FakeAudioContext.instances = [];
  }
}

export class FakeOfflineAudioContext extends FakeContext {
  readonly length: number;
  static last: FakeOfflineAudioContext | null = null;

  constructor(_channels: number, length: number, sampleRate: number) {
    super();
    this.length = length;
    this.sampleRate = sampleRate;
    FakeOfflineAudioContext.last = this;
  }

  startRendering(): Promise<FakeBuffer> {
    return Promise.resolve(new FakeBuffer(2, this.length, this.sampleRate));
  }
}
