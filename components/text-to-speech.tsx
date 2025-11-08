'use client';

import { useState, useEffect, useRef } from 'react';
// @ts-ignore
import Speech from 'speak-tts';

interface Voice {
  name: string;
  lang: string;
  default?: boolean;
  voiceURI?: string;
}

export default function TextToSpeech() {
  const [text, setText] = useState('');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedVoice, setSelectedVoice] = useState<string>('');
  const [voices, setVoices] = useState<Voice[]>([]);
  const [rate, setRate] = useState(1);
  const [pitch, setPitch] = useState(1);
  const [volume, setVolume] = useState(1);
  const speechRef = useRef<Speech | null>(null);

  useEffect(() => {
    // Initialize speak-tts library
    const speech = new Speech();
    
    speech
      .init()
      .then((data: any) => {
        setIsSupported(true);
        speechRef.current = speech;

        // Get available voices from browser API
        const availableVoices = window.speechSynthesis.getVoices();
        const voiceList: Voice[] = availableVoices.map((v) => ({
          name: v.name,
          lang: v.lang,
          default: v.default || false,
          voiceURI: v.voiceURI,
        }));
        setVoices(voiceList);
        
        if (voiceList.length > 0 && !selectedVoice) {
          // Set default voice (prefer English)
          const defaultVoice =
            voiceList.find((v) => v.lang.startsWith('en')) ||
            voiceList[0];
          if (defaultVoice) {
            setSelectedVoice(defaultVoice.name);
          }
        }
      })
      .catch((err: any) => {
        setIsSupported(false);
        setError('Failed to initialize speech synthesis: ' + err.message);
      });

    // Load voices when they become available
    const loadVoices = () => {
      if (window.speechSynthesis) {
        const availableVoices = window.speechSynthesis.getVoices();
        if (availableVoices.length > 0) {
          const voiceList: Voice[] = availableVoices.map((v) => ({
            name: v.name,
            lang: v.lang,
            default: v.default || false,
            voiceURI: v.voiceURI,
          }));
          setVoices(voiceList);
        }
      }
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

    return () => {
      if (speechRef.current) {
        speechRef.current.cancel();
      }
    };
  }, [selectedVoice]);

  const speak = () => {
    if (!text.trim() || !speechRef.current) {
      setError('Please enter text to speak.');
      return;
    }

    try {
      const speech = speechRef.current;
      
      // Set speech parameters
      speech.setRate(rate);
      speech.setPitch(pitch);
      speech.setVolume(volume);
      
      if (selectedVoice) {
        speech.setVoice(selectedVoice);
      }

      // Speak the text with event listeners
      speech.speak({
        text: text,
        queue: false,
        listeners: {
          onstart: () => {
            setIsSpeaking(true);
            setIsPaused(false);
            setError(null);
          },
          onend: () => {
            setIsSpeaking(false);
            setIsPaused(false);
          },
          onerror: (err: any) => {
            setError(`Error: ${err.error || 'Unknown error'}`);
            setIsSpeaking(false);
            setIsPaused(false);
          },
        },
      });
    } catch (err: any) {
      setError('Failed to speak text: ' + (err.message || 'Unknown error'));
      setIsSpeaking(false);
    }
  };

  const pause = () => {
    if (speechRef.current && isSpeaking && !isPaused) {
      speechRef.current.pause();
      setIsPaused(true);
    }
  };

  const resume = () => {
    if (speechRef.current && isPaused) {
      speechRef.current.resume();
      setIsPaused(false);
    }
  };

  const stop = () => {
    if (speechRef.current) {
      speechRef.current.cancel();
      setIsSpeaking(false);
      setIsPaused(false);
    }
  };

  const clearText = () => {
    setText('');
    setError(null);
    stop();
  };

  if (!isSupported) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center p-8 bg-red-50 dark:bg-red-900/20 rounded-2xl border border-red-200 dark:border-red-800">
          <p className="text-red-600 dark:text-red-400 text-lg">
            Speech synthesis is not supported in your browser.
          </p>
          <p className="text-red-500 dark:text-red-500/80 text-sm mt-2">
            Please use a modern browser for the best experience.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-4xl mx-auto p-6">
      <div className="bg-gradient-to-br from-purple-50 via-pink-50 to-rose-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 rounded-3xl shadow-2xl p-8 md:p-12 border border-gray-200 dark:border-gray-700">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-purple-600 via-pink-600 to-rose-600 bg-clip-text text-transparent mb-3">
            Text to Speech
          </h1>
          <p className="text-gray-600 dark:text-gray-300 text-lg">
            Convert your text into speech in real-time
          </p>
        </div>

        {/* Text Input */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Enter text to speak
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type or paste your text here..."
            className="w-full bg-white dark:bg-gray-800 rounded-2xl shadow-inner p-6 min-h-[200px] max-h-[400px] overflow-y-auto border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200 text-lg leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 dark:focus:ring-purple-400"
          />
        </div>

        {/* Voice Selection */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Select Voice
          </label>
          <select
            value={selectedVoice}
            onChange={(e) => setSelectedVoice(e.target.value)}
            className="w-full bg-white dark:bg-gray-800 rounded-xl p-3 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-purple-500 dark:focus:ring-purple-400"
          >
            {voices.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name} ({v.lang})
              </option>
            ))}
          </select>
        </div>

        {/* Speech Controls */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Rate: {rate.toFixed(1)}x
            </label>
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              value={rate}
              onChange={(e) => setRate(parseFloat(e.target.value))}
              className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-600"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Pitch: {pitch.toFixed(1)}
            </label>
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={pitch}
              onChange={(e) => setPitch(parseFloat(e.target.value))}
              className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-pink-600"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Volume: {Math.round(volume * 100)}%
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-rose-600"
            />
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700 rounded-xl">
            <p className="text-red-700 dark:text-red-400 text-sm">{error}</p>
          </div>
        )}

        {/* Status Indicator */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm">
            <div
              className={`w-3 h-3 rounded-full ${
                isSpeaking
                  ? 'bg-purple-500 animate-pulse'
                  : isPaused
                  ? 'bg-yellow-500'
                  : 'bg-gray-400'
              }`}
            ></div>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {isSpeaking
                ? 'Speaking...'
                : isPaused
                ? 'Paused'
                : 'Ready to speak'}
            </span>
          </div>
        </div>

        {/* Control Buttons */}
        <div className="flex flex-wrap gap-4 justify-center">
          <button
            onClick={isSpeaking && !isPaused ? pause : isPaused ? resume : speak}
            disabled={!text.trim()}
            className={`px-6 py-3 rounded-xl font-medium shadow-lg hover:shadow-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 active:scale-95 flex items-center gap-2 ${
              isSpeaking && !isPaused
                ? 'bg-gradient-to-r from-yellow-500 to-orange-600 text-white'
                : isPaused
                ? 'bg-gradient-to-r from-green-500 to-emerald-600 text-white'
                : 'bg-gradient-to-r from-purple-500 to-pink-600 text-white'
            }`}
          >
            {isSpeaking && !isPaused ? (
              <>
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
                    d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                Pause
              </>
            ) : isPaused ? (
              <>
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
                    d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                Resume
              </>
            ) : (
              <>
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
                    d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
                  />
                </svg>
                Speak
              </>
            )}
          </button>
          <button
            onClick={stop}
            disabled={!isSpeaking && !isPaused}
            className="px-6 py-3 bg-gradient-to-r from-red-500 to-pink-600 text-white rounded-xl font-medium shadow-lg hover:shadow-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 active:scale-95 flex items-center gap-2"
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
                d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 10h6v4H9z"
              />
            </svg>
            Stop
          </button>
          <button
            onClick={clearText}
            disabled={!text}
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

