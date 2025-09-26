// @ts-ignore
declare var marked: any;


export {};

declare global {
    interface Window {
        SpeechRecognition: any;
        webkitSpeechRecognition: any;
    }
}

// --- GEMINI API SETUP ---
const API_KEY = 'AIzaSyA2bQvHT9OeD5z_HLxOD2Qa1duTCPjJEDg'; 
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

    if (renderMarkdown) {
        responseText.innerHTML = marked.parse(text);
    } else {
        responseText.textContent = text;
    }

    // Ensure voices are loaded. Sometimes the initial load is slow.
    if (voices.length === 0) {
        voices = window.speechSynthesis.getVoices();
    }
    
    // Split text into chunks at sentence endings to avoid TTS length limits.
    const chunks = text.match(/[^.!?]+[.!?\s]*|[^.!?]+$/g) || [];

    if (chunks.length === 0) {
        if (recognition) recognitionPaused = false;
        return;
    }

    let chunkIndex = 0;

    const speakNextChunk = () => {
        if (chunkIndex >= chunks.length) {
            // Finished speaking all chunks, re-enable recognition.
            if (recognition) {
                recognitionPaused = false;
                setTimeout(() => {
                    if (isAssistantActive) {
                        try { recognition.start(); } catch (e) { console.error("Recognition restart error:", e); }
                    }
                }, 200);
            }
            return;
        }

        const chunk = chunks[chunkIndex].trim();
        chunkIndex++; // Move to next chunk before speaking

        if (chunk) {
            const utterance = new SpeechSynthesisUtterance(chunk);
            utterance.lang = 'en-IN'; // Set language to English (India)

            // Explicitly find and set a voice for improved reliability.
            if (voices.length > 0) {
                // Prefer an Indian English voice, but fall back to US English.
                let selectedVoice = voices.find(v => v.lang === 'en-IN' && v.default);
                if (!selectedVoice) {
                    selectedVoice = voices.find(v => v.lang === 'en-IN');
                }
                if (!selectedVoice) {
                    selectedVoice = voices.find(v => v.lang === 'en-US' && v.default);
                }
                if (!selectedVoice) {
                     selectedVoice = voices.find(v => v.lang === 'en-US');
                }
                if (selectedVoice) {
                    utterance.voice = selectedVoice;
                }
            }

            utterance.onend = speakNextChunk; // Chain the next chunk

            utterance.onerror = (event) => {
                console.error('SpeechSynthesisUtterance.onerror:', event.error);
                speakNextChunk(); // Try to continue with the next chunk on error
            };

            window.speechSynthesis.speak(utterance);
        } else {
            // If chunk is empty, just move to the next one.
            speakNextChunk();
        }
    };

    speakNextChunk(); // Start the sequence.
}

// --- GEMINI API INTEGRATION (REST API) ---
async function getAIResponse() {
    responseContainer.classList.remove('justify-center');
    responseContainer.classList.add('justify-start');
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
    responseContainer.classList.remove('justify-center');
    responseContainer.classList.add('justify-start');
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
    recognition.lang = 'en-IN'; // Set language to English (India)
    recognition.interimResults = false;

    recognition.onresult = (event: any) => {
        const transcript = event.results[event.results.length - 1][0].transcript.trim().toLowerCase();
        console.log(`Heard: ${transcript}`);
        handleCommand(transcript);
    };

    recognition.onerror = (event: any) => {
        // These errors are common and non-fatal.
        // 'no-speech' happens when the user is silent.
        // 'audio-capture' can happen if the mic is temporarily unavailable.
        // The 'onend' event will handle restarting the recognition service.
        if (event.error === 'no-speech' || event.error === 'audio-capture') {
            return;
        }
        console.error(`Speech recognition error: ${event.error}`);
    };

    recognition.onend = () => {
        // Always restart recognition unless it was paused for speech synthesis.
        // This ensures the app is always listening for the wake word.
        if (!recognitionPaused) {
            try {
                recognition.start();
            } catch (e) {
                // This can happen if start() is called while it's already starting, which is safe to ignore.
                if ((e as DOMException).name !== 'InvalidStateError') {
                     console.error("Recognition restart error:", e);
                }
            }
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
        parts: [{ text: 'You are DAR, a voice assistant inspired by JARVIS. Keep responses concise. Use markdown for formatting like lists or bold text when appropriate.' }]
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
    responseContainer.classList.add('justify-center');
    responseContainer.classList.remove('justify-start');
    responseText.innerHTML = `Say "Start" to activate`;
    // We no longer stop recognition; the onend handler will restart it,
    // so it can continue to listen for the "Start" wake word.
    window.speechSynthesis.cancel();
}


// --- INITIALIZATION ---
window.speechSynthesis.onvoiceschanged = loadVoices;
loadVoices();

// Start the visualization loop, it will only draw when active
visualize();

// Start listening for the wake word as soon as the app loads
if (recognition) {
    try {
        recognition.start();
    } catch(e) {
        console.error("Initial recognition start failed:", e);
        responseText.textContent = "Could not start speech recognition. Please check microphone permissions.";
    }
}
