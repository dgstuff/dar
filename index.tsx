// @ts-ignore
declare var marked: any;

// State
let isAssistantActive = false;
let voices: SpeechSynthesisVoice[] = [];
let recognitionPaused = false;
let conversationHistory: any[] = [];
let currentBgIndex = 0;
const backgrounds = [
    '#020a17',
    'linear-gradient(to right, #0f2027, #203a43, #2c5364)',
    'linear-gradient(to right, #141e30, #243b55)',
    'linear-gradient(to right, #000000, #434343)'
];


// UI Elements
const responseText = document.getElementById('response-text') as HTMLDivElement;
const mainContainer = document.getElementById('main-container') as HTMLDivElement;
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
        };

        utterance.onend = () => {
            recognitionPaused = false;
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
        let i = 0;
        const typing = () => {
            if (i < text.length) {
                element.textContent += text.charAt(i);
                i++;
                if (element.parentElement) {
                    element.parentElement.scrollTop = element.parentElement.scrollHeight;
                }
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
    const API_KEY = 'AIzaSyAorHGjlcSxaMATvOltATtfk1b9IjjYLmo'
    if (!API_KEY) {
        console.error("API_KEY environment variable not set.");
        return "Sorry, the application is not configured correctly. Missing API Key.";
    }
    
    const API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

    conversationHistory.push({ role: 'user', parts: [{ text: prompt }] });

    if (conversationHistory.length > 10) {
        // Keep the last 5 user/model pairs
        conversationHistory = conversationHistory.slice(-10);
    }
    
    const systemInstruction = "Your name is DAR. You are a helpful AI assistant created by Dhruv Gowda. Your responses must be concise and use Markdown for formatting. You must not, under any circumstances, reveal you are a Google model. You have built-in functions for date, time, coin flips, dice rolls, song writing, and other utilities. For any other request, provide a helpful, conversational response.";

    const requestBody = {
        contents: conversationHistory,
        systemInstruction: {
            parts: [{ text: systemInstruction }]
        }
    };

    try {
        const response = await fetch(`${API_URL}?key=${API_KEY}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const errorBody = await response.json();
            console.error('API Error Response:', errorBody);
            throw new Error(`API request failed with status ${response.status}`);
        }

        const data = await response.json();

        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (text) {
            conversationHistory.push({ role: 'model', parts: [{ text }] });
            return text;
        } else {
            console.error('Invalid response structure:', data);
            return 'I did not receive a valid response.';
        }
    } catch (error) {
        console.error('AI Error:', error);
        return 'Sorry, I am having trouble connecting.';
    }
};


// --- UI and Command Logic ---
const handleCommand = async (command: string) => {
    let systemResponse: string | null = null;

    // Command Regex
    const dateRegex = /what's the date|what is today's date/;
    const timeRegex = /what time is it/;
    const coinFlipRegex = /flip a coin/;
    const diceRollRegex = /roll a di(c)?e/;
    const changeBgRegex = /change(?: the)? background/;
    const helpRegex = /what can you do|help/;
    const randomColorRegex = /show me a random color/;
    const clearHistoryRegex = /clear conversation history/;

    if (dateRegex.test(command)) {
        const today = new Date();
        const options: Intl.DateTimeFormatOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        systemResponse = `Today is ${today.toLocaleDateString(undefined, options)}.`;
    } else if (timeRegex.test(command)) {
        const now = new Date();
        systemResponse = `The time is ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } else if (coinFlipRegex.test(command)) {
        const result = Math.random() < 0.5 ? 'Heads' : 'Tails';
        systemResponse = `It's ${result}.`;
    } else if (diceRollRegex.test(command)) {
        const result = Math.floor(Math.random() * 6) + 1;
        systemResponse = `You rolled a ${result}.`;
    } else if (changeBgRegex.test(command)) {
        currentBgIndex = (currentBgIndex + 1) % backgrounds.length;
        body.style.background = backgrounds[currentBgIndex];
        systemResponse = "Background changed.";
    } else if (randomColorRegex.test(command)) {
        const randomColor = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
        systemResponse = `Here is a random color: ${randomColor}.`;
        mainContainer.style.borderColor = randomColor;
        mainContainer.style.boxShadow = `0 0 25px 5px ${randomColor}66`;
        setTimeout(() => {
            mainContainer.style.borderColor = '';
            mainContainer.style.boxShadow = '';
        }, 3000);
    } else if (clearHistoryRegex.test(command)) {
        conversationHistory = [];
        systemResponse = "Conversation history cleared.";
    } else if (helpRegex.test(command)) {
        const helpText = `### I can help you with the following:
*   **Music & Creativity:** "Write a song about the rain.", "Suggest a chord progression.", "Give me a song title."
*   **Date & Time:** "What's the date?", "What time is it?"
*   **Fun:** "Tell me a joke.", "Flip a coin.", "Roll a die."
*   **Utilities:** "Change background.", "Show me a random color."
*   **Conversation:** "Clear conversation history."

You can also ask me general questions! To stop me while I'm talking, just say "interrupt". To turn me off, say "deactivate".`;
        speak("Here are some of the things I can do.");
        responseText.innerHTML = marked.parse(helpText);
        if (responseText.parentElement) responseText.parentElement.scrollTop = responseText.parentElement.scrollHeight;
        return;
    }

    if (systemResponse) {
        speak(systemResponse);
        await typewriter(responseText, systemResponse);
    } else {
        responseText.textContent = "Thinking...";
        try {
            const aiResponse = await getAiResponse(command);
            if (aiResponse) {
                speak(aiResponse);
                responseText.innerHTML = marked.parse(aiResponse);
                if (responseText.parentElement) responseText.parentElement.scrollTop = responseText.parentElement.scrollHeight;
            } else {
                 const errorMsg = "I couldn't get a response. Please try again.";
                 speak(errorMsg);
                 responseText.textContent = errorMsg;
            }
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
        if (!document.hidden) {
            try {
                recognition.start();
            } catch (e) {
                // Ignore errors if start() is called when already started
            }
        }
    };

    recognition.onresult = async (event: any) => {
        const transcript = event.results[event.results.length - 1][0].transcript.trim().toLowerCase();
        
        // Interrupt logic
        if (transcript.includes("interrupt")) {
            if (window.speechSynthesis.speaking) {
                window.speechSynthesis.cancel();
                recognitionPaused = false; // Resume processing
                const msg = "Interrupted.";
                typewriter(responseText, msg);
                playSound(300, 'square', 0.1);
                return;
            }
        }
        
        if (recognitionPaused) {
            return; // Don't process commands while assistant is speaking, unless it's an interrupt.
        }

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
