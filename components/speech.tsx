'use client';

import { useState, useEffect, useRef } from 'react';
import { pipeline, env } from '@xenova/transformers';

// Disable local model files (use CDN)
env.allowLocalModels = false;

export default function SpeechToText() {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [isSupported, setIsSupported] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelLoaded, setModelLoaded] = useState(false);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const transcriberRef = useRef<any>(null);
  const isProcessingRef = useRef<boolean>(false);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastSpeechTimeRef = useRef<number>(0);

  useEffect(() => {
    // Check if browser supports required APIs
    const hasMediaRecorder = typeof MediaRecorder !== 'undefined';
    const hasGetUserMedia = 
      navigator.mediaDevices && 
      typeof navigator.mediaDevices.getUserMedia === 'function';
    const hasWebAssembly = typeof WebAssembly !== 'undefined';

    if (hasMediaRecorder && hasGetUserMedia && hasWebAssembly) {
      setIsSupported(true);
      initializeModel();
    } else {
      setIsSupported(false);
      setError('Your browser does not support offline speech recognition. Please use a modern browser like Chrome, Edge, or Firefox.');
    }

    return () => {
      cleanup();
    };
  }, []);

  const initializeModel = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      // Initialize Whisper model (using tiny model for faster loading and processing)
      // You can change to 'Xenova/whisper-base.en' or 'Xenova/whisper-small.en' for better accuracy
      const transcriber = await pipeline(
        'automatic-speech-recognition',
        'Xenova/whisper-tiny.en',
        {
          quantized: true, // Use quantized model for smaller size
        }
      );
      
      transcriberRef.current = transcriber;
      setModelLoaded(true);
      setIsLoading(false);
    } catch (err: any) {
      setIsLoading(false);
      setModelLoaded(false);
      setError(`Failed to load Whisper model: ${err.message}. Please check your internet connection for initial model download.`);
      console.error('Model initialization error:', err);
    }
  };

  const cleanup = () => {
    // Clear silence detection timer
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    
    // Stop media recorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch (err) {
        console.error('Error stopping media recorder:', err);
      }
    }
    mediaRecorderRef.current = null;
    
    // Close audio context
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(console.error);
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    
    // Stop stream tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        track.stop();
      });
      streamRef.current = null;
    }
    
    audioChunksRef.current = [];
    setIsListening(false);
    isProcessingRef.current = false;
    lastSpeechTimeRef.current = 0;
  };

  const startListening = async () => {
    if (!modelLoaded || !transcriberRef.current) {
      setError('Model is not loaded yet. Please wait...');
      return;
    }

    try {
      setError(null);
      audioChunksRef.current = [];

      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          channelCount: 1,
          sampleRate: 16000, // Whisper expects 16kHz
          echoCancellation: true,
          noiseSuppression: true,
        } 
      });
      
      streamRef.current = stream;

      // Create MediaRecorder with WebM format
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });

      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        // When recorder stops, process the audio if we're still listening
        if (streamRef.current && streamRef.current.active && !isProcessingRef.current) {
          // Process audio asynchronously
          processAudioAndContinue().catch(err => {
            console.error('Error in processAudioAndContinue:', err);
          });
        }
      };

      mediaRecorder.onerror = (event) => {
        console.error('MediaRecorder error:', event);
        setError('Recording error occurred. Please try again.');
      };

      // Create AudioContext for voice activity detection
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000
      });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Start recording continuously - request data every 100ms
      mediaRecorder.start(100);
      setIsListening(true);

      // Start voice activity detection
      startVoiceActivityDetection();

    } catch (err: any) {
      setError(`Failed to access microphone: ${err.message}`);
      setIsListening(false);
      console.error('Microphone access error:', err);
    }
  };

  const stopListening = () => {
    setIsListening(false);
    
    // Clear silence detection timer
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    
    // Stop media recorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch (err) {
        console.error('Error stopping recorder:', err);
      }
    }
    
    // Stop stream tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    // Close audio context
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(console.error);
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    
    // Process any remaining audio chunks
    if (audioChunksRef.current.length > 0 && !isProcessingRef.current) {
      processAudio().catch(err => {
        console.error('Error processing final audio:', err);
      });
    }
  };

  // Voice Activity Detection - detects when user stops speaking
  const startVoiceActivityDetection = () => {
    if (!analyserRef.current) return;

    const analyser = analyserRef.current;
    const bufferLength = analyser.fftSize;
    const dataArray = new Uint8Array(bufferLength);
    const silenceThreshold = 20; // Amplitude threshold (0-255, lower = more sensitive)
    const silenceDuration = 1500; // Process after 1.5 seconds of silence (ms)
    const hasRecordedSpeechRef = { current: false }; // Use object to persist in closure

    const checkAudioLevel = () => {
      if (!analyserRef.current || !streamRef.current || !streamRef.current.active) {
        return;
      }

      // Use time domain data (amplitude) instead of frequency data for better voice detection
      analyser.getByteTimeDomainData(dataArray);
      
      // Calculate RMS (Root Mean Square) for amplitude
      let sumSquares = 0;
      for (let i = 0; i < bufferLength; i++) {
        const normalized = (dataArray[i] - 128) / 128; // Normalize to -1 to 1
        sumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumSquares / bufferLength);
      const amplitude = rms * 255; // Convert back to 0-255 range

      const now = Date.now();

      if (amplitude > silenceThreshold) {
        // Speech detected
        lastSpeechTimeRef.current = now;
        hasRecordedSpeechRef.current = true; // Mark that we've recorded speech
        
        // Clear any existing silence timer
        if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
        }
      } else {
        // Silence detected
        const timeSinceLastSpeech = now - lastSpeechTimeRef.current;
        
        // If we have recorded speech, have audio chunks, and silence duration is met, process it
        if (hasRecordedSpeechRef.current &&
            timeSinceLastSpeech >= silenceDuration && 
            audioChunksRef.current.length > 0 && 
            !isProcessingRef.current &&
            !silenceTimerRef.current &&
            mediaRecorderRef.current &&
            mediaRecorderRef.current.state === 'recording') {
          
          // Set a timer to process after silence duration
          silenceTimerRef.current = setTimeout(() => {
            if (mediaRecorderRef.current && 
                mediaRecorderRef.current.state === 'recording' &&
                streamRef.current &&
                streamRef.current.active &&
                !isProcessingRef.current) {
              try {
                mediaRecorderRef.current.stop();
                // Restart will happen in processAudioAndContinue
              } catch (err) {
                console.error('Error stopping recorder for processing:', err);
                silenceTimerRef.current = null;
              }
            } else {
              silenceTimerRef.current = null;
            }
          }, 100);
        }
      }

      // Continue monitoring if still listening
      if (streamRef.current && streamRef.current.active) {
        requestAnimationFrame(checkAudioLevel);
      }
    };

    // Initialize last speech time
    lastSpeechTimeRef.current = Date.now();
    checkAudioLevel();
  };

  // Process audio and continue recording
  const processAudioAndContinue = async () => {
    // Clear the silence timer
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    
    // Process the current audio
    await processAudio();
    
    // Restart recording if still listening
    if (streamRef.current && 
        streamRef.current.active && 
        mediaRecorderRef.current &&
        !isProcessingRef.current) {
      try {
        // Clear chunks for new recording
        audioChunksRef.current = [];
        lastSpeechTimeRef.current = Date.now();
        
        // Restart recording
        if (mediaRecorderRef.current.state === 'inactive') {
          mediaRecorderRef.current.start(100); // Request data every 100ms
        }
      } catch (err) {
        console.error('Error restarting recorder:', err);
      }
    }
  };

  // Check if audio contains actual sound (not silence)
  const hasAudioContent = (audioData: Float32Array, threshold: number = 0.01): boolean => {
    // Calculate RMS (Root Mean Square) to detect audio level
    let sumSquares = 0;
    for (let i = 0; i < audioData.length; i++) {
      sumSquares += audioData[i] * audioData[i];
    }
    const rms = Math.sqrt(sumSquares / audioData.length);
    return rms > threshold;
  };

  const processAudio = async () => {
    // Prevent concurrent processing
    if (isProcessingRef.current || audioChunksRef.current.length === 0 || !transcriberRef.current) {
      return;
    }

    // Mark as processing
    isProcessingRef.current = true;
    setIsProcessing(true);

    // Create a copy of chunks and clear the ref immediately to allow new recording
    const chunksToProcess = [...audioChunksRef.current];
    audioChunksRef.current = [];

    let audioContext: AudioContext | null = null;

    try {
      // Validate blob size
      if (chunksToProcess.length === 0) {
        isProcessingRef.current = false;
        setIsProcessing(false);
        return;
      }
      
      // Combine audio chunks
      const audioBlob = new Blob(chunksToProcess, { type: 'audio/webm' });
      
      // Validate blob size (must have some data)
      if (audioBlob.size === 0) {
        isProcessingRef.current = false;
        setIsProcessing(false);
        return;
      }
      
      // Create audio context to convert to the format Whisper expects
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ 
        sampleRate: 16000 
      });
      
      // Convert blob to array buffer
      const arrayBuffer = await audioBlob.arrayBuffer();
      
      // Validate array buffer
      if (arrayBuffer.byteLength === 0) {
        if (audioContext) audioContext.close();
        isProcessingRef.current = false;
        setIsProcessing(false);
        return;
      }
      
      // Decode audio data with error handling
      let audioBuffer: AudioBuffer;
      try {
        audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
      } catch (decodeError: any) {
        // If decode fails, it might be because the blob is incomplete or corrupted
        // This can happen when the recorder stops mid-recording
        console.warn('Failed to decode audio data, skipping this chunk:', decodeError.message);
        if (audioContext) audioContext.close();
        isProcessingRef.current = false;
        setIsProcessing(false);
        return; // Don't show error to user, just skip this chunk
      }
      
      // Get the first channel (mono) and resample if needed
      let audioData: Float32Array = audioBuffer.getChannelData(0);
      
      // Check if audio is too short (less than 0.5 seconds at 16kHz = 8000 samples)
      if (audioData.length < 8000) {
        if (audioContext) audioContext.close();
        isProcessingRef.current = false;
        setIsProcessing(false);
        return;
      }
      
      // Check if audio contains actual sound (not silence)
      if (!hasAudioContent(audioData, 0.005)) {
        if (audioContext) audioContext.close();
        isProcessingRef.current = false;
        setIsProcessing(false);
        return;
      }
      
      // Resample to 16kHz if needed
      if (audioBuffer.sampleRate !== 16000) {
        audioData = resampleAudio(audioData, audioBuffer.sampleRate, 16000);
      }
      
      // Transcribe using Whisper - the pipeline can accept Float32Array directly
      const result = await transcriberRef.current(audioData, {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: false,
      });

      if (result && result.text) {
        let newText = result.text.trim();
        
        // Filter out [BLANK_AUDIO] and similar tokens
        newText = newText.replace(/\[BLANK_AUDIO\]/gi, '').trim();
        
        // Only add non-empty text that doesn't contain only special tokens
        if (newText && !/^[\s\[\]()]*$/.test(newText)) {
          setTranscript((prev) => prev + (prev ? ' ' : '') + newText);
        }
      }

      // Cleanup
      if (audioContext) {
        audioContext.close();
      }
      isProcessingRef.current = false;
      setIsProcessing(false);
    } catch (err: any) {
      // Only show error if it's not a decode error (decode errors are handled above)
      if (!err.message || !err.message.includes('decode')) {
        setError(`Transcription error: ${err.message || 'Unknown error'}`);
        console.error('Transcription error:', err);
      } else {
        // For decode errors, just log and continue
        console.warn('Audio decode error (skipping):', err.message);
      }
      
      if (audioContext) {
        try {
          audioContext.close();
        } catch (closeErr) {
          // Ignore close errors
        }
      }
      
      isProcessingRef.current = false;
      setIsProcessing(false);
    }
  };

  // Simple resampling function (linear interpolation)
  const resampleAudio = (audioData: Float32Array, fromRate: number, toRate: number): Float32Array => {
    if (fromRate === toRate) return audioData;
    
    const ratio = fromRate / toRate;
    const newLength = Math.round(audioData.length / ratio);
    const result = new Float32Array(newLength);
    
    for (let i = 0; i < newLength; i++) {
      const index = i * ratio;
      const indexFloor = Math.floor(index);
      const indexCeil = Math.min(indexFloor + 1, audioData.length - 1);
      const fraction = index - indexFloor;
      
      result[i] = audioData[indexFloor] * (1 - fraction) + audioData[indexCeil] * fraction;
    }
    
    return result;
  };

  const clearTranscript = () => {
    setTranscript('');
    setError(null);
  };

  const copyToClipboard = async () => {
    if (transcript) {
      try {
        await navigator.clipboard.writeText(transcript);
        // You could add a toast notification here
      } catch (err) {
        setError('Failed to copy to clipboard');
      }
    }
  };

  if (!isSupported) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center p-8 bg-red-50 dark:bg-red-900/20 rounded-2xl border border-red-200 dark:border-red-800">
          <p className="text-red-600 dark:text-red-400 text-lg">
            Offline speech recognition is not supported in your browser.
          </p>
          <p className="text-red-500 dark:text-red-500/80 text-sm mt-2">
            Please use Chrome, Edge, or Firefox with WebAssembly support.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-4xl mx-auto p-6">
      <div className="bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 rounded-3xl shadow-2xl p-8 md:p-12 border border-gray-200 dark:border-gray-700">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 bg-clip-text text-transparent mb-3">
            Speech to Text (Offline)
          </h1>
          <p className="text-gray-600 dark:text-gray-300 text-lg">
            Convert your speech into text using Whisper-WASM - works offline!
          </p>
          {!modelLoaded && (
            <p className="text-blue-600 dark:text-blue-400 text-sm mt-2">
              {isLoading ? 'Loading Whisper model... (first time only)' : 'Click to load model'}
            </p>
          )}
        </div>

        {/* Model Loading Button */}
        {!modelLoaded && !isLoading && (
          <div className="flex justify-center mb-6">
            <button
              onClick={initializeModel}
              className="px-6 py-3 bg-gradient-to-r from-purple-500 to-indigo-600 text-white rounded-xl font-medium shadow-lg hover:shadow-xl transition-all duration-200 hover:scale-105 active:scale-95"
            >
              Load Whisper Model
            </button>
          </div>
        )}

        {/* Loading Indicator */}
        {isLoading && (
          <div className="flex justify-center mb-6">
            <div className="text-center">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
              <p className="text-gray-600 dark:text-gray-300">
                Loading Whisper model... This may take a minute on first load.
              </p>
            </div>
          </div>
        )}

        {/* Microphone Button */}
        {modelLoaded && (
          <div className="flex justify-center mb-8">
            <button
              onClick={isListening ? stopListening : startListening}
              disabled={isProcessing}
              className={`relative w-32 h-32 md:w-40 md:h-40 rounded-full flex items-center justify-center transition-all duration-300 transform hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${
                isListening
                  ? 'bg-gradient-to-br from-red-500 to-pink-600 shadow-lg shadow-red-500/50 animate-pulse'
                  : 'bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-500/50 hover:shadow-xl hover:shadow-blue-500/60'
              }`}
            >
              <div className="absolute inset-0 rounded-full bg-white/20 animate-ping opacity-75"></div>
              <svg
                className="w-12 h-12 md:w-16 md:h-16 text-white z-10"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                {isListening ? (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                ) : (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                  />
                )}
              </svg>
            </button>
          </div>
        )}

        {/* Status Indicator */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm">
            <div
              className={`w-3 h-3 rounded-full ${
                isListening
                  ? 'bg-red-500 animate-pulse'
                  : isProcessing
                  ? 'bg-yellow-500 animate-pulse'
                  : modelLoaded
                  ? 'bg-green-500'
                  : 'bg-gray-400'
              }`}
            ></div>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {isProcessing
                ? 'Processing audio...'
                : isListening
                ? 'Listening...'
                : modelLoaded
                ? 'Ready to listen'
                : 'Model not loaded'}
            </span>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700 rounded-xl">
            <p className="text-red-700 dark:text-red-400 text-sm">{error}</p>
          </div>
        )}

        {/* Transcript Display */}
        <div className="mb-6">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-inner p-6 min-h-[200px] max-h-[400px] overflow-y-auto border border-gray-200 dark:border-gray-700">
            {transcript ? (
              <p className="text-gray-800 dark:text-gray-200 text-lg leading-relaxed whitespace-pre-wrap">
                {transcript}
              </p>
            ) : (
              <p className="text-gray-400 dark:text-gray-500 text-center italic">
                Your transcribed text will appear here...
              </p>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-4 justify-center">
          <button
            onClick={copyToClipboard}
            disabled={!transcript}
            className="px-6 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-xl font-medium shadow-lg hover:shadow-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 active:scale-95 flex items-center gap-2"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
            Copy Text
          </button>
          <button
            onClick={clearTranscript}
            disabled={!transcript}
            className="px-6 py-3 bg-gradient-to-r from-gray-500 to-gray-600 text-white rounded-xl font-medium shadow-lg hover:shadow-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 active:scale-95 flex items-center gap-2"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}
