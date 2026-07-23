// Web Audio API Sound Synthesizer
let ctx;
let engineOsc, engineGain;
let driftOsc, driftGain;
let audioInitialized = false;

export function initAudio() {
  if (audioInitialized) return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  
  ctx = new AudioContext();
  
  // Engine Drone
  engineOsc = ctx.createOscillator();
  engineOsc.type = 'sawtooth';
  engineOsc.frequency.value = 50;
  
  engineGain = ctx.createGain();
  engineGain.gain.value = 0.05;
  
  // Lowpass filter for engine to muffle it
  const engineFilter = ctx.createBiquadFilter();
  engineFilter.type = 'lowpass';
  engineFilter.frequency.value = 400;
  
  engineOsc.connect(engineFilter);
  engineFilter.connect(engineGain);
  engineGain.connect(ctx.destination);
  engineOsc.start();
  
  // Drift Squeal
  driftOsc = ctx.createOscillator();
  driftOsc.type = 'triangle';
  driftOsc.frequency.value = 800;
  
  driftGain = ctx.createGain();
  driftGain.gain.value = 0;
  
  // Highpass filter for squeal
  const driftFilter = ctx.createBiquadFilter();
  driftFilter.type = 'highpass';
  driftFilter.frequency.value = 2000;
  
  driftOsc.connect(driftFilter);
  driftFilter.connect(driftGain);
  driftGain.connect(ctx.destination);
  driftOsc.start();

  audioInitialized = true;
}

export function updateAudio(speed, maxSpeed, isDrifting) {
  if (!audioInitialized || !ctx) return;
  if (ctx.state === 'suspended') ctx.resume();
  
  // Engine sound mapping (base idle 50Hz, max speed 180Hz)
  const speedRatio = Math.max(0, Math.min(1, speed / maxSpeed));
  const targetFreq = 50 + speedRatio * 130;
  engineOsc.frequency.setTargetAtTime(targetFreq, ctx.currentTime, 0.1);
  
  // Engine volume mapping (louder when moving)
  const targetGain = 0.05 + speedRatio * 0.1;
  engineGain.gain.setTargetAtTime(targetGain, ctx.currentTime, 0.1);
  
  // Drift squeal mapping
  if (isDrifting && speedRatio > 0.2) {
    driftGain.gain.setTargetAtTime(0.08, ctx.currentTime, 0.05);
    driftOsc.frequency.setTargetAtTime(800 + Math.random() * 200, ctx.currentTime, 0.05);
  } else {
    driftGain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
  }
}

export function playCoin() {
  if (!audioInitialized || !ctx) return;
  if (ctx.state === 'suspended') ctx.resume();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(987.77, ctx.currentTime); // B5
  osc.frequency.setValueAtTime(1318.51, ctx.currentTime + 0.1); // E6
  
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
  
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.5);
}

export function playCrash(intensity = 1) {
  if (!audioInitialized || !ctx) return;
  if (ctx.state === 'suspended') ctx.resume();
  // White noise crash
  const bufferSize = ctx.sampleRate * 0.3; 
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  
  const noiseSource = ctx.createBufferSource();
  noiseSource.buffer = buffer;
  
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1000;
  
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.3 * intensity, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
  
  noiseSource.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  noiseSource.start();
}

export function playBoost() {
  if (!audioInitialized || !ctx) return;
  if (ctx.state === 'suspended') ctx.resume();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(150, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.4);
  
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(2000, ctx.currentTime);
  filter.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.4);
  
  gain.gain.setValueAtTime(0.15, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
  
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.4);
}
