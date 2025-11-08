'use client';

import { useState, useEffect, useRef } from 'react';
import { SessionManager, InferenceSession, MicRecorder, AvailableModels } from 'whisper-turbo';

export default function SpeechToText() {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [isSupported, setIsSupported] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [selectedModel, setSelectedModel] = useState<AvailableModels>(AvailableModels.WHISPER_TINY);
  
  const sessionRef = useRef<InferenceSession | null>(null);
  const micRecorderRef = useRef<MicRecorder | null>(null);
  const sessionManagerRef = useRef<SessionManager | null>(null);

  useEffect(() => {
    // Check if browser supports required APIs
    const hasGetUserMedia = 
      navigator.mediaDevices && 
      typeof navigator.mediaDevices.getUserMedia === 'function';
    const hasWebAssembly = typeof WebAssembly !== 'undefined';
    const hasWebGPU = 'gpu' in navigator;

    if (hasGetUserMedia && hasWebAssembly) {
      setIsSupported(true);
      // Initialize session manager
      sessionManagerRef.current = new SessionManager();
    } else {
      setIsSupported(false);
      setError('Your browser does not support offline speech recognition. Please use a modern browser like Chrome, Edge, or Firefox with WebAssembly support.');
    }

    return () => {
      cleanup();
    };
  }, []);

  const initializeModel = async () => {
    if (!sessionManagerRef.current) {
      setError('Session manager not initialized');
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      setLoadProgress(0);
      
      // Load model with progress callback
      const result = await sessionManagerRef.current.loadModel(
        selectedModel,
        (session: InferenceSession) => {
          // Callback receives the session directly when successful
          sessionRef.current = session;
        },
        (progress: number) => {
          setLoadProgress(progress);
        }
      );

      if (result.isErr) {
        setError(`Failed to initialize model: ${result.error.message}`);
        setIsLoading(false);
        setModelLoaded(false);
      } else {
        // Session is returned in the result
        sessionRef.current = result.value;
        setModelLoaded(true);
        setIsLoading(false);
      }
    } catch (err: any) {
      setIsLoading(false);
      setModelLoaded(false);
      setError(`Failed to load Whisper model: ${err.message}`);
      console.error('Model initialization error:', err);
    }
  };

  const cleanup = () => {
    if (micRecorderRef.current && micRecorderRef.current.isRecording()) {
      micRecorderRef.current.stop().catch(console.error);
    }
    if (sessionRef.current) {
      sessionRef.current.destroy();
      sessionRef.current = null;
    }
    setIsListening(false);
  };

  const startListening = async () => {
    if (!modelLoaded || !sessionRef.current) {
      setError('Model is not loaded yet. Please wait...');
      return;
    }

    try {
      setError(null);
      
      // Start microphone recording
      micRecorderRef.current = await MicRecorder.start();
      setIsListening(true);
    } catch (err: any) {
      setError(`Failed to access microphone: ${err.message}`);
      setIsListening(false);
      console.error('Microphone access error:', err);
    }
  };

  const stopListening = async () => {
    if (!micRecorderRef.current || !micRecorderRef.current.isRecording()) {
      setIsListening(false);
      return;
    }

    try {
      setIsProcessing(true);
      
      // Stop recording and get audio data
      const recording = await micRecorderRef.current.stop();
      
      if (!sessionRef.current) {
        setError('Session not available');
        setIsProcessing(false);
        return;
      }

      // Convert audio blob to Uint8Array
      const audioArray = new Uint8Array(recording.buffer);
      
      // Transcribe audio
      const result = await sessionRef.current.transcribe(
        audioArray,
        true, // raw_audio = true (PCM format)
        {
          language: 'en',
          task: 'transcribe',
        }
      );

      if (result.isOk) {
        const transcription = result.value;
        // Extract text from transcription result
        let transcribedText = '';
        
        // Handle different possible result formats
        if (Array.isArray(transcription)) {
          // If it's an array of segments, concatenate the text
          transcribedText = transcription
            .map((segment: any) => {
              // Handle segment object with text property
              if (typeof segment === 'object' && segment !== null) {
                return segment.text || segment.transcript || '';
              }
              // Handle string segments
              return typeof segment === 'string' ? segment : '';
            })
            .filter((text: string) => text.trim())
            .join(' ');
        } else if (transcription && typeof transcription === 'object') {
          // Handle object with text property
          transcribedText = transcription.text || transcription.transcript || transcription.result || '';
        } else if (typeof transcription === 'string') {
          transcribedText = transcription;
        }

        if (transcribedText.trim()) {
          setTranscript((prev) => prev + (prev ? ' ' : '') + transcribedText.trim());
        } else {
          // If no text was extracted, log the result for debugging
          console.log('Transcription result format:', transcription);
        }
      } else {
        setError(`Transcription error: ${result.error.message}`);
      }

      setIsListening(false);
      setIsProcessing(false);
      micRecorderRef.current = null;
    } catch (err: any) {
      setIsProcessing(false);
      setIsListening(false);
      setError(`Transcription error: ${err.message}`);
      console.error('Transcription error:', err);
      micRecorderRef.current = null;
    }
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
            Speech to Text (Offline - whisper.cpp)
          </h1>
          <p className="text-gray-600 dark:text-gray-300 text-lg">
            Convert your speech into text using whisper.cpp - works completely offline!
          </p>
          {!modelLoaded && (
            <p className="text-blue-600 dark:text-blue-400 text-sm mt-2">
              {isLoading ? 'Loading Whisper model... (first time only)' : 'Select a model and click to load'}
            </p>
          )}
        </div>

        {/* Model Selection */}
        {!modelLoaded && !isLoading && (
          <div className="flex flex-col items-center mb-6 gap-4">
            <div className="w-full max-w-md">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Select Model Size:
              </label>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value as AvailableModels)}
                className="w-full px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value={AvailableModels.WHISPER_TINY}>Tiny (Fastest, ~39MB)</option>
                <option value={AvailableModels.WHISPER_BASE}>Base (Balanced, ~74MB)</option>
                <option value={AvailableModels.WHISPER_SMALL}>Small (Better accuracy, ~244MB)</option>
                <option value={AvailableModels.WHISPER_MEDIUM}>Medium (High accuracy, ~769MB)</option>
                <option value={AvailableModels.WHISPER_LARGE}>Large (Best accuracy, ~1550MB)</option>
              </select>
            </div>
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
            <div className="text-center w-full max-w-md">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
              <p className="text-gray-600 dark:text-gray-300 mb-2">
                Loading Whisper model... This may take a minute on first load.
              </p>
              {loadProgress > 0 && (
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 mb-2">
                  <div
                    className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                    style={{ width: `${loadProgress}%` }}
                  ></div>
                </div>
              )}
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {loadProgress > 0 ? `${Math.round(loadProgress)}%` : 'Initializing...'}
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
                ? 'Listening... (click to stop and transcribe)'
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

