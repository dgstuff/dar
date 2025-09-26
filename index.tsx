// @ts-ignore
declare var marked: any;

// This is needed to make the file a module
export { };

// FIX: This global augmentation now works correctly because the file is a module.
// This resolves errors on window.SpeechRecognition and window.webkitSpeechRecognition.
declare global {
    interface Window {
        SpeechRecognition: any;
        webkitSpeechRecognition: any;
    }
}

// --- GEMINI API SETUP ---
const API_KEY = 'AIzaSyA2bQvHT9OeD5z_HLxOD2Qa1duTCPjJEDg';
const STREAM_TEXT_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?key=${API_KEY}&alt=sse`;
const IMAGE_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:generateImages?key=${API_KEY}`;
let chatHistory: { role: string, parts: { text: string }[] }[] = [];


// --- SETTINGS STATE ---
let speechRate = 1.0;
let speechPitch = 1.0;
let isVisualizerEnabled = true;
let selectedVoiceURI: string | null = null;

// --- CORE STATE MANAGEMENT ---
let isAssistantActive = false;
let voices: SpeechSynthesisVoice[] = [];
let recognitionPaused = false; // Paused for TTS
let isRecognitionRunning = false; // True state of the recognition engine
let isSpeaking = false; // True if TTS is active
let speechEnginePrimed = false; // To handle browser autoplay policies

// --- UI ELEMENTS ---
const responseText = document.getElementById('response-text') as HTMLDivElement;
const responseContainer = document.getElementById('response-container') as HTMLDivElement;
const imageContainer = document.getElementById('image-container') as HTMLDivElement;
const generatedImage = document.getElementById('generated-image') as HTMLImageElement;
const mainContainer = document.getElementById('main-container') as HTMLDivElement;
const body = document.body;
const visualizerCanvas = document.getElementById('visualizer') as HTMLCanvasElement;
const visualizerContainer = document.getElementById('visualizer-container') as HTMLDivElement;
const canvasCtx = visualizerCanvas.getContext('2d')!;
const initialIconContainer = document.getElementById('initial-icon-container') as HTMLDivElement;
// Settings UI
const settingsModal = document.getElementById('settings-modal') as HTMLDivElement;
const rateDisplay = document.getElementById('rate-display') as HTMLSpanElement;
const pitchDisplay = document.getElementById('pitch-display') as HTMLSpanElement;
const visualizerDisplay = document.getElementById('visualizer-display') as HTMLSpanElement;
const currentVoiceDisplay = document.getElementById('current-voice-display') as HTMLSpanElement;
const voiceList = document.getElementById('voice-list') as HTMLDivElement;


// --- UI HELPERS ---
function showTextResponse() {
    imageContainer.classList.add('hidden');
    imageContainer.classList.remove('flex');
    responseContainer.classList.remove('hidden');
    responseContainer.classList.add('flex');
}

function showImageResponse() {
    responseContainer.classList.add('hidden');
    responseContainer.classList.remove('flex');
    imageContainer.classList.remove('hidden');
    imageContainer.classList.add('flex');
}

function showInitialIcon() {
    responseText.classList.add('hidden');
    initialIconContainer.classList.remove('hidden');
    initialIconContainer.classList.add('flex');
    responseText.innerHTML = ''; // Clear old content
}

function showResponseTextUI() {
    initialIconContainer.classList.add('hidden');
    initialIconContainer.classList.remove('flex');
    responseText.classList.remove('hidden');
}


// --- AUDIO & VISUALIZER ---
let audioContext: AudioContext;
let analyser: AnalyserNode;
let source: MediaStreamAudioSourceNode;
let dataArray: Uint8Array;
let bufferLength: number;

// This function will ensure AudioContext is ready, creating/resuming it as needed.
// This is crucial for browsers that block audio until a user gesture.
async function ensureAudioContext() {
    if (!audioContext || audioContext.state === 'closed') {
        try {
            audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            console.log("AudioContext created.");
        } catch (e) {
            console.error("Could not create AudioContext:", e);
            return; // Exit if creation fails
        }
    }
    if (audioContext.state === 'suspended') {
        console.log("AudioContext is suspended, attempting to resume...");
        try {
             await audioContext.resume();
             console.log("AudioContext resumed, state is now:", audioContext.state);
        } catch(e) {
            console.error("Failed to resume AudioContext:", e);
        }
    }
}

async function setupAudio() {
    await ensureAudioContext();
    if (!audioContext) return; // Guard if context creation failed

    if (source) return; // Already setup
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        bufferLength = analyser.frequencyBinCount;
        dataArray = new Uint8Array(bufferLength);
        source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);
    } catch (err) {
        console.error("Error accessing microphone for visualizer:", err);
        speak("I need microphone access for the visualizer to work.", true);
    }
}

function visualize() {
    requestAnimationFrame(visualize);
    if (!isAssistantActive || !analyser || !isVisualizerEnabled) {
        canvasCtx.clearRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);
        return;
    };

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

async function playTone(type: 'activation' | 'deactivation') {
    await ensureAudioContext();
    if (!audioContext) {
        console.warn("AudioContext not ready for tones.");
        return;
    }
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    gainNode.gain.setValueAtTime(0, audioContext.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.3, audioContext.currentTime + 0.01);

    oscillator.frequency.value = (type === 'activation') ? 880 : 440;
    oscillator.type = 'sine';

    const duration = 0.2;
    oscillator.start(audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.00001, audioContext.currentTime + duration);
    oscillator.stop(audioContext.currentTime + duration);
}


// --- SPEECH SYNTHESIS ---
function loadVoices() {
    voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
        console.log(`Successfully loaded ${voices.length} voices.`);
        populateVoiceList();
        updateDisplaySettings();
    } else {
        console.warn("Voice list is empty. Waiting for onvoiceschanged event.");
    }
}

function speak(text: string, renderMarkdown = true, onDone?: () => void) {
    if (!text) return;

    window.speechSynthesis.cancel();
    isSpeaking = true;

    if (recognition) {
        recognitionPaused = true;
        stopRecognition();
    }

    if (renderMarkdown) {
        responseText.innerHTML = marked.parse(text);
    } else {
        responseText.textContent = text;
    }

    if (voices.length === 0) {
        voices = window.speechSynthesis.getVoices();
    }

    const chunks = text.match(/[^.!?]+[.!?\s]*|[^.!?]+$/g) || [];
    if (chunks.length === 0) {
        isSpeaking = false;
        if (recognition) {
            recognitionPaused = false;
            startRecognition();
        }
        if (onDone) onDone();
        return;
    }

    let chunkIndex = 0;
    const speakNextChunk = () => {
        if (chunkIndex >= chunks.length) {
            isSpeaking = false;
            if (recognition) {
                recognitionPaused = false;
                setTimeout(startRecognition, 50);
            }
            if (onDone) onDone();
            return;
        }

        const chunk = chunks[chunkIndex++].trim();
        if (!chunk) {
            speakNextChunk();
            return;
        }

        const utterance = new SpeechSynthesisUtterance(chunk);
        utterance.rate = speechRate;
        utterance.pitch = speechPitch;

        let selectedVoice = voices.find(v => v.voiceURI === selectedVoiceURI);
        if (!selectedVoice) selectedVoice = voices.find(v => v.lang === 'en-US' || v.lang.startsWith('en-'));
        if (selectedVoice) utterance.voice = selectedVoice;

        utterance.onend = speakNextChunk;
        utterance.onerror = (event) => {
            console.error(`SpeechSynthesisUtterance.onerror - Error: ${event.error}, Chunk: "${chunk}"`);
            speakNextChunk();
        };

        window.speechSynthesis.speak(utterance);
    };

    speakNextChunk();
}


// --- GEMINI API INTEGRATION ---
async function getAIResponse(prompt: string) {
    responseContainer.classList.remove('justify-center');
    responseContainer.classList.add('justify-start');
    showTextResponse();
    showResponseTextUI();
    responseText.innerHTML = ''; // Clear previous response
    chatHistory.push({ role: 'user', parts: [{ text: prompt }] });

    let fullResponse = "";
    try {
        const response = await fetch(STREAM_TEXT_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: chatHistory
            })
        });

        if (!response.ok || !response.body) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const jsonStr = line.substring(6);
                    try {
                        const chunkData = JSON.parse(jsonStr);
                        const chunkText = chunkData.candidates?.[0]?.content?.parts?.[0]?.text;
                        if (chunkText) {
                            fullResponse += chunkText;
                            responseText.innerHTML = marked.parse(fullResponse + " ▋");
                        }
                    } catch (e) {
                        console.warn("Could not parse JSON chunk from stream:", jsonStr);
                    }
                }
            }
        }
        
        responseText.innerHTML = marked.parse(fullResponse);
        chatHistory.push({ role: 'model', parts: [{ text: fullResponse }] });

        if (chatHistory.length > 102) {
            chatHistory.splice(2, chatHistory.length - 102);
        }
        speak(fullResponse, false);

    } catch (error) {
        console.error("Error fetching AI response:", error);
        const errorMessage = `Sorry, an error occurred. Please check the console for details.`;
        speak(errorMessage, true);
    }
}

async function generateImage(prompt: string) {
    showResponseTextUI();
    showTextResponse();
    const generatingText = `Generating an image of: *${prompt}*...`;
    responseText.innerHTML = marked.parse(generatingText);
    speak("Generating your image now.", false);

    try {
        const response = await fetch(IMAGE_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: prompt, numberOfImages: 1 })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error.message || `HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        const base64ImageBytes = data.generatedImages[0].imageBytes;
        generatedImage.src = `data:image/png;base64,${base64ImageBytes}`;
        showImageResponse();
        speak("Here is your generated image.", false);

    } catch (error) {
        console.error("Error generating image:", error);
        const errorMessage = `Sorry, I couldn't generate the image.`;
        speak(errorMessage, true);
    }
}

// --- SPEECH RECOGNITION ---
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition: any;

function startRecognition() {
    if (recognition && !isRecognitionRunning) {
        try {
            recognition.start();
        } catch (e) {
            console.error("Error starting recognition:", e);
        }
    }
}

function stopRecognition() {
    if (recognition && isRecognitionRunning) {
        recognition.stop();
    }
}

if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.lang = 'en-US';
    recognition.interimResults = false;

    recognition.onstart = () => {
        isRecognitionRunning = true;
        console.log("Recognition started.");
    };

    recognition.onend = () => {
        isRecognitionRunning = false;
        console.log("Recognition ended.");
        // Always restart recognition unless it's paused for speaking
        if (!recognitionPaused) {
            setTimeout(startRecognition, 100);
        }
    };

    recognition.onresult = (event: any) => {
        if (isSpeaking) {
            console.log("Recognition result ignored while speaking.");
            return;
        }
        const transcript = event.results[event.results.length - 1][0].transcript.trim().toLowerCase();
        console.log(`Heard: ${transcript}`);
        handleCommand(transcript);
    };

    recognition.onerror = (event: any) => {
        if (event.error === 'no-speech' || event.error === 'aborted') {
            return;
        }
        console.error(`Speech recognition error: ${event.error}`);
    };
}

// --- COMMAND HANDLING & STATE ---
function handleCommand(command: string) {
    if (!speechEnginePrimed) {
        // On the very first command, we need to "unlock" the Speech Synthesis API.
        // This must be done in response to a user gesture. In our hands-free case,
        // the first voice command is that gesture. Speaking a silent utterance
        // here satisfies browser autoplay policies before the first audible speech.
        console.log("Priming speech synthesis engine on first command.");
        const utterance = new SpeechSynthesisUtterance('');
        window.speechSynthesis.speak(utterance);
        speechEnginePrimed = true;
    }

    if (!isAssistantActive) {
        if (command.includes('start')) activateAssistant();
        return;
    }

    if (command.includes('open settings')) {
        openSettings();
        return;
    }

    if (command.includes('close settings')) {
        closeSettings();
        return;
    }

    if (command.includes('deactivate')) {
        deactivateAssistant();
        return;
    }
    
    // If settings modal is open, try to match settings-related commands first.
    if (!settingsModal.classList.contains('hidden')) {
        const rateMatch = command.match(/set (?:voice )?speed to (.+)/);
        if (rateMatch && rateMatch[1]) {
            const newRate = parseFloat(rateMatch[1]);
            if (!isNaN(newRate) && newRate >= 0.5 && newRate <= 2) {
                updateSpeechRate(newRate);
            } else {
                speak(`Sorry, speed must be between 0.5 and 2.`, true);
            }
            return; // Command handled
        }

        const pitchMatch = command.match(/set (?:voice )?pitch to (.+)/);
        if (pitchMatch && pitchMatch[1]) {
            const newPitch = parseFloat(pitchMatch[1]);
            if (!isNaN(newPitch) && newPitch >= 0 && newPitch <= 2) {
                updateSpeechPitch(newPitch);
            } else {
                speak(`Sorry, pitch must be between 0 and 2.`, true);
            }
            return; // Command handled
        }
        
        if (command.includes('enable visualizer') || command.includes('turn on visualizer')) {
            updateVisualizer(true);
            return; // Command handled
        }

        if (command.includes('disable visualizer') || command.includes('turn off visualizer')) {
            updateVisualizer(false);
            return; // Command handled
        }
        
        const voiceMatch = command.match(/(?:change|set|use) voice to (.+)/);
        if(voiceMatch && voiceMatch[1]){
            const voiceQuery = voiceMatch[1].toLowerCase().trim();
            const foundVoice = voices.find(v => v.name.toLowerCase().includes(voiceQuery));
            if(foundVoice){
                updateVoice(foundVoice.voiceURI);
            } else {
                speak(`Sorry, I couldn't find a voice matching ${voiceQuery}. You can see the list of available voices in the settings.`, true);
            }
            return; // Command handled
        }
    }
    
    // If no specific command was matched, or settings are closed, treat it as a prompt for Gemini
    const imageTriggers = ["generate an image of ", "create an image of "];
    for (const trigger of imageTriggers) {
        if (command.startsWith(trigger)) {
            const prompt = command.substring(trigger.length);
            generateImage(prompt);
            return;
        }
    }

    getAIResponse(command);
}

async function activateAssistant() {
    isAssistantActive = true;
    body.classList.add('assistant-active');
    playTone('activation');
    showTextResponse();
    showResponseTextUI();
    await setupAudio();
    
    if (chatHistory.length === 0) {
        chatHistory = [{
            role: 'user',
            parts: [{ text: 'You are DAR, a voice assistant inspired by JARVIS. Keep responses concise. Use markdown for formatting like lists or bold text when appropriate.' }]
        }, {
            role: 'model',
            parts: [{ text: 'Yes, sir.' }]
        }];
    }

    speak("I am online and ready.", true);
}

async function deactivateAssistant() {
    isAssistantActive = false;
    body.classList.remove('assistant-active');
    await playTone('deactivation');
    
    const onDeactivationSpoken = () => {
        showTextResponse();
        responseContainer.classList.add('justify-center');
        responseContainer.classList.remove('justify-start');
        showInitialIcon();
    };

    speak("Deactivated", false, onDeactivationSpoken);
}


// --- SETTINGS ---
function openSettings() {
    updateDisplaySettings();
    populateVoiceList();
    settingsModal.classList.remove('hidden');
    settingsModal.classList.add('flex');
    speak("Settings opened.", false);
}

function closeSettings() {
    settingsModal.classList.add('hidden');
    settingsModal.classList.remove('flex');
    speak("Settings closed.", false);
}

function saveSettings() {
    const settings = {
        speechRate,
        speechPitch,
        isVisualizerEnabled,
        selectedVoiceURI,
    };
    localStorage.setItem('dar-settings', JSON.stringify(settings));
}

function loadSettings() {
    const savedSettings = localStorage.getItem('dar-settings');
    if (savedSettings) {
        const settings = JSON.parse(savedSettings);
        speechRate = settings.speechRate || 1.0;
        speechPitch = settings.speechPitch || 1.0;
        isVisualizerEnabled = typeof settings.isVisualizerEnabled === 'boolean' ? settings.isVisualizerEnabled : true;
        selectedVoiceURI = settings.selectedVoiceURI || null;

        visualizerContainer.style.display = isVisualizerEnabled ? 'block' : 'none';
    }
}

function updateDisplaySettings() {
    if (!rateDisplay || !pitchDisplay || !visualizerDisplay || !currentVoiceDisplay) return;
    rateDisplay.textContent = speechRate.toFixed(1);
    pitchDisplay.textContent = speechPitch.toFixed(1);
    visualizerDisplay.textContent = isVisualizerEnabled ? 'Enabled' : 'Disabled';
    const currentVoice = voices.find(v => v.voiceURI === selectedVoiceURI);
    currentVoiceDisplay.textContent = currentVoice ? currentVoice.name : 'Default';
}

function updateSpeechRate(newRate: number) {
    speechRate = newRate;
    saveSettings();
    updateDisplaySettings();
    speak(`Speed set to ${newRate}.`, false);
}
function updateSpeechPitch(newPitch: number) {
    speechPitch = newPitch;
    saveSettings();
    updateDisplaySettings();
    speak(`Pitch set to ${newPitch}.`, false);
}
function updateVisualizer(isEnabled: boolean) {
    isVisualizerEnabled = isEnabled;
    visualizerContainer.style.display = isVisualizerEnabled ? 'block' : 'none';
    saveSettings();
    updateDisplaySettings();
    speak(`Visualizer ${isEnabled ? 'enabled' : 'disabled'}.`, false);
}
function updateVoice(voiceURI: string) {
    selectedVoiceURI = voiceURI;
    saveSettings();
    updateDisplaySettings();
    populateVoiceList(); // To update highlighting
    const voice = voices.find(v => v.voiceURI === voiceURI);
    speak(`Voice changed to ${voice ? voice.name : 'the selected voice'}.`, false);
}

function populateVoiceList() {
    voiceList.innerHTML = '';
    const englishVoices = voices.filter(v => v.lang.startsWith('en-'));
    if(englishVoices.length === 0){
        voiceList.innerHTML = `<p class="text-gray-400">No English voices found.</p>`;
        return;
    }
    const ul = document.createElement('ul');
    ul.className = 'space-y-1';
    englishVoices.forEach(voice => {
        const li = document.createElement('li');
        li.textContent = `${voice.name} (${voice.lang})`;
        li.className = 'p-1 rounded ' + (voice.voiceURI === selectedVoiceURI ? 'bg-sky-800' : '');
        ul.appendChild(li);
    });
    voiceList.appendChild(ul);
}


// --- INITIALIZATION ---
function initializeApp() {
    console.log("Initializing application on page load...");
    loadSettings();

    window.speechSynthesis.onvoiceschanged = loadVoices;
    loadVoices(); // Initial attempt
    
    // Attempt to prime TTS. It might not work immediately but sets things up.
    try {
        const utterance = new SpeechSynthesisUtterance(' ');
        utterance.volume = 0;
        window.speechSynthesis.speak(utterance);
    } catch(e) {
        console.warn("TTS priming failed, likely awaiting user gesture.", e);
    }
    
    showInitialIcon();
    startRecognition();
}

if (SpeechRecognition) {
    // We no longer need a click to start. The app will initialize on load.
    // The browser will ask for microphone permissions when speech recognition starts.
    initializeApp();
} else {
    showResponseTextUI();
    responseText.textContent = "Speech recognition is not supported by your browser.";
}

visualize();

// TTS Keep-alive
setInterval(() => {
    if (!window.speechSynthesis.speaking) {
        window.speechSynthesis.resume();
    }
}, 5000);
