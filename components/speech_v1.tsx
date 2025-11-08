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
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    audioChunksRef.current = [];
    setIsListening(false);
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
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        await processAudio();
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }
      };

      // Start recording
      mediaRecorder.start();
      setIsListening(true);

      // Process audio in chunks (every 3 seconds)
      const intervalId = setInterval(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop();
          mediaRecorderRef.current.start();
        }
      }, 3000);

      // Store interval ID for cleanup
      (mediaRecorderRef.current as any).intervalId = intervalId;

    } catch (err: any) {
      setError(`Failed to access microphone: ${err.message}`);
      setIsListening(false);
      console.error('Microphone access error:', err);
    }
  };

  const stopListening = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      if ((mediaRecorderRef.current as any).intervalId) {
        clearInterval((mediaRecorderRef.current as any).intervalId);
      }
      mediaRecorderRef.current.stop();
    }
    setIsListening(false);
  };

  const processAudio = async () => {
    if (audioChunksRef.current.length === 0 || !transcriberRef.current) {
      return;
    }

    try {
      setIsProcessing(true);
      
      // Combine audio chunks
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      
      // Create audio context to convert to the format Whisper expects
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ 
        sampleRate: 16000 
      });
      
      // Convert blob to array buffer
      const arrayBuffer = await audioBlob.arrayBuffer();
      
      // Decode audio data
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      
      // Get the first channel (mono) and resample if needed
      let audioData: Float32Array = audioBuffer.getChannelData(0);
      
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
        const newText = result.text.trim();
        if (newText) {
          setTranscript((prev) => prev + (prev ? ' ' : '') + newText);
        }
      }

      // Cleanup
      audioContext.close();
      audioChunksRef.current = [];
      setIsProcessing(false);
    } catch (err: any) {
      setIsProcessing(false);
      setError(`Transcription error: ${err.message}`);
      console.error('Transcription error:', err);
      audioChunksRef.current = [];
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
