import { useCallback, useEffect, useRef, useState } from 'react';
import { blobToWavBase64 } from '../../lib/audio-to-wav';

/**
 * Dictado para la anotación rápida.
 *
 * 1. Grabar y transcribir en el servidor. Es el camino normal. El servidor
 *    sesga el reconocimiento con los nombres reales de clientes y productos,
 *    que es lo único que hace acertar "Delcy" o "Camaron Vivito", y aguanta
 *    mucho mejor el ruido del mercado.
 * 2. Reconocimiento nativo del navegador (SpeechRecognition), solo si no se
 *    puede grabar (micrófono denegado o sin MediaRecorder).
 *
 * El nativo era el camino principal y se degradó a respaldo tras probarlo en
 * uso real: no conoce el vocabulario del negocio, falla con ruido, y al mostrar
 * resultados parciales reescribe las palabras mientras uno habla, que se ve
 * como si se equivocara. Grabar entero y transcribir de una vez da un texto
 * estable y correcto a cambio de unos segundos de espera.
 */

export type SpeechState = 'idle' | 'listening' | 'transcribing' | 'unsupported';

/** Silencio tras el cual se da por terminado el dictado */
const SILENCE_MS = 1800;
/** Piso mínimo de voz. En sitios ruidosos el umbral real se calcula sobre el
 *  ruido ambiente medido, no sobre este valor. */
const SILENCE_FLOOR = 8;
/** Cuánto debe superar la voz al ruido de fondo para contar como habla */
const VOICE_OVER_NOISE = 1.7;
/** Ventana inicial que se usa para medir el ruido ambiente antes de escuchar */
const NOISE_SAMPLE_MS = 500;
/** Corte duro para que una grabación olvidada no crezca sin límite */
const MAX_RECORDING_MS = 60000;

interface UseSpeechInputOptions {
  /** Texto parcial mientras se dicta (solo camino nativo) */
  onInterim?: (text: string) => void;
  /** Texto final listo para procesar */
  onFinal: (text: string) => void;
  onError?: (message: string) => void;
}

export function useSpeechInput({ onInterim, onFinal, onError }: UseSpeechInputOptions) {
  const [state, setState] = useState<SpeechState>('idle');
  /** true mientras se graba (camino normal); false si corrió el nativo */
  const [isRecording, setIsRecording] = useState(false);

  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const maxTimerRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const finalTextRef = useRef('');
  /** Evita que onFinal se dispare dos veces (p.ej. silencio + onend del navegador) */
  const settledRef = useRef(false);

  const clearTimers = useCallback(() => {
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    if (maxTimerRef.current) { clearTimeout(maxTimerRef.current); maxTimerRef.current = null; }
  }, []);

  const releaseMic = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
  }, []);

  // Si el componente se desmonta mientras escucha, hay que soltar el micrófono
  // o el indicador del navegador se queda encendido.
  useEffect(() => {
    return () => {
      clearTimers();
      try { recognitionRef.current?.abort(); } catch { /* ya estaba detenido */ }
      try { mediaRecorderRef.current?.stop(); } catch { /* ya estaba detenido */ }
      releaseMic();
    };
  }, [clearTimers, releaseMic]);

  // ─── Camino 2: grabar y transcribir en el servidor ────────────────────

  const startRecording = useCallback(async () => {
    setIsRecording(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // El DSP del navegador es lo que salva la grabación en un sitio
          // ruidoso; sin esto el modelo transcribe el mercado junto con la voz.
          noiseSuppression: true,
          echoCancellation: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        clearTimers();
        releaseMic();
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        chunksRef.current = [];

        if (blob.size < 1000) { // ruido o toque accidental
          setState('idle');
          return;
        }

        setState('transcribing');
        try {
          const audioBase64 = await blobToWavBase64(blob);
          const res = await fetch('/api/transcribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ audioBase64 }),
          });
          const data = await res.json();
          if (data.success && data.text?.trim()) {
            onFinal(data.text.trim());
          } else if (!data.success) {
            onError?.(data.error || 'No se pudo transcribir');
          }
        } catch {
          onError?.('Error al transcribir el audio');
        } finally {
          setState('idle');
        }
      };

      // Detección de silencio sobre el nivel del micrófono
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx: AudioContext = new AudioCtx();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      let hablo = false;

      // Calibración: los primeros milisegundos se usan para medir el ruido del
      // lugar y fijar el umbral por encima de él. Con un umbral fijo, en un
      // mercado el ruido de fondo ya lo supera y nunca se detecta el silencio,
      // así que la grabación corría hasta el tope de 60s.
      const inicio = performance.now();
      let ruidoAmbiente = 0;
      let muestras = 0;
      let umbral = SILENCE_FLOOR;

      const tick = () => {
        if (!audioCtxRef.current) return;
        analyser.getByteFrequencyData(data);
        const nivel = data.reduce((a, b) => a + b, 0) / data.length;

        if (performance.now() - inicio < NOISE_SAMPLE_MS) {
          ruidoAmbiente += nivel;
          muestras++;
          requestAnimationFrame(tick);
          return;
        }
        if (muestras > 0) {
          umbral = Math.max(SILENCE_FLOOR, (ruidoAmbiente / muestras) * VOICE_OVER_NOISE);
          muestras = 0;
        }

        if (nivel > umbral) {
          hablo = true;
          if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
        } else if (hablo && !silenceTimerRef.current) {
          // Solo se corta por silencio si antes hubo voz, para no cerrar
          // mientras el usuario todavía no empieza a hablar.
          silenceTimerRef.current = window.setTimeout(() => {
            try { recorder.stop(); } catch { /* ya detenido */ }
          }, SILENCE_MS);
        }
        requestAnimationFrame(tick);
      };

      recorder.start();
      setState('listening');
      requestAnimationFrame(tick);

      maxTimerRef.current = window.setTimeout(() => {
        try { recorder.stop(); } catch { /* ya detenido */ }
      }, MAX_RECORDING_MS);
    } catch {
      setState('idle');
      onError?.('No se pudo acceder al micrófono. Revisa los permisos.');
    }
  }, [clearTimers, releaseMic, onFinal, onError]);

  // ─── Camino 1: reconocimiento nativo ──────────────────────────────────

  const startNative = useCallback(() => {
    setIsRecording(false);
    finalTextRef.current = '';
    settledRef.current = false;

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setState('idle');
      onError?.('Este navegador no permite dictar. Escribe la anotación.');
      return;
    }

    const settle = () => {
      if (settledRef.current) return;
      settledRef.current = true;
      clearTimers();
      try { recognitionRef.current?.stop(); } catch { /* ya detenido */ }
      setState('idle');
      const texto = finalTextRef.current.trim();
      if (texto) onFinal(texto);
    };

    try {
      const recognition = new SR();
      recognitionRef.current = recognition;
      recognition.lang = 'es-VE';
      // continuous permite dictar una lista completa sin que se corte entre
      // producto y producto; el cierre lo decide el temporizador de silencio.
      recognition.continuous = true;
      recognition.interimResults = true;

      recognition.onresult = (event: any) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          if (res.isFinal) finalTextRef.current += res[0].transcript;
          else interim += res[0].transcript;
        }
        onInterim?.((finalTextRef.current + interim).trim());

        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = window.setTimeout(settle, SILENCE_MS);
      };

      recognition.onerror = (event: any) => {
        clearTimers();
        // 'not-allowed' y 'service-not-allowed' son el bloqueo de Safari en PWA
        // y también el permiso denegado. En el primer caso el respaldo funciona;
        // en el segundo volverá a pedir permiso, que es lo correcto.
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          setState('idle');
          onError?.('Permiso de micrófono denegado.');
          return;
        }
        if (event.error === 'no-speech' || event.error === 'aborted') {
          setState('idle');
          return;
        }
        setState('idle');
        onError?.('No se pudo escuchar. Intenta de nuevo.');
      };

      recognition.onend = settle;

      recognition.start();
      setState('listening');
      maxTimerRef.current = window.setTimeout(settle, MAX_RECORDING_MS);
    } catch {
      setState('idle');
      onError?.('No se pudo iniciar el dictado.');
    }
  }, [clearTimers, onInterim, onFinal, onError]);

  /**
   * Punto de entrada: intenta grabar (camino bueno) y solo cae al
   * reconocimiento nativo si el navegador no da acceso al micrófono.
   */
  const start = useCallback(() => {
    if (state !== 'idle') return;
    settledRef.current = false;
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      startNative();
      return;
    }
    startRecording();
  }, [state, startRecording, startNative]);

  /** Corta el dictado y procesa lo que se haya capturado */
  const stop = useCallback(() => {
    clearTimers();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      try { mediaRecorderRef.current.stop(); } catch { /* ya detenido */ }
      return;
    }
    try { recognitionRef.current?.stop(); } catch { /* ya detenido */ }
  }, [clearTimers]);

  /** Cancela sin procesar nada */
  const cancel = useCallback(() => {
    settledRef.current = true;
    finalTextRef.current = '';
    clearTimers();
    try { recognitionRef.current?.abort(); } catch { /* ya detenido */ }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      chunksRef.current = [];
      try { mediaRecorderRef.current.stop(); } catch { /* ya detenido */ }
    }
    releaseMic();
    setState('idle');
  }, [clearTimers, releaseMic]);

  return { state, isRecording, start, stop, cancel };
}
