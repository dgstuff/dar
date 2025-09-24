// FIX: Import GoogleGenAI and Modality from the SDK
import { GoogleGenAI, Modality } from "@google/genai";

// @ts-ignore
declare var marked: any;

// FIX: Add interface to fix TypeScript error for SpeechRecognition by declaring it in the global scope
declare global {
    interface Window {
        SpeechRecognition: any;
        webkitSpeechRecognition: any;
    }
}


// --- STATE MANAGEMENT ---
// FIX: Initialize the GoogleGenAI client
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
let isAssistantActive = false;
let timerInterval: number | null = null;
let timerSeconds = 0;
let stopwatchInterval: number | null = null;
let stopwatchSeconds = 0;
let voices: SpeechSynthesisVoice[] = [];
let recognitionPaused = false;
let conversationHistory: { role: 'user' | 'model'; parts: { text: string }[] }[] = [];
let currentBgIndex = 0;
const backgrounds = [
    '#020a17',
    'linear-gradient(to right, #0f2027, #203a43, #2c5364)',
    'linear-gradient(to right, #141e30, #243b55)',
    'linear-gradient(to right, #000000, #434343)'
];

// --- UI ELEMENTS ---
const responseText = document.getElementById('response-text') as HTMLDivElement;
const mainContainer = document.getElementById('main-container') as HTMLDivElement;
const timerCard = document.getElementById('timer-card') as HTMLDivElement;
const timerDisplay = document.getElementById('timer-display') as HTMLSpanElement;
const stopwatchCard = document.getElementById('stopwatch-card') as HTMLDivElement;
const stopwatchDisplay = document.getElementById('stopwatch-display') as HTMLSpanElement;
const body = document.body;
const visualizerCanvas = document.getElementById('visualizer') as HTMLCanvasElement;
const canvasCtx = visualizerCanvas.getContext('2d')!;

// --- AUDIO & VISUALIZER ---
const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
const analyser = audioContext.createAnalyser();
analyser.fftSize = 256;
const bufferLength = analyser.frequencyBinCount;
const dataArray = new Uint8Array(bufferLength);

function visualize() {
    requestAnimationFrame(visualize);

    analyser.getByteFrequencyData(dataArray);

    canvasCtx.fillStyle = 'rgba(0, 0, 0, 0)';
    canvasCtx.fillRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);

    const barWidth = (visualizerCanvas.width / bufferLength) * 2.5;
    let barHeight;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
        barHeight = dataArray[i] / 2;
        
        const gradient = canvasCtx.createLinearGradient(0, visualizerCanvas.height, 0, visualizerCanvas.height - barHeight);
        gradient.addColorStop(0, '#4a90e2');
        gradient.addColorStop(1, '#00d9ff');
        
        canvasCtx.fillStyle = gradient;
        canvasCtx.fillRect(x, visualizerCanvas.height - barHeight, barWidth, barHeight);

        x += barWidth + 1;
    }
}
visualize();

// --- SPEECH SYNTHESIS ---
function loadVoices() {
    voices = window.speechSynthesis.getVoices();
}

function speak(text: string) {
    if (!text) return;
    recognitionPaused = true;
    window.speechSynthesis.cancel(); // Stop any previous speech

    const utterance = new SpeechSynthesisUtterance(text);
    const selectedVoice = voices.find(voice => voice.name.includes('Google') && voice.lang.startsWith('en')) || voices.find(voice => voice.lang.startsWith('en'));
    if (selectedVoice) {
        utterance.voice = selectedVoice;
    }
    
    utterance.onstart = () => {
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }
    };
    
    utterance.onend = () => {
        recognitionPaused = false;
        startRecognition();
    };

    window.speechSynthesis.speak(utterance);

    // Render markdown and auto-scroll
    if (!text.startsWith("Okay, I'm creating an image")) { // Don't show markdown for image gen announcements
        responseText.innerHTML = marked.parse(text);
        responseText.parentElement!.scrollTop = responseText.parentElement!.scrollHeight;
    }
}


// --- SPEECH RECOGNITION ---
const SpeechRecognition = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
if (!SpeechRecognition) {
    responseText.textContent = "Sorry, your browser doesn't support Speech Recognition.";
}
const recognition = new SpeechRecognition();
recognition.continuous = false;
recognition.interimResults = false;
recognition.lang = 'en-US';

recognition.onstart = () => {
    // Glow effect is now handled by isAssistantActive state
};

recognition.onend = () => {
    // Glow effect is now handled by isAssistantActive state
    if (!recognitionPaused) {
         setTimeout(startRecognition, 100); // Restart if not paused
    }
};

recognition.onerror = (event: any) => {
    console.error('Speech recognition error:', event.error);
    if (event.error === 'no-speech' || event.error === 'audio-capture') {
        // Don't show error to user, just restart
    } else {
        responseText.textContent = `Error: ${event.error}`;
    }
    recognitionPaused = false;
};

recognition.onresult = (event: any) => {
    const transcript = event.results[0][0].transcript.trim().toLowerCase();
    handleCommand(transcript);
};

function startRecognition() {
    if (recognition && !recognitionPaused) {
        try {
            recognition.start();
        } catch(e) {
            console.error("Recognition already started.", e);
        }
    }
}

// --- COMMAND HANDLING ---
async function handleCommand(command: string) {
    if (command.includes('interrupt')) {
        window.speechSynthesis.cancel();
        responseText.innerHTML = "Interrupted.";
        recognitionPaused = false;
        return;
    }
    
    if (command.includes('start') || command.includes('dar')) {
        isAssistantActive = true;
        body.classList.add('assistant-active');
        responseText.innerHTML = 'Listening...';
        return;
    }

    if (!isAssistantActive) return;

    if (command.includes('stop listening') || command.includes('go to sleep') || command.includes('deactivate')) {
        isAssistantActive = false;
        body.classList.remove('assistant-active');
        responseText.innerHTML = 'Say "Start" to activate';
        return;
    }
    
    conversationHistory.push({ role: 'user', parts: [{ text: command }] });

    // Built-in commands
    if (command.includes('what time is it')) {
        const time = new Date().toLocaleTimeString();
        speak(`The current time is ${time}`);
    } else if (command.includes("what's the date")) {
        const date = new Date().toLocaleDateString();
        speak(`Today's date is ${date}`);
    } else if (command.includes('tell me a joke')) {
        // FIX: Call getAIResponse without the unused argument
        getAIResponse();
    } else if (command.includes('flip a coin')) {
        const result = Math.random() > 0.5 ? 'Heads' : 'Tails';
        speak(`It's ${result}.`);
    } else if (command.includes('roll a die')) {
        const result = Math.floor(Math.random() * 6) + 1;
        speak(`You rolled a ${result}.`);
    } else if (command.includes('change background')) {
        currentBgIndex = (currentBgIndex + 1) % backgrounds.length;
        body.style.background = backgrounds[currentBgIndex];
        speak('Background changed.');
    } else if (command.includes('random color')) {
        const color = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
        body.style.background = color;
        speak(`Here is a random color. ${color}`);
    } else if (command.includes('clear conversation history')) {
        conversationHistory = [];
        responseText.innerHTML = 'Conversation history cleared.';
        speak('Conversation history cleared.');
    } else if (command.includes('what can you do')) {
        const helpText = `I can do a few things! Try saying:
        - "What time is it?"
        - "Tell me a joke."
        - "Flip a coin." or "Roll a die."
        - "Start a timer for 5 minutes."
        - "Start a stopwatch."
        - "Change background."
        - "Generate an image of a robot dog."
        - "Write a song about..."
        - "Suggest a chord progression."
        - "Give me a song title."
        - "Interrupt" to stop me talking.
        - "Deactivate" to deactivate me.`;
        speak(helpText);
    } else if (command.includes('timer for')) {
        const timeMatch = command.match(/(\d+)\s+(minute|second)s?/);
        if (timeMatch) {
            const amount = parseInt(timeMatch[1], 10);
            const unit = timeMatch[2];
            const seconds = unit === 'minute' ? amount * 60 : amount;
            startTimer(seconds);
            speak(`Starting a timer for ${amount} ${unit}.`);
        } else {
            speak("Please specify a duration for the timer, for example: 'timer for 5 minutes'.");
        }
    } else if (command.includes('stop timer')) {
        stopTimer();
        speak('Timer stopped.');
    } else if (command.includes('start stopwatch')) {
        startStopwatch();
        speak('Stopwatch started.');
    } else if (command.includes('stop stopwatch')) {
        stopStopwatch();
        speak('Stopwatch stopped.');
    } else if (command.startsWith('generate image') || command.startsWith('create an image') || command.startsWith('make an image')) {
        const prompt = command.replace(/^(generate image of|create an image of|make an image of|generate an image|create an image|make an image)\s*/, '');
        if (prompt) {
            generateImage(prompt);
        } else {
            speak("Please tell me what image you want to generate, for example: 'generate an image of a robot dog'.");
        }
    } else {
        // Default to AI response
        // FIX: Call getAIResponse without the unused argument
        getAIResponse();
    }
}

// --- GEMINI API ---

// FIX: Use generateImages and the imagen-4.0-generate-001 model for image generation as per the guidelines.
async function generateImage(prompt: string) {
    responseText.innerHTML = `Generating: <em>${prompt}</em>`;
    speak(`Okay, I'm creating an image of ${prompt}`);
    
    try {
        const response = await ai.models.generateImages({
            model: 'imagen-4.0-generate-001',
            prompt: `A high-quality, artistic image of ${prompt}`,
            config: {
              numberOfImages: 1,
              outputMimeType: 'image/jpeg',
            },
        });

        if (response.generatedImages && response.generatedImages.length > 0) {
            const base64ImageBytes = response.generatedImages[0].image.imageBytes;
            const imageUrl = `data:image/jpeg;base64,${base64ImageBytes}`;
            
            responseText.innerHTML = `<img src="${imageUrl}" class="w-full h-auto rounded-lg shadow-lg object-contain max-h-full" alt="${prompt}">`;
            
            conversationHistory.push({ role: 'model', parts: [{ text: `[Image of ${prompt}]` }] });
            speak("Here is the image you requested.");
            if (responseText.parentElement) {
                responseText.parentElement.scrollTop = 0;
            }
        } else {
            speak("Sorry, I couldn't generate an image for that. Please try another prompt.");
        }

    } catch (error) {
        console.error('Error generating image:', error);
        speak("I'm having trouble creating images right now. Please try again later.");
    }
}

// FIX: Refactor to use @google/genai SDK and remove unused 'prompt' parameter
async function getAIResponse() {
    responseText.innerHTML = 'Thinking...';
    
    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: conversationHistory,
            config: {
                systemInstruction: `You are DAR, a voice assistant inspired by JARVIS. Provide clear, concise, and helpful answers. Format your responses in markdown. You have the following built-in capabilities you can mention if relevant: time, date, jokes, coin flip, die roll, timers, stopwatches, background changes, image generation, and song writing assistance.`
            }
        });

        const text = response.text || "Sorry, I couldn't get a response.";
        
        conversationHistory.push({ role: 'model', parts: [{ text }] });
        speak(text);

    } catch (error) {
        console.error('Error fetching AI response:', error);
        speak("I'm having trouble connecting to my brain right now. Please try again later.");
    }
}


// --- WIDGET LOGIC (TIMER/STOPWATCH) ---
function formatTime(totalSeconds: number): string {
    const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const seconds = (totalSeconds % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
}

function startTimer(seconds: number) {
    stopTimer(); // Clear any existing timer
    timerSeconds = seconds;
    timerDisplay.textContent = formatTime(timerSeconds);
    timerCard.classList.remove('hidden');

    timerInterval = window.setInterval(() => {
        timerSeconds--;
        timerDisplay.textContent = formatTime(timerSeconds);
        if (timerSeconds <= 0) {
            stopTimer();
            speak("Time's up!");
        }
    }, 1000);
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    timerCard.classList.add('hidden');
}

function startStopwatch() {
    stopStopwatch(); // Clear any existing stopwatch
    stopwatchSeconds = 0;
    stopwatchDisplay.textContent = formatTime(stopwatchSeconds);
    stopwatchCard.classList.remove('hidden');

    stopwatchInterval = window.setInterval(() => {
        stopwatchSeconds++;
        stopwatchDisplay.textContent = formatTime(stopwatchSeconds);
    }, 1000);
}

function stopStopwatch() {
    if (stopwatchInterval) {
        clearInterval(stopwatchInterval);
        stopwatchInterval = null;
    }
     stopwatchCard.classList.add('hidden');
}

// --- INITIALIZATION ---
async function initializeApp() {
    window.speechSynthesis.onvoiceschanged = loadVoices;
    loadVoices();

    try {
        // Resume AudioContext on user interaction (permission prompt)
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);
    } catch (err) {
        console.error('Error accessing microphone for visualizer:', err);
        responseText.innerHTML = `<p class="text-red-400">Could not access microphone. Please grant permission and refresh. The visualizer will not work.</p>`;
    }

    // Start listening after a short delay
    setTimeout(startRecognition, 500);
}

initializeApp();
