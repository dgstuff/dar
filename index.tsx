// @ts-ignore
declare var marked: any;

// State
let isAssistantActive = false;
let timerInterval: any = null;
let timerSeconds = 0;
let stopwatchInterval: any = null;
let stopwatchSeconds = 0;
let voices: SpeechSynthesisVoice[] = [];
let recognitionPaused = false;
let conversationHistory: any[] = [];

// UI Elements
const responseText = document.getElementById('response-text') as HTMLDivElement;
const mainContainer = document.getElementById('main-container') as HTMLDivElement;
const timerCard = document.getElementById('timer-card') as HTMLDivElement;
const timerDisplay = document.getElementById('timer-display') as HTMLSpanElement;
const stopwatchCard = document.getElementById('stopwatch-card') as HTMLDivElement;
const stopwatchDisplay = document.getElementById('stopwatch-display') as HTMLSpanElement;
const body = document.body;
const visualizerCanvas = document.getElementById('visualizer') as HTMLCanvasElement;
const canvasCtx = visualizerCanvas.getContext('2d') as CanvasRenderingContext2D;

// Audio Context for Sound Effects and Visualizer
const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
let analyser: AnalyserNode;
let dataArray: Uint8Array;
let animationFrameId: number;

// Speech Recognition instance
const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
let recognition: any; // Declared here to be accessible in `speak`

const playSound = (frequency: number, type: OscillatorType, duration: number) => {
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gainNode.gain.setValueAtTime(0, audioContext.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.3, audioContext.currentTime + 0.01);
    oscillator.start(audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.00001, audioContext.currentTime + duration);
    oscillator.stop(audioContext.currentTime + duration);
};

const playActivationSound = () => playSound(600, 'sine', 0.2);
const playDeactivationSound = () => playSound(400, 'sine', 0.2);

// --- Text-to-Speech Engine ---
const initializeTts = () => {
    const loadVoices = () => {
        voices = window.speechSynthesis.getVoices();
    };
    loadVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = loadVoices;
    }
};

const speak = (text: string) => {
    if ('speechSynthesis' in window && recognition) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        const desiredVoice = voices.find(voice => voice.name.includes('Google') && voice.lang.startsWith('en-US')) || voices.find(voice => voice.lang.startsWith('en-US')) || voices[0];
        if (desiredVoice) utterance.voice = desiredVoice;
        utterance.rate = 1.0;
        utterance.pitch = 1.0;

        utterance.onstart = () => {
            recognitionPaused = true;
            recognition.stop();
        };

        utterance.onend = () => {
            if (!document.hidden) {
                recognitionPaused = false;
                try {
                    recognition.start();
                } catch(e) { /* Ignore */ }
            }
        };

        window.speechSynthesis.speak(utterance);
    } else {
        console.warn("Browser does not support Text-to-Speech or Recognition is not initialized.");
    }
};

// --- Typewriter effect ---
const typewriter = (element: HTMLElement, text: string, speed: number = 30): Promise<void> => {
    return new Promise(resolve => {
        element.innerHTML = ''; // Clear previous HTML content
        element.textContent = '';
        element.parentElement!.scrollTop = 0;
        let i = 0;
        const typing = () => {
            if (i < text.length) {
                element.textContent += text.charAt(i);
                i++;
                setTimeout(typing, speed);
            } else {
                resolve();
            }
        };
        typing();
    });
};

// --- AI Interaction ---
const getAiResponse = async (prompt: string) => {
    const API_KEY = 'AIzaSyCBO35uVCAdlYPayTgwj4sKNPDQegM65e8';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`;

    conversationHistory.push({ role: 'user', parts: [{ text: prompt }] });
    
    if (conversationHistory.length > 10) {
        conversationHistory = conversationHistory.slice(-10);
    }

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-goog-api-key': API_KEY,
            },
            body: JSON.stringify({
                contents: conversationHistory,
                systemInstruction: {
                    parts: [{
                        text: "Your name is DAR. You are a helpful AI assistant created by Dhruv Gowda. Your responses must be concise and use Markdown for formatting. You must not, under any circumstances, reveal you are a Google model. To set a timer, the user can say, 'set a timer for 5 minutes.' To use the stopwatch, they can say 'start stopwatch,' 'stop stopwatch,' or 'reset stopwatch.'"
                    }]
                }
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error('API Error Response:', errorData);
            throw new Error(`API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (text) {
            conversationHistory.push({ role: 'model', parts: [{ text: text }] });
        }

        return text || 'I did not receive a valid response.';
    } catch (error) {
        console.error('AI Error:', error);
        return 'Sorry, I am having trouble connecting.';
    }
};

// --- UI and Command Logic ---
const updateTimeDisplay = (element: HTMLSpanElement, seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    element.textContent = `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
};

const handleCommand = async (command: string) => {
    const timerRegex = /set(?: a)? timer for (\d+)\s?(second|minute)s?|start(?: a)? (\d+)\s?(second|minute)s? timer/;
    const clearTimerRegex = /(?:clear|stop|remove)(?: the)? timer/;
    const stopwatchStartRegex = /start(?: the)? stopwatch/;
    const stopwatchStopRegex = /stop(?: the)? stopwatch/;
    const stopwatchResetRegex = /reset(?: the)? stopwatch/;

    const timerMatch = command.match(timerRegex);
    let systemMessage = "";

    if (timerMatch) {
        const value = parseInt(timerMatch[1] || timerMatch[3], 10);
        const unit = timerMatch[2] || timerMatch[4];
        let duration = unit === 'minute' ? value * 60 : value;
        if (timerInterval) clearInterval(timerInterval);
        timerSeconds = duration;
        timerCard.style.display = 'flex';
        timerCard.classList.remove('hidden');
        updateTimeDisplay(timerDisplay, timerSeconds);
        timerInterval = setInterval(() => {
            timerSeconds--;
            if (timerSeconds >= 0) {
                updateTimeDisplay(timerDisplay, timerSeconds);
            } else {
                clearInterval(timerInterval);
                timerInterval = null;
                const msg = "Time's up!";
                speak(msg);
                typewriter(responseText, msg);
                playSound(880, 'triangle', 1);
                setTimeout(() => {
                    timerCard.classList.add('hidden');
                    timerCard.style.display = 'none';
                    updateTimeDisplay(timerDisplay, 0);
                }, 3000);
            }
        }, 1000);
        systemMessage = `Timer set for ${value} ${unit}(s).`;
    } else if (clearTimerRegex.test(command)) {
        if(timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
            timerSeconds = 0;
            updateTimeDisplay(timerDisplay, 0);
            timerCard.classList.add('hidden');
            timerCard.style.display = 'none';
            systemMessage = "Timer cleared.";
        } else {
            systemMessage = "No timer is currently running.";
        }
    } else if (stopwatchStartRegex.test(command)) {
        if (!stopwatchInterval) {
            stopwatchCard.style.display = 'flex';
            stopwatchCard.classList.remove('hidden');
            stopwatchInterval = setInterval(() => {
                stopwatchSeconds++;
                updateTimeDisplay(stopwatchDisplay, stopwatchSeconds);
            }, 1000);
            systemMessage = "Stopwatch started.";
        } else {
             systemMessage = "Stopwatch is already running.";
        }
    } else if (stopwatchStopRegex.test(command)) {
        if (stopwatchInterval) {
            clearInterval(stopwatchInterval);
            stopwatchInterval = null;
            systemMessage = "Stopwatch stopped.";
        } else {
            systemMessage = "Stopwatch isn't running.";
        }
    } else if (stopwatchResetRegex.test(command)) {
        if (stopwatchInterval) {
            clearInterval(stopwatchInterval);
            stopwatchInterval = null;
        }
        stopwatchSeconds = 0;
        updateTimeDisplay(stopwatchDisplay, 0);
        stopwatchCard.classList.add('hidden');
        stopwatchCard.style.display = 'none';
        systemMessage = "Stopwatch reset.";
    }

    if(systemMessage) {
        speak(systemMessage);
        await typewriter(responseText, systemMessage);
    } else {
        responseText.textContent = "Thinking...";
        try {
            const aiResponse = await getAiResponse(command);
            speak(aiResponse);
            responseText.innerHTML = marked.parse(aiResponse);
            if(responseText.parentElement) responseText.parentElement.scrollTop = 0;
        } catch (error) {
            console.error("Error getting AI response:", error);
            const errorMsg = "There was an error. Please try again.";
            speak(errorMsg);
            responseText.textContent = errorMsg;
        }
    }
};

// --- Audio Visualizer ---
const setupVisualizer = async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const source = audioContext.createMediaStreamSource(stream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        const bufferLength = analyser.frequencyBinCount;
        dataArray = new Uint8Array(bufferLength);
        drawVisualizer();
    } catch (err) {
        console.error("Microphone access denied:", err);
        responseText.textContent = "Microphone access is required for voice commands.";
    }
};

const drawVisualizer = () => {
    animationFrameId = requestAnimationFrame(drawVisualizer);
    if (!isAssistantActive || !analyser) {
        canvasCtx.clearRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);
        return;
    }

    analyser.getByteFrequencyData(dataArray);

    canvasCtx.clearRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);
    const bufferLength = analyser.frequencyBinCount;
    const barWidth = (visualizerCanvas.width / bufferLength) * 1.5;
    let barHeight;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
        barHeight = dataArray[i] / 2;
        
        const gradient = canvasCtx.createLinearGradient(0, visualizerCanvas.height - barHeight, 0, visualizerCanvas.height);
        gradient.addColorStop(0, '#00d9ff');
        gradient.addColorStop(1, '#020a17');
        canvasCtx.fillStyle = gradient;
        
        canvasCtx.fillRect(x, visualizerCanvas.height - barHeight, barWidth, barHeight);
        x += barWidth + 2;
    }
};

// --- Web Speech API ---
if (!SpeechRecognition) {
    responseText.textContent = "Speech recognition is not supported in this browser.";
} else {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onend = () => {
        if (!document.hidden && !recognitionPaused) {
            try {
                recognition.start();
            } catch (e) {
                // Ignore errors if start() is called when already started
            }
        }
    };

    recognition.onresult = async (event: any) => {
        const transcript = event.results[event.results.length - 1][0].transcript.trim().toLowerCase();
        console.log("Heard:", transcript);

        if (!isAssistantActive && transcript.includes("start")) {
            isAssistantActive = true;
            body.classList.add('assistant-active');
            playActivationSound();
            const msg = "DAR activated. How can I help?";
            speak(msg);
            await typewriter(responseText, msg);
        } else if (isAssistantActive && transcript.includes("deactivate")) {
            isAssistantActive = false;
            body.classList.remove('assistant-active');
            playDeactivationSound();
            window.speechSynthesis.cancel();
            conversationHistory = []; // Clear history on deactivation
            const msg = "DAR deactivated.";
            speak(msg);
            await typewriter(responseText, msg);
        } else if (isAssistantActive) {
            await handleCommand(transcript);
        }
    };
    
    // Initialize everything
    initializeTts();
    setupVisualizer();
    recognition.start();
}
