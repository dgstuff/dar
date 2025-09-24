// @ts-ignore
declare var marked: any;

// This is needed to make the file a module
export {};

// FIX: This global augmentation now works correctly because the file is a module.
// This resolves errors on window.SpeechRecognition and window.webkitSpeechRecognition.
declare global {
    interface Window {
        SpeechRecognition: any;
        webkitSpeechRecognition: any;
    }
}

// --- GEMINI API SETUP ---
const API_KEY = 'AIzaSyD-0PzFNH2WFLdqoAmOoCfLh33Q0FKyMEA'; // Hardcoded API key as requested
const TEXT_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;
const IMAGE_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:generateImages?key=${API_KEY}`;


// --- STATE MANAGEMENT ---
let isAssistantActive = false;
let timerInterval: number | null = null;
let timerSeconds = 0;
let stopwatchInterval: number | null = null;
let stopwatchSeconds = 0;
let voices: SpeechSynthesisVoice[] = [];
let recognitionPaused = false;
let conversationHistory: { role: 'user' | 'model'; parts: { text: string }[] }[] = [];

// --- UI ELEMENTS ---
const responseText = document.getElementById('response-text') as HTMLDivElement;
const responseContainer = document.getElementById('response-container') as HTMLDivElement;
const imageContainer = document.getElementById('image-container') as HTMLDivElement;
const generatedImage = document.getElementById('generated-image') as HTMLImageElement;
const mainContainer = document.getElementById('main-container') as HTMLDivElement;
const timerCard = document.getElementById('timer-card') as HTMLDivElement;
const timerDisplay = document.getElementById('timer-display') as HTMLSpanElement;
const stopwatchCard = document.getElementById('stopwatch-card') as HTMLDivElement;
const stopwatchDisplay = document.getElementById('stopwatch-display') as HTMLSpanElement;
const body = document.body;
const visualizerCanvas = document.getElementById('visualizer') as HTMLCanvasElement;
const canvasCtx = visualizerCanvas.getContext('2d')!;

// --- UI HELPERS ---
function showTextResponse() {
    imageContainer.classList.add('hidden');
    imageContainer.classList.remove('flex');
    responseContainer.classList.remove('hidden');
}

function showImageResponse() {
    responseContainer.classList.add('hidden');
    imageContainer.classList.remove('hidden');
    imageContainer.classList.add('flex');
}


// --- AUDIO & VISUALIZER ---
let audioContext: AudioContext;
let analyser: AnalyserNode;
let source: MediaStreamAudioSourceNode;
let dataArray: Uint8Array;
let bufferLength: number;

async function setupAudio() {
    if (audioContext) return;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        bufferLength = analyser.frequencyBinCount;
        dataArray = new Uint8Array(bufferLength);
        source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);
        visualize();
    } catch (err) {
        console.error("Error accessing microphone for visualizer:", err);
        speak("I need microphone access for the visualizer to work.", true);
    }
}

function visualize() {
    if (!isAssistantActive || !analyser) {
        // Clear canvas when inactive
        canvasCtx.clearRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);
        requestAnimationFrame(visualize);
        return;
    };
    
    requestAnimationFrame(visualize);
    analyser.getByteFrequencyData(dataArray);
    canvasCtx.clearRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);

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

// --- SPEECH SYNTHESIS ---
function loadVoices() {
    voices = window.speechSynthesis.getVoices();
}

function speak(text: string, renderMarkdown = true) {
    if (!text) return;
    if (recognition) recognitionPaused = true;
    window.speechSynthesis.cancel(); 

    const utterance = new SpeechSynthesisUtterance(text);
    const selectedVoice = voices.find(voice => voice.name.includes('Google') && voice.lang.startsWith('en')) || voices.find(voice => voice.lang.startsWith('en'));
    if (selectedVoice) {
        utterance.voice = selectedVoice;
    }

    utterance.onend = () => {
        if (recognition) {
            recognitionPaused = false;
            // Delay starting recognition slightly to avoid capturing echo
            setTimeout(() => {
                if (isAssistantActive) {
                    try { recognition.start(); } catch(e) { console.error(e) }
                }
            }, 200);
        }
    };
    
    utterance.onerror = (event) => {
        console.error('SpeechSynthesisUtterance.onerror', event);
        if (recognition) recognitionPaused = false; // Unpause on error too
    };

    if (renderMarkdown) {
        responseText.innerHTML = marked.parse(text);
    } else {
        responseText.textContent = text;
    }

    window.speechSynthesis.speak(utterance);
}

// --- GEMINI API INTEGRATION (REST API) ---
async function getAIResponse() {
    showTextResponse();
    responseText.innerHTML = marked.parse('Thinking... ▋');

    try {
        const response = await fetch(TEXT_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                contents: conversationHistory,
            }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error?.message || `HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        const fullResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!fullResponse) {
            throw new Error("The model returned an empty or invalid response.");
        }
        
        conversationHistory.push({ role: 'model', parts: [{ text: fullResponse }] });
        speak(fullResponse, true);

    } catch (error) {
        console.error("Error fetching AI response:", error);
        const errorMessage = `Sorry, I encountered an error. ${error instanceof Error ? error.message : 'Please try again.'}`;
        speak(errorMessage, true);
    }
}

async function generateImage(prompt: string) {
    showTextResponse();
    const generatingText = `Generating an image of: *${prompt}*...`;
    responseText.innerHTML = marked.parse(generatingText);
    speak("Generating your image, one moment.", false);

    try {
        const response = await fetch(IMAGE_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                prompt: prompt,
                numberOfImages: 1,
            }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error?.message || `HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        const base64ImageBytes = data.generatedImages?.[0]?.image?.imageBytes;

        if (!base64ImageBytes) {
            throw new Error("The API did not return a valid image.");
        }
        
        generatedImage.src = `data:image/png;base64,${base64ImageBytes}`;
        showImageResponse();
        speak("Here is the image you requested.", false);

    } catch (error) {
        console.error("Error generating image:", error);
        const errorMessage = `Sorry, I couldn't generate the image. ${error instanceof Error ? error.message : 'Please try again.'}`;
        speak(errorMessage, true);
    }
}

// --- SPEECH RECOGNITION ---
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition: any;

if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.lang = 'en-US';
    recognition.interimResults = false;

    recognition.onresult = (event: any) => {
        const transcript = event.results[event.results.length - 1][0].transcript.trim().toLowerCase();
        console.log(`Heard: ${transcript}`);
        handleCommand(transcript);
    };

    recognition.onerror = (event: any) => {
        console.error("Speech recognition error:", event.error);
    };

    recognition.onend = () => {
        if (isAssistantActive && !recognitionPaused) {
            recognition.start();
        }
    };
} else {
    responseText.textContent = "Speech recognition is not supported in this browser.";
}

// --- COMMAND HANDLING & STATE ---
function handleCommand(command: string) {
    if (!isAssistantActive) {
        if (command.includes('start')) {
            activateAssistant();
        }
        return;
    }
    
    if (command.includes('stop listening')) {
        deactivateAssistant();
        return;
    }
    
    const imageTriggers = ["generate an image of ", "create an image of "];
    
    for (const trigger of imageTriggers) {
        if (command.startsWith(trigger)) {
            const prompt = command.substring(trigger.length);
            generateImage(prompt);
            return;
        }
    }
    
    conversationHistory.push({ role: 'user', parts: [{ text: command }] });
    getAIResponse();
}

function activateAssistant() {
    isAssistantActive = true;
    body.classList.add('assistant-active');
    showTextResponse();
    setupAudio();
    conversationHistory = [{
        role: 'user',
        parts: [{ text: 'You are DAR, a voice assistant inspired by JARVIS. Keep your responses concise and to the point.' }]
    }, {
        role: 'model',
        parts: [{ text: 'Yes, sir.' }]
    }];
    speak("I am online and ready.", true);
}

function deactivateAssistant() {
    isAssistantActive = false;
    body.classList.remove('assistant-active');
    showTextResponse();
    responseText.innerHTML = `Say "Start" to activate`;
    if (recognition) {
        recognition.stop();
    }
    window.speechSynthesis.cancel();
}


// --- INITIALIZATION ---
window.speechSynthesis.onvoiceschanged = loadVoices;
loadVoices();

// Start the visualization loop, it will only draw when active
visualize();
